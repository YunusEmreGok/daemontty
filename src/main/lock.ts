import { app, BrowserWindow, ipcMain, powerMonitor, safeStorage, systemPreferences } from 'electron'
import fs from 'fs'
import path from 'path'
import { LockState } from '@shared/types'
import { checkMasterPassword, getSettings, hasMasterPassword, isSealed, setMasterPassword, unsealWithKey } from './vault'

// Uygulama kilidi. Ana parola kasayı diskte de şifreler (vault.ts); buradaki iş kilitliyken
// arayüzün ana sürece hiçbir şey yaptıramamasını sağlamak ve kilidi açıp kapamaktır.

/** Kilitliyken de çalışması gereken kanallar */
const OPEN_PREFIXES = ['lock:', 'update:']

let locked = false
let failures = 0
let onUnsealed: (() => void) | null = null

const touchKeyFile = (): string => path.join(app.getPath('userData'), 'unlock.key')
const touchIdAvailable = (): boolean => process.platform === 'darwin' && systemPreferences.canPromptTouchID() && safeStorage.isEncryptionAvailable()
const touchIdEnabled = (): boolean => touchIdAvailable() && fs.existsSync(touchKeyFile())

function state(): LockState {
  return { enabled: hasMasterPassword(), locked: locked || isSealed(), touchIdAvailable: touchIdAvailable(), touchId: touchIdEnabled() }
}

function broadcast(): void {
  const s = state()
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('lock:changed', s))
}

/** wasSealed: bu açılış, uygulama başlarken parola bekleyen kasayı mı çözdü? */
function opened(wasSealed: boolean): void {
  locked = false
  failures = 0
  broadcast()
  if (wasSealed && onUnsealed) {
    onUnsealed()
    onUnsealed = null
  }
}

function lockNow(): void {
  if (!hasMasterPassword() || locked || isSealed()) return
  locked = true
  broadcast()
}

/** Anahtarı işletim sisteminin anahtar zinciriyle sarıp saklar; Touch ID onayından sonra okunur. */
function storeTouchKey(key: Buffer | null): void {
  if (key && touchIdAvailable()) fs.writeFileSync(touchKeyFile(), safeStorage.encryptString(key.toString('base64')), { mode: 0o600 })
  else fs.rmSync(touchKeyFile(), { force: true })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * ipcMain'i sarar: kilitliyken izinli olmayan her çağrı reddedilir. Diğer modüller kaydolmadan ÖNCE
 * çağrılmalıdır; böylece tek tek her işleyiciye denetim eklemek (ve birini unutmak) gerekmez.
 */
export function installLockGate(): void {
  const blocked = (channel: string): boolean => (locked || isSealed()) && !OPEN_PREFIXES.some((p) => channel.startsWith(p))
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    handle(channel, (e, ...args) => {
      if (blocked(channel)) throw new Error('Uygulama kilitli')
      return listener(e, ...args)
    })
  const on = ipcMain.on.bind(ipcMain)
  ipcMain.on = (channel, listener) =>
    on(channel, (e, ...args) => {
      if (!blocked(channel)) listener(e, ...args)
    })
}

/** afterUnseal: açılışta parola bekleyen kasa çözülünce bir kez çağrılır (ör. otomatik tüneller). */
export function registerLockIpc(afterUnseal: () => void): void {
  if (isSealed()) onUnsealed = afterUnseal

  ipcMain.handle('lock:state', () => state())
  ipcMain.handle('lock:unlock', async (_e, password: string) => {
    if (failures) await sleep(Math.min(failures * 700, 5000)) // kaba kuvvet denemelerini yavaşlat
    const wasSealed = isSealed()
    const key = checkMasterPassword(String(password))
    if (!key) {
      failures++
      return false
    }
    opened(wasSealed)
    return true
  })
  ipcMain.handle('lock:touchId', async () => {
    if (!touchIdEnabled()) return false
    try {
      await systemPreferences.promptTouchID('Daemontty kilidini açmak')
      const key = Buffer.from(safeStorage.decryptString(fs.readFileSync(touchKeyFile())), 'base64')
      const wasSealed = isSealed()
      if (!unsealWithKey(key)) return false
      opened(wasSealed)
      return true
    } catch {
      return false // iptal edildi ya da parmak izi tanınmadı
    }
  })
  ipcMain.on('lock:now', lockNow)

  // Aşağıdakiler kilit açıkken çağrılır; yine de mevcut parolayı doğrularız.
  ipcMain.handle('lock:setPassword', (_e, next: string, current: string | null) => {
    if (hasMasterPassword() && !checkMasterPassword(String(current ?? ''))) throw new Error('Mevcut parola hatalı')
    if (String(next).length < 6) throw new Error('Parola en az 6 karakter olmalı')
    const key = setMasterPassword(String(next))
    if (touchIdEnabled()) storeTouchKey(key) // anahtar değişti
    broadcast()
  })
  ipcMain.handle('lock:disable', (_e, current: string) => {
    if (!checkMasterPassword(String(current))) throw new Error('Parola hatalı')
    setMasterPassword(null)
    storeTouchKey(null)
    broadcast()
  })
  ipcMain.handle('lock:setTouchId', (_e, on: boolean, current: string) => {
    const key = checkMasterPassword(String(current))
    if (!key) throw new Error('Parola hatalı')
    storeTouchKey(on ? key : null)
    broadcast()
  })

  // Boşta kalınca ve bilgisayar kilitlenince/uyuyunca kilitle.
  setInterval(() => {
    const minutes = getSettings().lockAfterMinutes
    if (minutes > 0 && powerMonitor.getSystemIdleTime() >= minutes * 60) lockNow()
  }, 10_000)
  powerMonitor.on('lock-screen', lockNow)
  powerMonitor.on('suspend', lockNow)
}

export { lockNow }
