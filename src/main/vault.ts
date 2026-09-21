import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  BackupSummary,
  Collection,
  KnownHost,
  DEFAULT_SETTINGS,
  Group,
  HistoryEntry,
  Host,
  Identity,
  PortForward,
  Settings,
  Snippet,
  StoredSshKey,
  VaultData
} from '@shared/types'

interface StoredVault {
  groups: Group[]
  hosts: Host[]
  keys: StoredSshKey[]
  identities: Identity[]
  snippets: Snippet[]
  forwards: PortForward[]
  settings: Settings
  /** "adres:port" -> SHA256 parmak izi */
  knownHosts: Record<string, string>
  /** host kimliği -> komut geçmişi (otomatik tamamlama için) */
  history: Record<string, HistoryEntry[]>
}

const EMPTY: StoredVault = {
  groups: [],
  hosts: [],
  keys: [],
  identities: [],
  snippets: [],
  forwards: [],
  settings: DEFAULT_SETTINGS,
  knownHosts: {},
  history: {}
}

// Şifreli dosyanın başına konan işaret; düz JSON'dan ayırt etmek için.
const MAGIC = Buffer.from('KBK1')

// Ana parola konmuşsa dosya bir de paroladan türetilen anahtarla sarılır:
// KBK2 | salt(16) | iv(12) | etiket(16) | AES-256-GCM(iç veri). İç veri eski biçimdir (KBK1… ya da düz JSON).
const MAGIC2 = Buffer.from('KBK2')
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

let vault: StoredVault = structuredClone(EMPTY)
/** Ana parola anahtarı; kilit açıkken bellekte tutulur (kaydetmek için gerekir). */
let masterKey: Buffer | null = null
let masterSalt: Buffer | null = null
/** Parola girilene kadar çözülemeyen kasa dosyası. Doluyken diske ASLA yazılmaz (üzerine boş kasa yazmamak için). */
let sealed: Buffer | null = null
let listeners: Array<(d: VaultData) => void> = []

function vaultPath(): string {
  return path.join(app.getPath('userData'), 'vault.dat')
}

export function canEncrypt(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function loadVault(): void {
  const file = vaultPath()
  if (!fs.existsSync(file)) return
  const raw = fs.readFileSync(file)
  if (raw.subarray(0, MAGIC2.length).equals(MAGIC2)) {
    sealed = raw
    return
  }
  parseVault(raw, file)
}

function parseVault(raw: Buffer, file: string): void {
  let parsed: Partial<StoredVault>
  try {
    const json = raw.subarray(0, MAGIC.length).equals(MAGIC)
      ? safeStorage.decryptString(raw.subarray(MAGIC.length))
      : raw.toString('utf8')
    parsed = JSON.parse(json)
  } catch (err) {
    // Okunamayan kasanın üzerine yazılmasın diye yedeğini al.
    const backup = `${file}.yedek-${Date.now()}`
    fs.copyFileSync(file, backup)
    throw new Error(`${(err as Error).message}\nEski dosya şuraya yedeklendi: ${backup}`)
  }
  vault = {
    ...structuredClone(EMPTY),
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...parsed.settings }
  }
}

const deriveKey = (password: string, salt: Buffer): Buffer => scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT)

function seal(inner: Buffer): Buffer {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', masterKey!, iv)
  const body = Buffer.concat([c.update(inner), c.final()])
  return Buffer.concat([MAGIC2, masterSalt!, iv, c.getAuthTag(), body])
}

/** Kasa parola bekliyor mu (uygulama yeni açıldı, henüz çözülmedi)? */
export const isSealed = (): boolean => sealed !== null
export const hasMasterPassword = (): boolean => sealed !== null || masterKey !== null

/** Parola doğruysa anahtarı döndürür. Kasa mühürlüyse çözmeyi dener, değilse bellekteki anahtarla karşılaştırır. */
export function checkMasterPassword(password: string): Buffer | null {
  const salt = sealed ? sealed.subarray(4, 20) : masterSalt
  if (!salt) return null
  const key = deriveKey(password, salt)
  if (!sealed) return masterKey && timingSafeEqual(key, masterKey) ? key : null
  return unsealWithKey(key) ? key : null
}

/** Mühürlü kasayı verilen anahtarla açar (parola ya da Touch ID ile saklanan anahtar). */
export function unsealWithKey(key: Buffer): boolean {
  if (!sealed) return !!masterKey && key.length === masterKey.length && timingSafeEqual(key, masterKey)
  const raw = sealed
  let inner: Buffer
  try {
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(20, 32))
    d.setAuthTag(raw.subarray(32, 48))
    inner = Buffer.concat([d.update(raw.subarray(48)), d.final()])
  } catch {
    return false // yanlış parola
  }
  parseVault(inner, vaultPath())
  masterKey = key
  masterSalt = Buffer.from(raw.subarray(4, 20))
  sealed = null
  const pub = publicView()
  listeners.forEach((l) => l(pub))
  return true
}

