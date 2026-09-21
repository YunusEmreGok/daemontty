import { ipcMain, WebContents } from 'electron'
import { ClientChannel } from 'ssh2'
import { ServiceAction, ServiceKind, ServiceList } from '@shared/types'
import { Connection } from './connection'
import { connectionOf } from './terminal'

// Servis paneli: açık terminal oturumunun bağlantısı üzerinden systemd birimlerini ve Docker
// kapsayıcılarını listeler, başlatır/durdurur ve günlüklerini canlı izler. Ayrı bağlantı açılmaz.

/** Arayüz bu mesajı görünce sudo parolasını sorar ve işlemi parolayla yineler. */
export const SUDO_NEEDED = 'SUDO_PAROLASI_GEREKLI'

interface Priv {
  root?: boolean
  /** Yalnızca bellekte, oturum kapanana kadar */
  sudoPassword?: string
}
const priv = new WeakMap<Connection, Priv>()
const privOf = (c: Connection): Priv => priv.get(c) ?? (priv.set(c, {}), priv.get(c)!)

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

function exec(conn: Connection, cmd: string, stdin?: string, timeoutMs = 15000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.client.exec(cmd, (err, ch) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      let code = 0
      const timer = setTimeout(() => {
        ch.close()
        reject(new Error('Sunucu yanıt vermedi (zaman aşımı)'))
      }, timeoutMs)
      ch.on('data', (d: Buffer) => (stdout += d.toString()))
      ch.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
      ch.on('exit', (c: number | null) => (code = c ?? 0))
      ch.on('close', () => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
      if (stdin !== undefined) ch.end(stdin)
    })
  })
}

// Kabuğa giden her ad bu kalıptan geçer; tırnak ve boşluk içeremez (komut enjeksiyonuna karşı).
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.@:\\-]{0,200}$/
const ACTIONS: ServiceAction[] = ['start', 'stop', 'restart']

const needsPassword = (r: ExecResult): boolean => /password is required|a terminal is required|no tty present|askpass/i.test(r.stderr)
const wrongPassword = (r: ExecResult): boolean => /incorrect password|Sorry, try again|Authentication failure/i.test(r.stderr)
const denied = (r: ExecResult): boolean => /permission denied|Access denied|authentication is required|Interactive authentication required|not permitted/i.test(r.stderr + r.stdout)

/** Önce olduğu gibi, yetki yetmezse sudo ile çalıştırır. Parola gerekiyorsa SUDO_NEEDED fırlatır. */
async function runPrivileged(conn: Connection, cmd: string, password?: string): Promise<ExecResult> {
  const p = privOf(conn)
  p.root ??= (await exec(conn, 'id -u')).stdout.trim() === '0'
  if (p.root) return exec(conn, cmd)

  const plain = await exec(conn, cmd)
  if (plain.code === 0 || !denied(plain)) return plain

  const pw = password ?? p.sudoPassword
  if (pw === undefined) {
    const r = await exec(conn, `sudo -n ${cmd}`)
    if (needsPassword(r)) throw new Error(SUDO_NEEDED)
    return r
  }
  const r = await exec(conn, `sudo -S -p '' ${cmd}`, pw + '\n')
  if (wrongPassword(r) || needsPassword(r)) {
    p.sudoPassword = undefined
    throw new Error('sudo parolası hatalı')
  }
  p.sudoPassword = pw
  return r
}

const LIST_CMD =
  "systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null; echo '@@DOCKER@@'; " +
  "docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}' 2>&1"

async function list(conn: Connection): Promise<ServiceList> {
  const out = (await exec(conn, LIST_CMD)).stdout
  const [sys, dock = ''] = out.split('@@DOCKER@@')
  const systemd = sys
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 4 && c[0].endsWith('.service') && c[1] !== 'not-found')
    .map((c) => ({ name: c[0].replace(/\.service$/, ''), active: c[2], sub: c[3], description: c.slice(4).join(' ') }))
  const lines = dock.split('\n').filter((l) => l.trim())
  const dockerOk = lines.every((l) => l.split('\t').length === 4)
  return {
    systemd: sys.trim() ? systemd : null,
    docker: !lines.length ? [] : dockerOk ? lines.map((l) => l.split('\t')).map(([name, image, state, status]) => ({ name, image, state, status })) : null,
    // Docker kurulu ama kullanıcı docker grubunda değilse liste yerine izin hatası gelir.
    dockerDenied: !dockerOk && /permission denied/i.test(dock)
  }
}

const actionCmd = (kind: ServiceKind, name: string, action: ServiceAction): string =>
  kind === 'systemd' ? `systemctl ${action} ${name}.service` : `docker ${action} ${name}`

async function act(conn: Connection, kind: ServiceKind, name: string, action: ServiceAction, password?: string): Promise<void> {
  if (!NAME_RE.test(name) || !ACTIONS.includes(action)) throw new Error('Geçersiz servis adı ya da işlem')
  const r = await runPrivileged(conn, actionCmd(kind, name, action), password)
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').pop() || `İşlem başarısız (kod ${r.code})`)
}

// --- Canlı günlük ---

const streams = new Map<string, ClientChannel>()

function stopLogs(streamId: string): void {
  streams.get(streamId)?.close()
  streams.delete(streamId)
}

async function startLogs(wc: WebContents, conn: Connection, streamId: string, kind: ServiceKind, name: string, password?: string): Promise<void> {
  if (!NAME_RE.test(name)) throw new Error('Geçersiz servis adı')
  stopLogs(streamId)
  const p = privOf(conn)
  p.root ??= (await exec(conn, 'id -u')).stdout.trim() === '0'
  if (password !== undefined) p.sudoPassword = password
  const base = kind === 'systemd' ? `journalctl -u ${name}.service -n 200 -f --no-pager -o short-iso` : `docker logs --tail 200 -f ${name}`
  // Günlük okumak çoğu sistemde yetki ister; parola biliniyorsa sudo ile, yoksa olduğu gibi denenir.
  const useSudo = !p.root && p.sudoPassword !== undefined
  const cmd = useSudo ? `sudo -S -p '' ${base} 2>&1` : `${base} 2>&1`
  const ch = await new Promise<ClientChannel>((resolve, reject) => conn.client.exec(cmd, (err, c) => (err ? reject(err) : resolve(c))))
  streams.set(streamId, ch)
  if (useSudo) ch.write(p.sudoPassword + '\n')
  const send = (d: Buffer): void => {
    if (!wc.isDestroyed()) wc.send('svc:log', streamId, d.toString())
  }
  ch.on('data', send)
  ch.on('close', () => {
    if (streams.get(streamId) === ch) streams.delete(streamId)
    if (!wc.isDestroyed()) wc.send('svc:logEnd', streamId)
  })
}

export function registerServicesIpc(): void {
  const conn = (sessionId: string): Connection => {
    const c = connectionOf(sessionId)
    if (!c) throw new Error('Oturum bağlı değil')
    return c
  }
  ipcMain.handle('svc:list', (_e, sessionId: string) => list(conn(sessionId)))
  ipcMain.handle('svc:action', (_e, sessionId: string, kind: ServiceKind, name: string, action: ServiceAction, password?: string) =>
    act(conn(sessionId), kind, name, action, password)
  )
  ipcMain.handle('svc:logs', (e, sessionId: string, streamId: string, kind: ServiceKind, name: string, password?: string) =>
    startLogs(e.sender, conn(sessionId), streamId, kind, name, password)
  )
  ipcMain.on('svc:logsStop', (_e, streamId: string) => stopLogs(streamId))
}
