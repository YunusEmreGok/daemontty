import { BrowserWindow, dialog, ipcMain } from 'electron'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { utils } from 'ssh2'
import { KeyType, StoredSshKey, VaultData } from '@shared/types'
import { addKey, getKey, newId, removeKey, renameKey } from './vault'

type ParsedKey = { type: string; getPublicSSH(): Buffer }

function parse(privateKey: string, passphrase?: string): ParsedKey {
  const parsed = utils.parseKey(privateKey, passphrase || undefined)
  const key = (Array.isArray(parsed) ? parsed[0] : parsed) as ParsedKey | Error
  if (key instanceof Error) {
    if (/encrypted|passphrase/i.test(key.message)) {
      throw new Error(passphrase ? 'Anahtar parolası (passphrase) hatalı' : 'Bu anahtar şifreli; parolasını (passphrase) girin')
    }
    throw new Error('Geçerli bir özel anahtar değil: ' + key.message)
  }
  return key
}

export function buildKey(name: string, privateKey: string, passphrase?: string): StoredSshKey {
  const key = parse(privateKey, passphrase)
  const pub = key.getPublicSSH()
  const safeName = name.replace(/\s+/g, '_')
  return {
    id: newId(),
    name,
    type: key.type,
    publicKey: `${key.type} ${pub.toString('base64')} ${safeName}`,
    fingerprint: 'SHA256:' + createHash('sha256').update(pub).digest('base64').replace(/=+$/, ''),
    createdAt: Date.now(),
    hasPassphrase: !!passphrase,
    privateKey: privateKey.trim() + '\n',
    passphrase: passphrase || undefined
  }
}

function generate(name: string, type: KeyType, bits: number | undefined, passphrase: string): VaultData {
  const opts: Record<string, unknown> = { comment: name }
  if (type !== 'ed25519') opts.bits = bits ?? (type === 'rsa' ? 4096 : 256)
  if (passphrase) {
    opts.passphrase = passphrase
    opts.cipher = 'aes256-ctr'
  }
  const pair = utils.generateKeyPairSync(type as never, opts as never) as { private: string; public: string }
  return addKey(buildKey(name, pair.private, passphrase))
}

async function pickFile(): Promise<{ name: string; content: string } | null> {
  const win = BrowserWindow.getAllWindows()[0]
  const res = await dialog.showOpenDialog(win, {
    title: 'Özel anahtar dosyası seç',
    defaultPath: path.join(os.homedir(), '.ssh'),
    properties: ['openFile', 'showHiddenFiles']
  })
  if (res.canceled || !res.filePaths[0]) return null
  const file = res.filePaths[0]
  const stat = fs.statSync(file)
  if (stat.size > 64 * 1024) throw new Error('Dosya bir anahtar için fazla büyük')
  return { name: path.basename(file), content: fs.readFileSync(file, 'utf8') }
}

async function exportPrivate(id: string): Promise<boolean> {
  const key = getKey(id)
  if (!key) return false
  const win = BrowserWindow.getAllWindows()[0]
  const res = await dialog.showSaveDialog(win, {
    title: 'Özel anahtarı dışa aktar',
    defaultPath: path.join(os.homedir(), key.name.replace(/[^\w.-]+/g, '_'))
  })
  if (res.canceled || !res.filePath) return false
  fs.writeFileSync(res.filePath, key.privateKey, { mode: 0o600 })
  fs.writeFileSync(res.filePath + '.pub', key.publicKey + '\n', { mode: 0o644 })
  return true
}

export function registerKeyIpc(): void {
  ipcMain.handle('keys:generate', (_e, name: string, type: KeyType, bits: number | undefined, passphrase: string) =>
    generate(name, type, bits, passphrase)
  )
  ipcMain.handle('keys:importText', (_e, name: string, privateKey: string, passphrase: string) =>
    addKey(buildKey(name, privateKey, passphrase))
  )
  ipcMain.handle('keys:pickFile', () => pickFile())
  ipcMain.handle('keys:rename', (_e, id: string, name: string) => renameKey(id, name))
  ipcMain.handle('keys:remove', (_e, id: string) => removeKey(id))
  ipcMain.handle('keys:exportPrivate', (_e, id: string) => exportPrivate(id))
}
