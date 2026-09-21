import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { UpdateState } from '@shared/types'

// Güncellemeler GitHub Releases'tan gelir. Hiçbir şey kendiliğinden indirilmez: yeni sürüm
// bulununca kullanıcıya sorulur.
// - Windows ve Linux (AppImage): electron-updater indirir ve kurar.
// - macOS: Squirrel imzalı uygulama ister, bizimki imzasız. Bu yüzden zip'i kendimiz indirir,
//   sha512'sini doğrular, açar ve çıkışta .app klasörünü yenisiyle değiştiririz (macBundle).
// - deb ya da yazılamayan konum: paket yöneticisine/kullanıcıya ait; indirme sayfasını açarız.
const builtinInstall = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)

const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }
let found: UpdateInfo | null = null
/** macOS: indirilip açılmış, yerine konmayı bekleyen yeni .app */
let macStaged: string | null = null

function setState(s: UpdateState): void {
  state = s
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update:state', s))
}

/** electron-builder'ın pakete koyduğu app-update.yml'den depo adresi. */
function repoUrl(): string | null {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = yml.match(/^owner:\s*(\S+)/m)?.[1]
    const repo = yml.match(/^repo:\s*(\S+)/m)?.[1]
    return owner && repo ? `https://github.com/${owner}/${repo}` : null
  } catch {
    return null
  }
}

/** Çalışan .app klasörü; yerinde değiştirilebiliyorsa. Salt okunur DMG'den ya da karantina kopyasından çalışıyorsa null. */
function macBundle(): string | null {
  if (process.platform !== 'darwin') return null
  const bundle = path.resolve(app.getPath('exe'), '../../..')
  if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/')) return null
  try {
    fs.accessSync(bundle, fs.constants.W_OK)
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK)
    return bundle
  } catch {
    return null
  }
}

function macZip(info: UpdateInfo): UpdateInfo['files'][number] | undefined {
  const zips = info.files.filter((f) => f.url.endsWith('.zip'))
  return zips.find((f) => f.url.includes('arm64') === (process.arch === 'arm64'))
}

const canInstall = (info: UpdateInfo): boolean => builtinInstall || (!!macBundle() && !!macZip(info) && !!repoUrl())

async function macDownload(info: UpdateInfo): Promise<void> {
  const file = macZip(info)!
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemontty-update-'))
  const zip = path.join(dir, 'update.zip')
  const res = await net.fetch(`${repoUrl()}/releases/download/v${info.version}/${file.url}`)
  if (!res.ok || !res.body) throw new Error(`İndirilemedi (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || file.size || 0
  const hash = createHash('sha512')
  const out = fs.createWriteStream(zip)
  let done = 0
  let shown = -1
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk)
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
    done += chunk.length
    const percent = total ? Math.floor((done / total) * 100) : 0
    if (percent !== shown) setState({ status: 'downloading', version: info.version, percent: (shown = percent) })
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  if (hash.digest('base64') !== file.sha512) throw new Error('İndirilen dosya doğrulanamadı (sha512 uyuşmuyor)')

  // ditto, unzip'in aksine .app içindeki sembolik bağları ve izinleri korur.
  await new Promise<void>((resolve, reject) => execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], (err) => (err ? reject(err) : resolve())))
  fs.rmSync(zip)
  const appName = fs.readdirSync(dir).find((n) => n.endsWith('.app'))
  if (!appName) throw new Error('Güncelleme paketinde uygulama bulunamadı')
  macStaged = path.join(dir, appName)
}

/** Uygulama kapanınca eski .app'i yenisiyle değiştirir; takas başarısız olursa eskisini geri koyar. */
function macSwapOnExit(relaunch: boolean): void {
  const bundle = macBundle()
  if (!macStaged || !bundle) return
  const script =
    'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; ' +
    'mv "$2" "$2.old" && { mv "$3" "$2" && rm -rf "$2.old" || mv "$2.old" "$2"; }; ' +
    'rmdir "$(dirname "$3")" 2>/dev/null; ' +
    '[ "$4" = 1 ] && open "$2"'
  spawn('/bin/sh', ['-c', script, 'sh', String(process.pid), bundle, macStaged, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref()
  macStaged = null
}

function download(): void {
  if (state.status !== 'available' || !found) return
  const info = found
  if (state.manual) {
    const url = repoUrl()
    if (url) shell.openExternal(`${url}/releases/latest`)
    return
  }
  setState({ status: 'downloading', version: info.version, percent: 0 })
  if (builtinInstall) {
    autoUpdater.downloadUpdate().catch(() => {}) // hata 'error' olayıyla bildirilir
    return
  }
  macDownload(info).then(
    () => setState({ status: 'ready', version: info.version }),
    (err: Error) => setState({ status: 'error', message: err.message })
  )
}

function install(): void {
  if (state.status !== 'ready') return
  if (builtinInstall) return autoUpdater.quitAndInstall()
  macSwapOnExit(true)
  app.quit()
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
  autoUpdater.on('update-available', (info) => {
    found = info
    setState({ status: 'available', version: info.version, manual: !canInstall(info) })
  })
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') setState({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => setState({ status: 'error', message: err.message.split('\n')[0] }))

  ipcMain.handle('update:version', () => app.getVersion())
  ipcMain.handle('update:state', () => state)
  ipcMain.on('update:check', check)
  ipcMain.on('update:install', install)
  ipcMain.on('update:download', download)
  // macOS: "şimdi değil" dendiyse indirilen sürüm çıkışta sessizce yerine konur.
  app.on('will-quit', () => macSwapOnExit(false))

  // Geliştirmede arayüzü denemek için: DAEMONTTY_FAKE_UPDATE=9.9.9 npm run dev
  const fake = !app.isPackaged && process.env.DAEMONTTY_FAKE_UPDATE
  if (fake) setTimeout(() => setState({ status: 'available', version: fake, manual: true }), 1500)

  if (app.isPackaged) {
    setTimeout(check, FIRST_CHECK_MS)
    setInterval(check, CHECK_EVERY_MS)
  }
}
