import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { autoUpdater } from 'electron-updater'
import { UpdateState } from '@shared/types'

// Güncellemeler GitHub Releases'tan gelir. Windows ve Linux (AppImage) kendini günceller.
// macOS'ta Squirrel imzalı uygulama ister; imzasız sürümde yalnızca haber verip indirme
// sayfasını açarız. deb kurulumu da paket yöneticisine ait olduğundan elle güncellenir.
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

function check(): void {
  if (!app.isPackaged) return setState({ status: 'error', message: 'Güncelleme denetimi yalnızca kurulu sürümde çalışır' })
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return
  setState({ status: 'checking' })
  autoUpdater.checkForUpdates().catch(() => {}) // hata 'error' olayıyla bildirilir
}

export function registerUpdateIpc(): void {
  autoUpdater.autoDownload = selfInstall
  autoUpdater.autoInstallOnAppQuit = selfInstall

  autoUpdater.on('update-not-available', () => setState({ status: 'current' }))
  autoUpdater.on('update-available', (info) =>
    setState(selfInstall ? { status: 'downloading', version: info.version, percent: 0 } : { status: 'available', version: info.version })
  )
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') setState({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => setState({ status: 'error', message: err.message.split('\n')[0] }))

  ipcMain.handle('update:version', () => app.getVersion())
  ipcMain.handle('update:state', () => state)
  ipcMain.on('update:check', check)
  ipcMain.on('update:install', () => state.status === 'ready' && autoUpdater.quitAndInstall())
  ipcMain.on('update:openDownload', () => {
    const url = releasesUrl()
    if (url) shell.openExternal(url)
  })

  if (app.isPackaged) {
    setTimeout(check, FIRST_CHECK_MS)
    setInterval(check, CHECK_EVERY_MS)
  }
}
