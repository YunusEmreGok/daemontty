import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { autoUpdater } from 'electron-updater'
import { UpdateState } from '@shared/types'

// Güncellemeler GitHub Releases'tan gelir. Hiçbir şey kendiliğinden indirilmez: yeni sürüm
// bulununca kullanıcıya sorulur. Windows ve Linux (AppImage) onaydan sonra kendini günceller.
// macOS'ta Squirrel imzalı uygulama ister; imzasız sürümde indirme sayfasını açarız.
// deb kurulumu da paket yöneticisine ait olduğundan elle güncellenir.
const selfInstall = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)

const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }

function setState(s: UpdateState): void {
  state = s
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update:state', s))
}

/** electron-builder'ın pakete koyduğu app-update.yml'den depo adresi. */
function releasesUrl(): string | null {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = yml.match(/^owner:\s*(\S+)/m)?.[1]
    const repo = yml.match(/^repo:\s*(\S+)/m)?.[1]
    return owner && repo ? `https://github.com/${owner}/${repo}/releases/latest` : null
  } catch {
    return null
  }
}

function download(): void {
  if (state.status !== 'available') return
  if (state.manual) {
    const url = releasesUrl()
    if (url) shell.openExternal(url)
    return
  }
  setState({ status: 'downloading', version: state.version, percent: 0 })
  autoUpdater.downloadUpdate().catch(() => {}) // hata 'error' olayıyla bildirilir
}

function check(): void {
  if (!app.isPackaged) return setState({ status: 'error', message: 'Güncelleme denetimi yalnızca kurulu sürümde çalışır' })
  // Bulunmuş ya da inmekte olan sürümün durumunu yeni bir denetimle ezme.
  if (state.status !== 'idle' && state.status !== 'current' && state.status !== 'error') return
  setState({ status: 'checking' })
  autoUpdater.checkForUpdates().catch(() => {}) // hata 'error' olayıyla bildirilir
}

export function registerUpdateIpc(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true // yalnızca kullanıcının indirdiği sürüm için geçerli

  autoUpdater.on('update-not-available', () => setState({ status: 'current' }))
  autoUpdater.on('update-available', (info) => setState({ status: 'available', version: info.version, manual: !selfInstall }))
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') setState({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => setState({ status: 'error', message: err.message.split('\n')[0] }))

  ipcMain.handle('update:version', () => app.getVersion())
  ipcMain.handle('update:state', () => state)
  ipcMain.on('update:check', check)
  ipcMain.on('update:install', () => state.status === 'ready' && autoUpdater.quitAndInstall())
  ipcMain.on('update:download', download)

  // Geliştirmede arayüzü denemek için: DAEMONTTY_FAKE_UPDATE=9.9.9 npm run dev
  const fake = !app.isPackaged && process.env.DAEMONTTY_FAKE_UPDATE
  if (fake) setTimeout(() => setState({ status: 'available', version: fake, manual: true }), 1500)

  if (app.isPackaged) {
    setTimeout(check, FIRST_CHECK_MS)
    setInterval(check, CHECK_EVERY_MS)
  }
}
