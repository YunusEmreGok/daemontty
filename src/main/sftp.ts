import { ipcMain, shell, WebContents } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { posix } from 'path'
import { pipeline } from 'stream/promises'
import { SFTPWrapper } from 'ssh2'
import { FileEntry, TransferProgress } from '@shared/types'
import { connect, Connection } from './connection'
import { newId } from './vault'

interface SftpSession {
  conn: Connection
  sftp: SFTPWrapper
}

const sessions = new Map<string, SftpSession>()

function get(id: string): SftpSession {
  const s = sessions.get(id)
  if (!s) throw new Error('SFTP oturumu kapalı')
  return s
}

function p<T>(fn: (cb: (err: Error | null | undefined, res?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(translate(err)) : resolve(res as T))))
}

function translate(err: Error & { code?: number | string }): Error {
  const m = err.message
  if (err.code === 2 || /No such file/i.test(m)) return new Error('Dosya ya da klasör bulunamadı')
  if (err.code === 3 || /Permission denied/i.test(m)) return new Error('İzin reddedildi')
  if (/Failure/i.test(m)) return new Error('İşlem başarısız (klasör boş olmayabilir ya da zaten var)')
  return err
}

async function open(id: string, hostId: string): Promise<string> {
  close(id)
  const conn = await connect(hostId)
  try {
    const sftp = await p<SFTPWrapper>((cb) => conn.client.sftp(cb))
    sessions.set(id, { conn, sftp })
    conn.client.on('close', () => sessions.delete(id))
    return await p<string>((cb) => sftp.realpath('.', cb))
  } catch (err) {
    conn.dispose()
    throw err
  }
}

function close(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  s.conn.dispose()
}

export function closeAllSftp(): void {
  for (const id of [...sessions.keys()]) close(id)
}

async function list(id: string, dir: string): Promise<FileEntry[]> {
  const { sftp } = get(id)
  const items = await p<Array<{ filename: string; attrs: { mode: number; size: number; mtime: number } }>>((cb) =>
    sftp.readdir(dir, cb as never)
  )
  const S_IFMT = 0o170000
  const entries = await Promise.all(
    items.map(async (it) => {
      const full = posix.join(dir, it.filename)
      const type = it.attrs.mode & S_IFMT
      let isDir = type === 0o040000
      const isLink = type === 0o120000
      if (isLink) {
        // Sembolik bağlantının hedefi klasör mü?
        try {
          const st = await p<{ mode: number }>((cb) => sftp.stat(full, cb as never))
          isDir = (st.mode & S_IFMT) === 0o040000
        } catch {
          /* kırık bağlantı */
        }
      }
      return { name: it.filename, path: full, isDir, isLink, size: it.attrs.size, mtime: it.attrs.mtime * 1000, mode: it.attrs.mode }
    })
  )
  return entries
}

async function removeRemote(sftp: SFTPWrapper, target: string, isDir: boolean): Promise<void> {
  if (!isDir) return p<void>((cb) => sftp.unlink(target, cb))
  const items = await p<Array<{ filename: string; attrs: { mode: number } }>>((cb) => sftp.readdir(target, cb as never))
  for (const it of items) {
    const child = posix.join(target, it.filename)
    await removeRemote(sftp, child, (it.attrs.mode & 0o170000) === 0o040000)
  }
  await p<void>((cb) => sftp.rmdir(target, cb))
}

// --- Aktarımlar ---

function progressEmitter(wc: WebContents, sftpId: string, direction: TransferProgress['direction'], name: string, total: number) {
  const prog: TransferProgress = { id: newId(), sftpId, direction, name, transferred: 0, total, state: 'running' }
  let last = 0
  const send = (force = false): void => {
    const now = Date.now()
    if (!force && now - last < 150) return
    last = now
    if (!wc.isDestroyed()) wc.send('sftp:progress', { ...prog })
  }
  send(true)
  return {
    add(n: number) {
      prog.transferred += n
      send()
    },
    done() {
      prog.transferred = prog.total
      prog.state = 'done'
      send(true)
    },
    fail(err: Error) {
      prog.state = 'error'
      prog.error = err.message
      send(true)
    }
  }
}

async function remoteSize(sftp: SFTPWrapper, target: string): Promise<number> {
  const st = await p<{ mode: number; size: number }>((cb) => sftp.stat(target, cb as never))
  if ((st.mode & 0o170000) !== 0o040000) return st.size
  const items = await p<Array<{ filename: string }>>((cb) => sftp.readdir(target, cb as never))
  let total = 0
  for (const it of items) total += await remoteSize(sftp, posix.join(target, it.filename))
  return total
}

function localSize(target: string): number {
  const st = fs.lstatSync(target)
  if (!st.isDirectory()) return st.size
  return fs.readdirSync(target).reduce((sum, n) => sum + localSize(path.join(target, n)), 0)
}

async function downloadOne(sftp: SFTPWrapper, remote: string, local: string, onBytes: (n: number) => void): Promise<void> {
  const st = await p<{ mode: number }>((cb) => sftp.stat(remote, cb as never))
  if ((st.mode & 0o170000) === 0o040000) {
    fs.mkdirSync(local, { recursive: true })
    const items = await p<Array<{ filename: string }>>((cb) => sftp.readdir(remote, cb as never))
    for (const it of items) await downloadOne(sftp, posix.join(remote, it.filename), path.join(local, it.filename), onBytes)
    return
  }
  let prev = 0
  await p<void>((cb) =>
    sftp.fastGet(remote, local, { step: (t) => { onBytes(t - prev); prev = t } }, cb)
  )
}