/** Ana parolayı koyar/değiştirir; null ile kaldırır. Kasa açıkken çağrılır. Yeni anahtarı döndürür. */
export function setMasterPassword(password: string | null): Buffer | null {
  if (sealed) throw new Error('Önce kilidi açın')
  if (password === null) {
    masterKey = masterSalt = null
  } else {
    masterSalt = randomBytes(16)
    masterKey = deriveKey(password, masterSalt)
  }
  persist(false)
  return masterKey
}

function persist(broadcast = true): void {
  if (sealed) return
  const json = JSON.stringify(vault)
  const inner = canEncrypt()
    ? Buffer.concat([MAGIC, safeStorage.encryptString(json)])
    : Buffer.from(json, 'utf8')
  const data = masterKey ? seal(inner) : inner
  const file = vaultPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Yarım yazılmış dosya kalmasın diye önce geçici dosyaya yaz.
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, data, { mode: 0o600 })
  fs.renameSync(tmp, file)
  if (!broadcast) return
  const pub = publicView()
  listeners.forEach((l) => l(pub))
}

// Komut geçmişi arayüze toplu gönderilmez ve her komutta tüm arayüz yenilenmesin diye sessizce yazılır.
const HISTORY_PER_HOST = 500
let historyTimer: ReturnType<typeof setTimeout> | undefined

export function getHistory(hostId: string): { host: HistoryEntry[]; global: HistoryEntry[] } {
  const host = vault.history[hostId] ?? []
  const merged = new Map<string, HistoryEntry>()
  for (const [id, list] of Object.entries(vault.history)) {
    if (id === hostId) continue
    for (const e of list) {
      const m = merged.get(e.cmd)
      if (m) {
        m.count += e.count
        m.last = Math.max(m.last, e.last)
      } else merged.set(e.cmd, { ...e })
    }
  }
  return { host, global: [...merged.values()] }
}

export function addHistory(hostId: string, cmd: string): void {
  if (!vault.settings.saveHistory) return
  const list = (vault.history[hostId] ??= [])
  const found = list.find((e) => e.cmd === cmd)
  if (found) {
    found.count++
    found.last = Date.now()
  } else list.push({ cmd, count: 1, last: Date.now() })
  if (list.length > HISTORY_PER_HOST) {
    // En az kullanılan ve en eski olanları at.
    list.sort((a, b) => b.count * 1e13 + b.last - (a.count * 1e13 + a.last))
    list.length = HISTORY_PER_HOST
  }
  clearTimeout(historyTimer)
  historyTimer = setTimeout(() => persist(false), 1000)
}

export function clearHistory(): void {
  vault.history = {}
  persist(false)
}

export function historyCount(): number {
  return Object.values(vault.history).reduce((n, l) => n + l.length, 0)
}

/** Uygulama kapanırken bekleyen geçmiş yazımını tamamla. */
export function flushHistory(): void {
  if (historyTimer) {
    clearTimeout(historyTimer)
    historyTimer = undefined
    persist(false)
  }
}

export function onVaultChange(cb: (d: VaultData) => void): void {
  listeners.push(cb)
}

export function publicView(): VaultData {
  return {
    groups: vault.groups,
    hosts: vault.hosts,
    keys: vault.keys.map(({ privateKey: _p, passphrase: _pp, ...k }) => k),
    identities: vault.identities,
    snippets: vault.snippets,
    forwards: vault.forwards,
    settings: vault.settings,
    encrypted: canEncrypt()
  }
}

export function newId(): string {
  return randomUUID()
}

export function upsert(collection: Collection, item: { id: string }): VaultData {
  const list = vault[collection] as Array<{ id: string }>
  const obj = { ...item, id: item.id || newId() }
  const idx = list.findIndex((x) => x.id === obj.id)
  if (idx >= 0) list[idx] = obj
  else list.push(obj)
  persist()
  return publicView()
}

export function remove(collection: Collection, id: string): VaultData {
  const list = vault[collection] as Array<{ id: string }>
  vault[collection] = list.filter((x) => x.id !== id) as never

  // Silinen kayda yapılan referansları temizle.
  if (collection === 'groups') {
    vault.hosts.forEach((h) => h.groupId === id && delete h.groupId)
  } else if (collection === 'identities') {
    vault.hosts.forEach((h) => h.identityId === id && delete h.identityId)
  } else if (collection === 'hosts') {
    vault.hosts.forEach((h) => h.jumpHostId === id && delete h.jumpHostId)
    delete vault.history[id]
    vault.forwards = vault.forwards.filter((f) => f.hostId !== id)
  }
  persist()
  return publicView()
}

export function saveSettings(settings: Settings): VaultData {
  vault.settings = { ...DEFAULT_SETTINGS, ...settings }
  persist()
  return publicView()
}

export function getSettings(): Settings {
  return vault.settings
}

export function getHost(id: string): Host | undefined {
  return vault.hosts.find((h) => h.id === id)
}

