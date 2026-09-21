import { BrowserWindow, dialog } from 'electron'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Client, ConnectConfig, utils } from 'ssh2'
import { Host } from '@shared/types'
import { getHost, getIdentity, getKey, getKnownHost, getSettings, setKnownHost } from './vault'
import { askUser } from './prompt'

export interface Connection {
  client: Client
  host: Host
  /** Bağlantıyı ve varsa atlama (jump) bağlantılarını kapatır. */
  dispose(): void
}

type StatusFn = (message: string) => void

const MAX_JUMP_DEPTH = 5

function fingerprintOf(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

async function verifyHostKey(host: Host, key: Buffer): Promise<boolean> {
  const id = `${host.address}:${host.port}`
  const fp = fingerprintOf(key)
  const known = getKnownHost(id)
  if (known === fp) return true

  const win = BrowserWindow.getAllWindows()[0]
  const options = known
    ? {
        type: 'warning' as const,
        title: 'Sunucu anahtarı değişti!',
        message: `${host.label} (${id}) sunucusunun anahtarı DEĞİŞMİŞ.`,
        detail:
          `Bu, ortadaki adam (MITM) saldırısı olabilir ya da sunucu yeniden kurulmuş olabilir.\n\n` +
          `Kayıtlı parmak izi:\n${known}\n\nYeni parmak izi:\n${fp}\n\nYine de bağlanmak istiyor musunuz?`,
        buttons: ['Bağlanma', 'Yeni anahtarı kabul et ve bağlan'],
        defaultId: 0,
        cancelId: 0
      }
    : {
        type: 'question' as const,
        title: 'Bilinmeyen sunucu',
        message: `${host.label} (${id}) sunucusuna ilk kez bağlanıyorsunuz.`,
        detail: `Sunucu parmak izi:\n${fp}\n\nBu sunucuya güveniyor musunuz?`,
        buttons: ['İptal', 'Güven ve bağlan'],
        defaultId: 1,
        cancelId: 0
      }
  const res = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  if (res.response === 1) {
    setKnownHost(id, fp)
    return true
  }
  return false
}

interface Credentials {
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
}

function resolveCredentials(host: Host): Credentials {
  const identity = host.identityId ? getIdentity(host.identityId) : undefined
  const username = identity?.username || host.username || ''
  const password = identity ? identity.password : host.password
  const keyId = identity ? identity.keyId : host.keyId
  const key = keyId ? getKey(keyId) : undefined
  return { username, password: password || undefined, privateKey: key?.privateKey, passphrase: key?.passphrase }
}

// --- Sistem anahtarları (OpenSSH'in varsayılan davranışı) ---

const DEFAULT_KEY_FILES = ['id_ed25519', 'id_ecdsa', 'id_rsa']
/** Oturum boyunca girilen anahtar parolaları (sadece bellekte, diske yazılmaz) */
const passphraseCache = new Map<string, string>()

function agentSocket(): string | undefined {
  const sock = process.env.SSH_AUTH_SOCK
  return sock && fs.existsSync(sock) ? sock : undefined
}

interface KeyAttempt {
  label: string
  key: string
  passphrase?: string
}

/** ~/.ssh/id_* dosyalarını okur; şifreliyse parolasını sorar (iptal edilirse atlanır). */
async function defaultKeyAttempts(host: Host): Promise<KeyAttempt[]> {
  const out: KeyAttempt[] = []
  for (const name of DEFAULT_KEY_FILES) {
    const file = path.join(os.homedir(), '.ssh', name)
    let key: string
    try {
      if (fs.statSync(file).size > 64 * 1024) continue
      key = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const parsed = utils.parseKey(key)
    if (!(parsed instanceof Error)) {
      out.push({ label: `~/.ssh/${name}`, key })
      continue
    }
    if (!/encrypted|passphrase/i.test(parsed.message)) continue
    let passphrase = passphraseCache.get(file)
    while (!passphrase) {
      const v = await askUser(
        `~/.ssh/${name} anahtarının parolası`,
        [{ label: 'Anahtar parolası (passphrase)', secret: true }],
        `${host.label} sunucusu için bu anahtar denenecek. Atlamak için İptal'e basın.`
      )
      if (!v || !v[0]) break
      if (utils.parseKey(key, v[0]) instanceof Error) continue // yanlış parola: tekrar sor
      passphrase = v[0]
      passphraseCache.set(file, passphrase)
    }
    if (passphrase) out.push({ label: `~/.ssh/${name}`, key, passphrase })
  }
  return out
}

function connectOnce(host: Host, sock: ConnectConfig['sock'], status: StatusFn): Promise<Client> {
  return new Promise(async (resolve, reject) => {
    let creds = resolveCredentials(host)
    if (!creds.username) {
      const v = await askUser(`${host.label}: kullanıcı adı`, [{ label: 'Kullanıcı adı', secret: false }])
      if (!v || !v[0]) return reject(new Error('Bağlantı iptal edildi'))
      creds = { ...creds, username: v[0] }
    }

    const client = new Client()
    let settled = false
    let askedPassword = false

    client.on('ready', () => {
      settled = true
      resolve(client)
    })
    client.on('error', (err) => {
      if (!settled) {
        settled = true
        reject(translateError(err))
      }
    })
    let triedKey = false
    let triedPassword = false
    let triedKbd = false
    // Host'a anahtar atanmamışsa, `ssh` komutu gibi ssh-agent'ı ve ~/.ssh/id_* dosyalarını dene.
    // Anahtar atanmışsa sadece o denenir (sunucunun deneme sınırına takılmamak için).
    const useSystemKeys = !creds.privateKey && getSettings().useSystemKeys
    const agent = agentSocket()
    let triedAgent = !useSystemKeys || !agent
    let systemKeys: KeyAttempt[] | null = useSystemKeys ? null : []

    const keyboardInteractive = async (
      _name: string,
      instructions: string,
      _lang: string,
      prompts: Array<{ prompt: string; echo?: boolean }>,
      finish: (answers: string[]) => void
    ): Promise<void> => {
      // Kayıtlı parola varsa ve tek soru parolaysa onu kullan.
      if (creds.password && prompts.length === 1 && /password|parola|şifre/i.test(prompts[0].prompt)) {
        return finish([creds.password])
      }
      if (prompts.length === 0) return finish([])
      const answers = await askUser(
        `${host.label}: doğrulama`,
        prompts.map((p) => ({ label: p.prompt.trim(), secret: !p.echo })),
        instructions || undefined
      )
      finish(answers ?? prompts.map(() => ''))
    }

    status(`${creds.username}@${host.address}:${host.port} adresine bağlanılıyor…`)

    const config: ConnectConfig = {
      host: host.address,
      port: host.port || 22,
      username: creds.username,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
      tryKeyboard: true,
      sock,
      // Ajan yönlendirme: sunucudan başka sunuculara yerel anahtarlarla geçebilmek için
      ...(host.agentForward && agent ? { agent, agentForward: true } : {}),
      hostVerifier: ((key: Buffer, verify: (ok: boolean) => void) => {
        status('Sunucu anahtarı doğrulanıyor…')
        verifyHostKey(host, key).then(verify, () => verify(false))
      }) as unknown as ConnectConfig['hostVerifier'],
      // Sırayla dene: anahtar, parola, klavye etkileşimli; parola yoksa sor.
      authHandler: (methodsLeft, _partial, next) => {
        void (async () => {
          const allowed = methodsLeft ?? ['publickey', 'password', 'keyboard-interactive']
          if (!triedKey && creds.privateKey && allowed.includes('publickey')) {
            triedKey = true
            status('Anahtar ile kimlik doğrulanıyor…')
            return next({
              type: 'publickey',
              username: creds.username,
              key: creds.privateKey,
              passphrase: creds.passphrase
            } as never)
          }
          if (!triedAgent && allowed.includes('publickey')) {
            triedAgent = true
            status('ssh-agent ile kimlik doğrulanıyor…')
            return next({ type: 'agent', username: creds.username, agent } as never)
          }
          if (allowed.includes('publickey')) {
            systemKeys ??= await defaultKeyAttempts(host)
            const k = systemKeys.shift()
            if (k) {
              status(`${k.label} anahtarı deneniyor…`)
              return next({ type: 'publickey', username: creds.username, key: k.key, passphrase: k.passphrase } as never)
            }
          }
          if (!triedPassword && allowed.includes('password')) {
            triedPassword = true
            let password = creds.password
            if (!password && !askedPassword) {
              askedPassword = true
              const v = await askUser(`${creds.username}@${host.address}`, [{ label: 'Parola', secret: true }])
              password = v?.[0]
            }
            if (password) {
              status('Parola ile kimlik doğrulanıyor…')
              return next({ type: 'password', username: creds.username, password })
            }
          }
          if (!triedKbd && allowed.includes('keyboard-interactive')) {
            triedKbd = true
            return next({ type: 'keyboard-interactive', username: creds.username, prompt: keyboardInteractive } as never)
          }
          next(false as never)
        })()
      }
    }

    try {
      client.connect(config)
      // Etkileşimli oturumda her tuş hemen gitsin (Nagle kapalı); OpenSSH de böyle yapar.
      client.setNoDelay(true)
    } catch (err) {
      settled = true
      reject(translateError(err as Error))
    }
  })
}

function translateError(err: Error & { level?: string; code?: string }): Error {
  const m = err.message || String(err)
  let tr = m
  if (err.level === 'client-authentication' || /All configured authentication methods failed/i.test(m)) {
    tr = 'Kimlik doğrulama başarısız (kullanıcı adı, parola veya anahtar hatalı)'
  } else if (err.code === 'ECONNREFUSED') tr = 'Bağlantı reddedildi (port kapalı olabilir)'
  else if (err.code === 'ENOTFOUND') tr = 'Sunucu adresi bulunamadı'
  else if (err.code === 'ETIMEDOUT' || /Timed out/i.test(m)) tr = 'Bağlantı zaman aşımına uğradı'
  else if (err.code === 'EHOSTUNREACH') tr = 'Sunucuya ulaşılamıyor'
  else if (err.code === 'ECONNRESET') tr = 'Bağlantı sunucu tarafından sıfırlandı'
  else if (/host key verification|Host denied/i.test(m)) tr = 'Sunucu anahtarı reddedildi'
  else if (/Encrypted private (OpenSSH )?key detected|passphrase/i.test(m))
    tr = 'Özel anahtar şifreli; parola (passphrase) hatalı ya da eksik'
  else if (/Cannot parse privateKey/i.test(m)) tr = 'Özel anahtar okunamadı'
  const e = new Error(tr)
  ;(e as Error & { cause?: unknown }).cause = err
  return e
}

/** Host'a (gerekirse jump host'lar üzerinden) bağlanır. */
export async function connect(hostId: string, status: StatusFn = () => {}, depth = 0): Promise<Connection> {
  const host = getHost(hostId)
  if (!host) throw new Error('Host bulunamadı')
  if (depth > MAX_JUMP_DEPTH) throw new Error('Jump host zinciri çok uzun (döngü olabilir)')

  let jump: Connection | undefined
  let sock: ConnectConfig['sock']
  if (host.jumpHostId) {
    jump = await connect(host.jumpHostId, (m) => status(`[${getHost(host.jumpHostId!)?.label ?? 'jump'}] ${m}`), depth + 1)
    status(`${jump.host.label} üzerinden ${host.address}:${host.port} tüneli açılıyor…`)
    sock = await new Promise<NonNullable<ConnectConfig['sock']>>((resolve, reject) => {
      jump!.client.forwardOut('127.0.0.1', 0, host.address, host.port || 22, (err, stream) =>
        err ? reject(new Error(`Jump host tüneli açılamadı: ${err.message}`)) : resolve(stream)
      )
    }).catch((err) => {
      jump!.dispose()
      throw err
    })
  }

  try {
    const client = await connectOnce(host, sock, status)
    return {
      client,
      host,
      dispose: () => {
        client.end()
        jump?.dispose()
      }
    }
  } catch (err) {
    jump?.dispose()
    throw err
  }
}
