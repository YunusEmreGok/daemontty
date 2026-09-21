import { BrowserWindow, dialog, ipcMain } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { BackupSummary } from '@shared/types'
import { BackupPayload, exportVault, importVault, summarize } from './vault'

// Yedek dosyası: parola scrypt ile anahtara çevrilir, içerik AES-256-GCM ile şifrelenir.
// GCM etiketi sayesinde yanlış parola ya da bozulmuş dosya kesin olarak tespit edilir.
const FORMAT = 'daemontty-yedek'
const LEGACY_FORMATS = ['wcet-yedek', 'kabuk-yedek']
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

interface BackupFile {
  format: typeof FORMAT
  version: 1
  createdAt: number
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string }
  cipher: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

function deriveKey(password: string, salt: Buffer, p = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFC'), salt, 32, { N: p.N, r: p.r, p: p.p, maxmem: SCRYPT.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

async function encrypt(payload: BackupPayload, password: string): Promise<BackupFile> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(password, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    format: FORMAT,
    version: 1,
    createdAt: Date.now(),
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

async function decrypt(file: string, password: string): Promise<{ payload: Partial<BackupPayload>; createdAt: number }> {
  let f: BackupFile
  try {
    f = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error('Bu dosya bir Daemontty yedeği değil')
  }
  if ((f.format !== FORMAT && !LEGACY_FORMATS.includes(f.format)) || f.version !== 1 || f.cipher !== 'aes-256-gcm') {
    throw new Error('Bu dosya bir Daemontty yedeği değil ya da sürümü desteklenmiyor')
  }
  const key = await deriveKey(password, Buffer.from(f.kdf.salt, 'base64'), { ...SCRYPT, N: f.kdf.N, r: f.kdf.r, p: f.kdf.p })
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'))
    d.setAuthTag(Buffer.from(f.tag, 'base64'))
    const json = Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]).toString('utf8')
    return { payload: JSON.parse(json), createdAt: f.createdAt }
  } catch {
    throw new Error('Parola hatalı ya da dosya bozulmuş')
  }
}

function win(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

async function exportBackup(password: string): Promise<string | null> {
  if (password.length < 8) throw new Error('Yedek parolası en az 8 karakter olmalı')
  const date = new Date().toISOString().slice(0, 10)
  const res = await dialog.showSaveDialog(win()!, {
    title: 'Şifreli yedeği kaydet',
    defaultPath: path.join(os.homedir(), 'Documents', `daemontty-yedek-${date}.daemontty`),
    filters: [{ name: 'Daemontty yedeği', extensions: ['daemontty', 'wcet', 'kabuk'] }]
  })
  if (res.canceled || !res.filePath) return null
  const file = await encrypt(exportVault(), password)
  fs.writeFileSync(res.filePath, JSON.stringify(file), { mode: 0o600 })
  return res.filePath
}

async function pickFile(): Promise<string | null> {
  const res = await dialog.showOpenDialog(win()!, {
    title: 'Yedek dosyası seç',
    defaultPath: path.join(os.homedir(), 'Documents'),
    filters: [{ name: 'Daemontty yedeği', extensions: ['daemontty', 'wcet', 'kabuk'] }],
    properties: ['openFile']
  })
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

async function inspect(file: string, password: string): Promise<BackupSummary> {
  const { payload, createdAt } = await decrypt(file, password)
  return summarize(payload, createdAt)
}

async function doImport(file: string, password: string, mode: 'merge' | 'replace'): Promise<BackupSummary> {
  const { payload, createdAt } = await decrypt(file, password)
  importVault(payload, mode)
  return summarize(payload, createdAt)
}

export function registerBackupIpc(): void {
  ipcMain.handle('backup:export', (_e, password: string) => exportBackup(password))
  ipcMain.handle('backup:pickFile', () => pickFile())
  ipcMain.handle('backup:inspect', (_e, file: string, password: string) => inspect(file, password))
  ipcMain.handle('backup:import', (_e, file: string, password: string, mode: 'merge' | 'replace') => doImport(file, password, mode))
}
