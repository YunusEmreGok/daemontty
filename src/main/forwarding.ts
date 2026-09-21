import { BrowserWindow, ipcMain } from 'electron'
import net from 'net'
import { ForwardStatus, PortForward } from '@shared/types'
import { connect, Connection } from './connection'
import { allForwards, getForward } from './vault'

interface Running {
  conn?: Connection
  server?: net.Server
  sockets: Set<net.Socket>
}

const running = new Map<string, Running>()
const statuses = new Map<string, ForwardStatus>()

function setStatus(s: ForwardStatus): void {
  statuses.set(s.id, s)
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('forward:status', s))
}

function pipeThrough(sock: net.Socket, conn: Connection, destHost: string, destPort: number, run: Running, head?: Buffer): void {
  run.sockets.add(sock)
  sock.on('close', () => run.sockets.delete(sock))
  conn.client.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, destHost, destPort, (err, stream) => {
    if (err) return sock.destroy()
    if (head?.length) stream.write(head)
    sock.pipe(stream).pipe(sock)
    stream.on('close', () => sock.destroy())
    sock.on('error', () => stream.close())
  })
}

/** Basit SOCKS5 sunucusu (kimlik doğrulamasız, sadece CONNECT). */
function handleSocks(sock: net.Socket, conn: Connection, run: Running): void {
  let buf = Buffer.alloc(0)
  let stage: 'greet' | 'request' = 'greet'
  const onData = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk])
    if (stage === 'greet') {
      if (buf.length < 2 || buf.length < 2 + buf[1]) return
      if (buf[0] !== 5) {
        sock.destroy()
        return
      }
      buf = buf.subarray(2 + buf[1])
      sock.write(Buffer.from([5, 0])) // kimlik doğrulama yok
      stage = 'request'
    }
    if (stage === 'request') {
      if (buf.length < 5) return
      const [ver, cmd, , atyp] = buf
      if (ver !== 5 || cmd !== 1) {
        sock.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      let host: string
      let off: number
      if (atyp === 1) {
        if (buf.length < 10) return
        host = [...buf.subarray(4, 8)].join('.')
        off = 8
      } else if (atyp === 3) {
        const len = buf[4]
        if (buf.length < 5 + len + 2) return
        host = buf.subarray(5, 5 + len).toString()
        off = 5 + len
      } else if (atyp === 4) {
        if (buf.length < 22) return
        const parts: string[] = []
        for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16))
        host = parts.join(':')
        off = 20
      } else {
        sock.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      const port = buf.readUInt16BE(off)
      const rest = buf.subarray(off + 2)
      sock.removeListener('data', onData)
      sock.pause()
      run.sockets.add(sock)
      sock.on('close', () => run.sockets.delete(sock))
      conn.client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
        if (err) {
          sock.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
          return
        }
        sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
        if (rest.length) stream.write(rest)
        sock.pipe(stream).pipe(sock)
        sock.resume()
        stream.on('close', () => sock.destroy())
        sock.on('error', () => stream.close())
      })
    }
  }
  sock.on('data', onData)
  sock.on('error', () => sock.destroy())
}

function listen(server: net.Server, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, address, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

async function start(id: string): Promise<void> {
  const fw = getForward(id)
  if (!fw) throw new Error('Kural bulunamadı')
  if (running.has(id)) return
  const run: Running = { sockets: new Set() }
  running.set(id, run)
  setStatus({ id, state: 'starting', message: 'Bağlanılıyor…' })

  try {
    const conn = await connect(fw.hostId, (m) => setStatus({ id, state: 'starting', message: m }))
    run.conn = conn
    if (!running.has(id)) return conn.dispose() // bu arada durduruldu

    conn.client.on('close', () => {
      if (running.has(id)) {
        stop(id)
        setStatus({ id, state: 'error', message: 'SSH bağlantısı koptu' })
      }
    })

    if (fw.type === 'remote') await startRemote(fw, conn, run)
    else {
      run.server = net.createServer((sock) =>
        fw.type === 'dynamic' ? handleSocks(sock, conn, run) : pipeThrough(sock, conn, fw.destHost!, fw.destPort!, run)
      )
      await listen(run.server, fw.bindPort, fw.bindAddress || '127.0.0.1')
    }
    setStatus({ id, state: 'running', message: describe(fw) })
  } catch (err) {
    stop(id)
    const e = err as Error & { code?: string }
    const msg = e.code === 'EADDRINUSE' ? `${fw.bindPort} portu zaten kullanımda` : e.code === 'EACCES' ? `${fw.bindPort} portu için yetki yok` : e.message
    setStatus({ id, state: 'error', message: msg })
    throw new Error(msg)
  }
}

async function startRemote(fw: PortForward, conn: Connection, run: Running): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    conn.client.forwardIn(fw.bindAddress || '127.0.0.1', fw.bindPort, (err) =>
      err ? reject(new Error(`Sunucu uzak yönlendirmeyi reddetti: ${err.message}`)) : resolve()
    )
  )
  conn.client.on('tcp connection', (_info, accept) => {
    const stream = accept()
    const sock = net.connect(fw.destPort!, fw.destHost || '127.0.0.1')
    run.sockets.add(sock)
    sock.on('close', () => run.sockets.delete(sock))
    sock.on('error', () => stream.close())
    stream.on('close', () => sock.destroy())
    stream.pipe(sock).pipe(stream)
  })
}

export function describe(fw: PortForward): string {
  const bind = `${fw.bindAddress || '127.0.0.1'}:${fw.bindPort}`
  if (fw.type === 'local') return `${bind} → ${fw.destHost}:${fw.destPort}`
  if (fw.type === 'remote') return `(sunucu) ${bind} → ${fw.destHost || '127.0.0.1'}:${fw.destPort}`
  return `SOCKS5 vekil sunucusu: ${bind}`
}

function stop(id: string): void {
  const run = running.get(id)
  running.delete(id)
  if (run) {
    run.sockets.forEach((s) => s.destroy())
    run.server?.close()
    run.conn?.dispose()
  }
  setStatus({ id, state: 'stopped' })
}

export function stopAllForwards(): void {
  for (const id of [...running.keys()]) stop(id)
}

/** "Açılışta başlat" işaretli tünelleri başlatır; hatalar tünelin durumunda görünür. */
export function startAutoForwards(): void {
  for (const f of allForwards()) if (f.autoStart) start(f.id).catch(() => {})
}

export function registerForwardIpc(): void {
  ipcMain.handle('forward:start', (_e, id: string) => start(id))
  ipcMain.handle('forward:stop', (_e, id: string) => stop(id))
  ipcMain.handle('forward:statuses', () => [...statuses.values()])
}
