import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { Collection, Settings } from '@shared/types'
import { flushHistory, loadVault, onVaultChange, publicView, remove, saveSettings, upsert } from './vault'
import { closeAllTerminals, registerTerminalIpc } from './terminal'
import { closeAllSftp, registerSftpIpc } from './sftp'
import { registerForwardIpc, startAutoForwards, stopAllForwards } from './forwarding'
import { registerKeyIpc } from './keys'
import { importSshConfig } from './sshconfig'
import { registerBackupIpc } from './backup'
import { registerProbeIpc } from './probe'
import { registerUpdateIpc } from './updater'
import { registerSessionLogIpc } from './sessionlog'
import { installLockGate, lockNow, registerLockIpc } from './lock'
import { isSealed } from './vault'
import './prompt'

app.setName('Daemontty')

// Windows'ta görev çubuğunda ve bildirimlerde özel ikonun doğru görünmesi için:
if (process.platform === 'win32') {
  app.setAppUserModelId('com.daemontty.app')
}

// Testlerde ve geliştirmede ayrı bir veri klasörü kullanabilmek için.
const customUserData = process.env.DAEMONTTY_USER_DATA || process.env.WCET_USER_DATA || process.env.KABUK_USER_DATA
if (customUserData) app.setPath('userData', customUserData)

function getAppIconPath(): string {
  const isWin = process.platform === 'win32'
  const preferredFiles = isWin ? ['icon.ico', 'icon.png'] : ['icon.png', 'icon.icns']
  const searchDirs = [
    path.join(__dirname, '../../resources'),
    path.join(process.resourcesPath, 'resources'),
    path.join(process.resourcesPath),
    path.join(app.getAppPath(), 'resources'),
    path.join(app.getAppPath())
  ]

  for (const dir of searchDirs) {
    for (const f of preferredFiles) {
      const full = path.join(dir, f)
      if (fs.existsSync(full)) return full
    }
  }
  return path.join(__dirname, '../../resources', isWin ? 'icon.ico' : 'icon.png')
}

function createWindow(): BrowserWindow {
  const iconPath = getAppIconPath()
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: 'Daemontty',
    icon: iconPath,
    backgroundColor: '#12141a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (process.platform === 'win32') {
    win.setIcon(iconPath)
  }
  win.once('ready-to-show', () => win.show())

  // Terminaldeki bağlantılar uygulama içinde değil tarayıcıda açılsın.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Daemontty',
            submenu: [
              { role: 'about' as const, label: 'Daemontty Hakkında' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Daemontty’i Gizle' },
              { role: 'hideOthers' as const, label: 'Diğerlerini Gizle' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Daemontty’den Çık' }
            ]
          }
        ]
      : []),
    {
      label: 'Düzen',
      submenu: [
        { role: 'undo', label: 'Geri Al' },
        { role: 'redo', label: 'Yinele' },
        { type: 'separator' },
        { role: 'cut', label: 'Kes' },
        { role: 'copy', label: 'Kopyala' },
        { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü Seç' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload', label: 'Yeniden Yükle' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam Ekran' }
      ]
    },
    {
      label: 'Pencere',
      submenu: [
        { role: 'minimize', label: 'Küçült' },
        { role: 'zoom', label: 'Yakınlaştır' },
        { label: 'Şimdi Kilitle', accelerator: 'CmdOrCtrl+Shift+L', click: () => lockNow() },
        ...(isMac ? [] : [{ role: 'close' as const, label: 'Kapat' }])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerVaultIpc(): void {
  ipcMain.handle('vault:get', () => publicView())
  ipcMain.handle('vault:upsert', (_e, c: Collection, item: { id: string }) => upsert(c, item))
  ipcMain.handle('vault:remove', (_e, c: Collection, id: string) => remove(c, id))
  ipcMain.handle('vault:settings', (_e, s: Settings) => saveSettings(s))
  ipcMain.handle('sshconfig:import', () => importSshConfig())
  onVaultChange((d) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('vault:changed', d)))
}

app.whenReady().then(() => {
  try {
    loadVault()
  } catch (err) {
    dialog.showErrorBox(
      'Kasa açılamadı',
      `Kayıtlı veriler okunamadı: ${(err as Error).message}\n\nUygulama boş bir kasa ile açılacak.`
    )
  }
  buildMenu()
  installLockGate() // diğer IPC kayıtlarından önce
  registerLockIpc(startAutoForwards)
  registerVaultIpc()
  registerTerminalIpc()
  registerSftpIpc()
  registerForwardIpc()
  registerKeyIpc()
  registerBackupIpc()
  registerProbeIpc()
  registerUpdateIpc()
  registerSessionLogIpc()
  // Paketli sürümde dock ikonu uygulama paketinden gelir; 1024px PNG'yi belleğe açmaya gerek yok.
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    try {
      app.dock.setIcon(getAppIconPath())
    } catch {
      // dock icon setting fallback
    }
  }
  createWindow()
  if (!isSealed()) startAutoForwards() // kasa parola bekliyorsa kilit açılınca başlar

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  flushHistory()
  closeAllTerminals()
  closeAllSftp()
  stopAllForwards()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