async function uploadOne(sftp: SFTPWrapper, local: string, remote: string, onBytes: (n: number) => void): Promise<void> {
  const st = fs.lstatSync(local)
  if (st.isDirectory()) {
    await p<void>((cb) => sftp.mkdir(remote, cb)).catch(() => {}) // zaten varsa sorun değil
    for (const n of fs.readdirSync(local)) await uploadOne(sftp, path.join(local, n), posix.join(remote, n), onBytes)
    return
  }
  let prev = 0
  await p<void>((cb) =>
    sftp.fastPut(local, remote, { step: (t) => { onBytes(t - prev); prev = t } }, cb)
  )
}

async function download(wc: WebContents, id: string, remotePaths: string[], localDir: string): Promise<void> {
  const { sftp } = get(id)
  for (const remote of remotePaths) {
    const name = posix.basename(remote)
    const total = await remoteSize(sftp, remote).catch(() => 0)
    const ev = progressEmitter(wc, id, 'download', name, total)
    try {
      await downloadOne(sftp, remote, path.join(localDir, name), (n) => ev.add(n))
      ev.done()
    } catch (err) {
      ev.fail(err as Error)
    }
  }
}

async function upload(wc: WebContents, id: string, localPaths: string[], remoteDir: string): Promise<void> {
  const { sftp } = get(id)
  for (const local of localPaths) {
    const name = path.basename(local)
    const ev = progressEmitter(wc, id, 'upload', name, localSize(local))
    try {
      await uploadOne(sftp, local, posix.join(remoteDir, name), (n) => ev.add(n))
      ev.done()
    } catch (err) {
      ev.fail(err as Error)
    }
  }
}

/** Uzak dosya/klasörü başka bir SFTP oturumuna akış halinde kopyalar. */
async function copyOne(src: SFTPWrapper, from: string, dst: SFTPWrapper, to: string, onBytes: (n: number) => void): Promise<void> {
  const st = await p<{ mode: number }>((cb) => src.stat(from, cb as never))
  if ((st.mode & 0o170000) === 0o040000) {
    await p<void>((cb) => dst.mkdir(to, cb)).catch(() => {}) // zaten varsa sorun değil
    const items = await p<Array<{ filename: string }>>((cb) => src.readdir(from, cb as never))
    for (const it of items) await copyOne(src, posix.join(from, it.filename), dst, posix.join(to, it.filename), onBytes)
    return
  }
  const read = src.createReadStream(from)
  const write = dst.createWriteStream(to, { mode: st.mode & 0o777 })
  read.on('data', (chunk: Buffer) => onBytes(chunk.length))
  await pipeline(read, write)
}

async function copy(wc: WebContents, fromId: string, paths: string[], toId: string, destDir: string): Promise<void> {
  const src = get(fromId).sftp
  const dst = get(toId).sftp
  for (const from of paths) {
    const name = posix.basename(from)
    const ev = progressEmitter(wc, toId, 'copy', name, await remoteSize(src, from).catch(() => 0))
    try {
      await copyOne(src, from, dst, posix.join(destDir, name), (n) => ev.add(n))
      ev.done()
    } catch (err) {
      ev.fail(translate(err as Error))
    }
  }
}

// --- Yerel dosya sistemi ---

function listLocal(dir: string): FileEntry[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name)
    try {
      const st = fs.statSync(full)
      return [{ name: d.name, path: full, isDir: st.isDirectory(), isLink: d.isSymbolicLink(), size: st.size, mtime: st.mtimeMs }]
    } catch {
      return [] // erişilemeyen / kırık bağlantı
    }
  })
}

export function registerSftpIpc(): void {
  ipcMain.handle('sftp:open', (_e, id: string, hostId: string) => open(id, hostId))
  ipcMain.on('sftp:close', (_e, id: string) => close(id))
  ipcMain.handle('sftp:list', (_e, id: string, dir: string) => list(id, dir))
  ipcMain.handle('sftp:mkdir', (_e, id: string, dir: string) => p<void>((cb) => get(id).sftp.mkdir(dir, cb)))
  ipcMain.handle('sftp:rename', (_e, id: string, from: string, to: string) =>
    p<void>((cb) => get(id).sftp.rename(from, to, cb))
  )
  ipcMain.handle('sftp:remove', (_e, id: string, target: string, isDir: boolean) =>
    removeRemote(get(id).sftp, target, isDir)
  )
  ipcMain.handle('sftp:download', (e, id: string, remotePaths: string[], localDir: string) =>
    download(e.sender, id, remotePaths, localDir)
  )
  ipcMain.handle('sftp:upload', (e, id: string, localPaths: string[], remoteDir: string) =>
    upload(e.sender, id, localPaths, remoteDir)
  )

  ipcMain.handle('local:home', () => os.homedir())
  ipcMain.handle('local:list', (_e, dir: string) => listLocal(dir))
  ipcMain.handle('local:mkdir', (_e, dir: string) => fs.mkdirSync(dir))
  ipcMain.handle('sftp:copy', (e, fromId: string, paths: string[], toId: string, destDir: string) =>
    copy(e.sender, fromId, paths, toId, destDir)
  )
  ipcMain.handle('local:rename', (_e, from: string, to: string) => fs.renameSync(from, to))
  ipcMain.handle('local:copy', (_e, paths: string[], destDir: string) => {
    for (const src of paths) {
      const dest = path.join(destDir, path.basename(src))
      if (path.resolve(src) === path.resolve(dest)) throw new Error('Kaynak ve hedef aynı klasör')
      fs.cpSync(src, dest, { recursive: true, force: true })
    }
  })
  ipcMain.handle('local:remove', (_e, target: string) => shell.trashItem(target))
  ipcMain.on('local:reveal', (_e, target: string) => shell.showItemInFolder(target))
}
