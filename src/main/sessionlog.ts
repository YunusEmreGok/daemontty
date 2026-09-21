import { app, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { StringDecoder } from 'string_decoder'
import { getSettings } from './vault'

// Oturum kaydı: terminal çıktısı düz metin olarak diske yazılır (renk/imleç kodları atılır).
// Parolalar ekrana yansımadığı için kayda da girmez.

export const logDir = (): string => path.join(app.getPath('userData'), 'oturum-kayitlari')

// CSI (ESC [ … harf), OSC (ESC ] … BEL | ESC \), tek karakterli ESC dizileri
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_=>]|\x1b[()][0-9A-B]/g
/** Parça sonunda yarım kalmış bir kaçış dizisi (devamı sonraki parçada gelir) */
const PARTIAL_RE = /\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*|[()])?$/

export interface SessionLog {
  write(chunk: Buffer): void
  close(): void
}

const safeName = (s: string): string => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60) || 'sunucu'

/** Ayar kapalıysa null döner. */
export function openSessionLog(hostLabel: string): SessionLog | null {
  if (!getSettings().sessionLog) return null
  try {
    const dir = path.join(logDir(), safeName(hostLabel))
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
    const out = fs.createWriteStream(path.join(dir, `${stamp}.log`), { flags: 'a' })
    out.on('error', () => {}) // disk dolu vb.: oturumu bozma
    const decoder = new StringDecoder('utf8')
    let carry = ''
    return {
      write(chunk) {
        let text = carry + decoder.write(chunk)
        const partial = text.match(PARTIAL_RE)
        carry = partial ? partial[0] : ''
        if (carry) text = text.slice(0, -carry.length)
        out.write(text.replace(ANSI_RE, '').replace(/\r\n/g, '\n').replace(/[\r\x07\x08]/g, ''))
      },
      close: () => out.end()
    }
  } catch {
    return null
  }
}

export function registerSessionLogIpc(): void {
  ipcMain.handle('logs:openDir', async () => {
    fs.mkdirSync(logDir(), { recursive: true })
    await shell.openPath(logDir())
  })
}