export function getIdentity(id: string): Identity | undefined {
  return vault.identities.find((i) => i.id === id)
}

export function allForwards(): PortForward[] {
  return vault.forwards
}

export function getForward(id: string): PortForward | undefined {
  return vault.forwards.find((f) => f.id === id)
}

export function getKey(id: string): StoredSshKey | undefined {
  return vault.keys.find((k) => k.id === id)
}

export function addKey(key: StoredSshKey): VaultData {
  vault.keys.push(key)
  persist()
  return publicView()
}

export function renameKey(id: string, name: string): VaultData {
  const k = getKey(id)
  if (k) k.name = name
  persist()
  return publicView()
}

export function removeKey(id: string): VaultData {
  vault.keys = vault.keys.filter((k) => k.id !== id)
  vault.hosts.forEach((h) => h.keyId === id && delete h.keyId)
  vault.identities.forEach((i) => i.keyId === id && delete i.keyId)
  persist()
  return publicView()
}

export function getKnownHost(hostPort: string): string | undefined {
  return vault.knownHosts[hostPort]
}

export function setKnownHost(hostPort: string, fingerprint: string): void {
  vault.knownHosts[hostPort] = fingerprint
  persist()
}

export function addHosts(hosts: Host[]): void {
  vault.hosts.push(...hosts)
  persist()
}

export function allHosts(): Host[] {
  return vault.hosts
}

// --- Bilinen sunucular ---

export function listKnownHosts(): KnownHost[] {
  return Object.entries(vault.knownHosts)
    .map(([hostPort, fingerprint]) => ({ hostPort, fingerprint }))
    .sort((a, b) => a.hostPort.localeCompare(b.hostPort))
}

export function removeKnownHost(hostPort: string): void {
  delete vault.knownHosts[hostPort]
  persist(false)
}

// --- Yedekleme ---

export type BackupPayload = StoredVault

export function exportVault(): BackupPayload {
  return structuredClone(vault)
}

export function summarize(v: Partial<StoredVault>, createdAt: number): BackupSummary {
  return {
    hosts: v.hosts?.length ?? 0,
    keys: v.keys?.length ?? 0,
    identities: v.identities?.length ?? 0,
    snippets: v.snippets?.length ?? 0,
    forwards: v.forwards?.length ?? 0,
    groups: v.groups?.length ?? 0,
    createdAt
  }
}

function normalize(v: Partial<StoredVault>): StoredVault {
  const arr = <T>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : [])
  return {
    groups: arr(v.groups),
    hosts: arr(v.hosts).map((h) => ({ ...h, tags: Array.isArray(h.tags) ? h.tags : [] })),
    keys: arr(v.keys),
    identities: arr(v.identities),
    snippets: arr(v.snippets),
    forwards: arr(v.forwards),
    settings: { ...DEFAULT_SETTINGS, ...(v.settings ?? {}) },
    knownHosts: v.knownHosts && typeof v.knownHosts === 'object' ? v.knownHosts : {},
    history: v.history && typeof v.history === 'object' ? v.history : {}
  }
}

/**
 * Yedeği kasaya uygular.
 * - replace: mevcut kasanın yerine geçer.
 * - merge: sadece olmayan kayıtları ekler; aynı anahtar (parmak izi) zaten varsa
 *   onu kullanır ve içe aktarılan host/kimliklerdeki referansları ona çevirir.
 */
export function importVault(raw: Partial<StoredVault>, mode: 'merge' | 'replace'): void {
  const inc = normalize(raw)
  if (mode === 'replace') {
    vault = inc
    persist()
    return
  }
  const keyIdMap = new Map<string, string>()
  for (const k of inc.keys) {
    const same = vault.keys.find((x) => x.fingerprint === k.fingerprint)
    if (same) keyIdMap.set(k.id, same.id)
    else if (!vault.keys.some((x) => x.id === k.id)) vault.keys.push(k)
  }
  const mapKey = (id?: string): string | undefined => (id ? (keyIdMap.get(id) ?? id) : id)
  const addMissing = <T extends { id: string }>(target: T[], items: T[]): void => {
    for (const it of items) if (!target.some((x) => x.id === it.id)) target.push(it)
  }
  addMissing(vault.groups, inc.groups)
  addMissing(vault.identities, inc.identities.map((i) => ({ ...i, keyId: mapKey(i.keyId) })))
  addMissing(vault.hosts, inc.hosts.map((h) => ({ ...h, keyId: mapKey(h.keyId) })))
  addMissing(vault.snippets, inc.snippets)
  addMissing(vault.forwards, inc.forwards)
  addMissing(vault.settings.customThemes, inc.settings.customThemes)
  vault.knownHosts = { ...inc.knownHosts, ...vault.knownHosts }
  for (const [hostId, list] of Object.entries(inc.history)) {
    const cur = (vault.history[hostId] ??= [])
    for (const e of list) if (!cur.some((x) => x.cmd === e.cmd)) cur.push(e)
  }
  persist()
}
