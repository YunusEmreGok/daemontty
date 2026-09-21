import { ipcMain, WebContents } from 'electron'
import { posix } from 'path'
import { ClientChannel, SFTPWrapper } from 'ssh2'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { IPty } from 'node-pty'
import { DirListing, LOCAL_HOST_ID, ServerStats, SessionEvent } from '@shared/types'
import { connect, Connection } from './connection'
import { addHistory, clearHistory, getHistory, historyCount } from './vault'
import { openSessionLog, SessionLog } from './sessionlog'
import { colorize } from './colorize'
import { getSettings } from './vault'

interface Session {
  conn?: Connection
  stream?: ClientChannel
  /** Yerel terminal (SSH yerine bu bilgisayarda kabuk) */
  pty?: IPty
  closed: boolean
  log?: SessionLog | null
  /** Yol tamamlama için aynı bağlantı üzerinde tembel açılan SFTP kanalı */
  sftp?: Promise<{ sftp: SFTPWrapper; home: string }>
}

const sessions = new Map<string, Session>()

function emit(wc: WebContents, id: string, ev: SessionEvent): void {
  if (!wc.isDestroyed()) wc.send('ssh:event', id, ev)
}

/** Bu bilgisayarda kullanıcının kabuğunu açar. node-pty yerel modüldür; yüklenemezse yalnızca bu özellik çalışmaz. */
async function openLocal(wc: WebContents, id: string, session: Session, cols: number, rows: number): Promise<void> {
  const { spawn } = await import('node-pty')
  if (process.platform !== 'win32') {
    // npm, hazır derlenmiş spawn-helper'ın çalıştırma iznini düşürebiliyor ("posix_spawnp failed").
    try {
      const dir = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', `${process.platform}-${process.arch}`)
      fs.chmodSync(path.join(dir.replace('app.asar', 'app.asar.unpacked'), 'spawn-helper'), 0o755)
    } catch {
      /* kaynak koddan derlenmiş kurulumda bu dosya yoktur */
    }
  }
  const win = process.platform === 'win32'
  const shell = win ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/zsh'
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  env.LANG ||= 'en_US.UTF-8' // Finder'dan açılınca LANG boş gelir; Türkçe karakterler bozulmasın
  // Giriş kabuğu (-l): Finder'dan açılan uygulamada PATH eksik olur, profil dosyaları onu tamamlar.
  const pty = spawn(shell, win ? [] : ['-l'], { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env })
  if (session.closed) return pty.kill()
  session.pty = pty
  session.log = openSessionLog('Yerel terminal')
  pty.onData((d) => {
    const buf = Buffer.from(d, 'utf8')
    if (!wc.isDestroyed()) wc.send('ssh:data', id, buf)
    session.log?.write(buf)
  })
  pty.onExit(() => {
    if (session.closed) return
    emit(wc, id, { type: 'closed', reason: 'exit', message: 'Oturum kapandı' })
    close(id)
  })
  emit(wc, id, { type: 'ready' })
}

async function open(wc: WebContents, id: string, hostId: string, cols: number, rows: number): Promise<void> {
  close(id)
  const session: Session = { closed: false }
  sessions.set(id, session)
  try {
    if (hostId === LOCAL_HOST_ID) return await openLocal(wc, id, session, cols, rows)
    const conn = await connect(hostId, (m) => emit(wc, id, { type: 'status', message: m }))
    if (session.closed) return conn.dispose()
    session.conn = conn

    const stream = await new Promise<ClientChannel>((resolve, reject) =>
      conn.client.shell({ term: 'xterm-256color', cols, rows }, (err, s) => (err ? reject(err) : resolve(s)))
    )
    if (session.closed) return conn.dispose()
    session.stream = stream

    // Buffer olarak gönderiyoruz; UTF-8 karakterler (ş, ğ, ı…) parçalara bölünse bile xterm doğru birleştirir.
    session.log = openSessionLog(conn.host.label)
    const deliver = (d: Buffer): void => {
      if (!wc.isDestroyed()) wc.send('ssh:data', id, d)
      session.log?.write(d)
    }
    // Renklendirme satırının yankısını süzebilmek için veri bir ara katmandan geçer.
    let route = deliver
    const onData = (d: Buffer): void => route(d)
    stream.on('data', onData)
    stream.stderr.on('data', onData)
    // Kullanıcı "exit" yazdıysa kabuk çıkış kodu gönderir; bağlantı koparsa göndermez.
    let exited = false
    let lastError = ''
    const report = (): void => {
      if (session.closed) return
      if (exited) emit(wc, id, { type: 'closed', reason: 'exit', message: 'Oturum kapandı' })
      else emit(wc, id, { type: 'closed', reason: 'lost', message: lastError ? `Bağlantı koptu (${lastError})` : 'Bağlantı koptu' })
      close(id)
    }
    stream.on('exit', () => (exited = true))
    stream.on('close', report)
    conn.client.on('close', report)
    conn.client.on('error', (err: Error & { level?: string }) => {
      lastError = /keepalive/i.test(err.message) ? 'sunucu yanıt vermiyor' : err.message
    })

    if (getSettings().colorizeShell) await colorize(conn, stream, deliver, (f) => (route = f)).catch(() => {})
    if (session.closed) return
    emit(wc, id, { type: 'ready' })
    if (conn.host.startupCommand) stream.write(conn.host.startupCommand + '\n')
  } catch (err) {
    sessions.delete(id)
    emit(wc, id, { type: 'error', message: (err as Error).message, retryable: isRetryable(err) })
  }
}

/** Ağ kaynaklı (tekrar denemeye değer) hata mı? Kimlik doğrulama hataları değildir. */
function isRetryable(err: unknown): boolean {
  const cause = ((err as { cause?: unknown }).cause ?? err) as { code?: string; level?: string; message?: string }
  if (cause.level === 'client-authentication') return false
  if (cause.code && ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(cause.code))
    return true
  return /timed out|zaman aşımı|keepalive/i.test(cause.message ?? '')
}

function close(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.closed = true
  sessions.delete(id)
  s.stream?.end()
  s.conn?.dispose()
  s.pty?.kill()
  s.log?.close()
}

function sftpOf(s: Session): Promise<{ sftp: SFTPWrapper; home: string }> {
  s.sftp ??= new Promise((resolve, reject) => {
    if (!s.conn) return reject(new Error('bağlı değil'))
    s.conn.client.sftp((err, sftp) => {
      if (err) return reject(err)
      sftp.realpath('.', (err2, home) => (err2 ? reject(err2) : resolve({ sftp, home })))
    })
  })
  s.sftp.catch(() => (s.sftp = undefined))
  return s.sftp
}

const MAX_ENTRIES = 1000

async function listDir(id: string, dir: string): Promise<DirListing | null> {
  const s = sessions.get(id)
  if (!s?.conn) return null
  try {
    const { sftp, home } = await sftpOf(s)
    let target = dir || '.'
    if (target === '~' || target.startsWith('~/')) target = home + target.slice(1)
    if (!target.startsWith('/')) target = posix.join(home, target)
    const items = await new Promise<Array<{ filename: string; attrs: { mode: number } }>>((resolve, reject) =>
      sftp.readdir(target, (err, list) => (err ? reject(err) : resolve(list as never)))
    )
    return {
      dir: target,
      entries: items.slice(0, MAX_ENTRIES).map((it) => ({
        name: it.filename,
        // Hız için stat yapılmıyor; klasöre işaret eden sembolik bağlantılar dosya sayılır.
        isDir: (it.attrs.mode & 0o170000) === 0o040000
      }))
    }
  } catch {
    return null
  }
}

// Linux sunucularda /proc'tan okunur; tek bir kısa exec kanalı açılır.
const STATS_CMD =
  "head -1 /proc/stat 2>/dev/null; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo 2>/dev/null; " +
  'df -Pk / 2>/dev/null | tail -1; cat /proc/loadavg 2>/dev/null; nproc 2>/dev/null'

async function stats(id: string): Promise<ServerStats | null> {
  const s = sessions.get(id)
  if (!s?.conn) return null
  const out = await new Promise<string>((resolve) => {
    let buf = ''
    const timer = setTimeout(() => resolve(''), 5000)
    s.conn!.client.exec(STATS_CMD, (err, ch) => {
      if (err) {
        clearTimeout(timer)
        return resolve('')
      }
      ch.on('data', (d: Buffer) => (buf += d.toString()))
      ch.stderr.on('data', () => {})
      ch.on('close', () => {
        clearTimeout(timer)
        resolve(buf)
      })
    })
  })
  const lines = out.split('\n')
  const cpu = lines.find((l) => l.startsWith('cpu '))
  if (!cpu) return null // Linux değil ya da /proc yok
  const n = cpu.trim().split(/\s+/).slice(1, 9).map(Number)
  const kb = (key: string): number => Number(lines.find((l) => l.startsWith(key))?.match(/(\d+)/)?.[1] ?? 0) * 1024
  const df = lines.find((l) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+%/.test(l))?.trim().split(/\s+/)
  const load = lines.find((l) => /^\d+\.\d+ \d+\.\d+ \d+\.\d+ /.test(l))
  const cores = Number(lines.filter((l) => /^\d+$/.test(l.trim())).pop() ?? 1)
  return {
    cpuTotal: n.reduce((a, b) => a + b, 0),
    cpuIdle: n[3] + (n[4] || 0),
    memTotal: kb('MemTotal:'),
    memAvailable: kb('MemAvailable:'),
    diskTotal: df ? Number(df[1]) * 1024 : 0,
    diskUsed: df ? Number(df[2]) * 1024 : 0,
    load1: load ? Number(load.split(' ')[0]) : 0,
    cores: cores || 1
  }
}

/** Açık oturumun SSH bağlantısı (servis paneli gibi aynı bağlantıyı kullanan özellikler için). */
export function connectionOf(id: string): Connection | undefined {
  return sessions.get(id)?.conn
}

export function closeAllTerminals(): void {
  for (const id of [...sessions.keys()]) close(id)
}

export function registerTerminalIpc(): void {
  ipcMain.handle('ssh:open', (e, id: string, hostId: string, cols: number, rows: number) =>
    open(e.sender, id, hostId, cols, rows)
  )
  ipcMain.on('ssh:write', (_e, id: string, data: string) => {
    const s = sessions.get(id)
    if (s?.pty) s.pty.write(data)
    else s?.stream?.write(data)
  })
  ipcMain.on('ssh:resize', (_e, id: string, cols: number, rows: number) => {
    const s = sessions.get(id)
    if (s?.pty) s.pty.resize(Math.max(cols, 1), Math.max(rows, 1))
    else s?.stream?.setWindow(rows, cols, 0, 0)
  })
  ipcMain.on('ssh:close', (_e, id: string) => close(id))
  ipcMain.handle('ssh:listDir', (_e, id: string, dir: string) => listDir(id, dir))
  ipcMain.handle('ssh:stats', (_e, id: string) => stats(id))
  ipcMain.handle('history:get', (_e, hostId: string) => getHistory(hostId))
  ipcMain.on('history:add', (_e, hostId: string, cmd: string) => {
    const c = String(cmd).trim()
    if (c && c.length <= 1000) addHistory(hostId, c)
  })
  ipcMain.handle('history:clear', () => clearHistory())
  ipcMain.handle('history:count', () => historyCount())
}
