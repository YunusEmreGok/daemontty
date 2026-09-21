// Ana süreç, preload ve arayüz arasında paylaşılan veri modelleri.

export interface Group {
  id: string
  name: string
}

export interface Host {
  id: string
  label: string
  address: string
  port: number
  groupId?: string
  tags: string[]
  /** Kimlik seçiliyse kullanıcı adı / parola / anahtar oradan gelir. */
  identityId?: string
  username?: string
  password?: string
  keyId?: string
  /** Bu host'a başka bir host üzerinden (ProxyJump) bağlan. */
  jumpHostId?: string
  /** Bağlandıktan sonra otomatik çalıştırılacak komut. */
  startupCommand?: string
  /** Bu host'a özel terminal teması (boşsa genel tema). */
  themeId?: string
  /** ssh-agent'ı sunucuya yönlendir (ssh -A) */
  agentForward?: boolean
}

export type KeyType = 'ed25519' | 'rsa' | 'ecdsa'

export interface SshKey {
  id: string
  name: string
  type: string
  publicKey: string
  fingerprint: string
  createdAt: number
  hasPassphrase: boolean
}

/** Sadece ana süreçte tutulan gizli alanlarla birlikte anahtar. */
export interface StoredSshKey extends SshKey {
  privateKey: string
  passphrase?: string
}

export interface Identity {
  id: string
  name: string
  username: string
  password?: string
  keyId?: string
}

export interface Snippet {
  id: string
  name: string
  command: string
}

export type ForwardType = 'local' | 'remote' | 'dynamic'

export interface PortForward {
  id: string
  name: string
  type: ForwardType
  hostId: string
  bindAddress: string
  bindPort: number
  destHost?: string
  destPort?: number
}

export interface TerminalTheme {
  id: string
  name: string
  /** Tema açık zeminli mi (arayüz buna göre uyum sağlar). */
  light?: boolean
  background: string
  foreground: string
  cursor: string
  selection: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type CursorStyle = 'block' | 'bar' | 'underline'

export interface Settings {
  themeId: string
  customThemes: TerminalTheme[]
  fontSize: number
  fontFamily: string
  lineHeight: number
  letterSpacing: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  /** Terminal kenar boşluğu (px). */
  padding: number
  scrollback: number
  copyOnSelect: boolean
  /** Yazarken öneri listesi göster. */
  autocomplete: boolean
  /** Satır sonunda soluk "hayalet" tamamlama metni göster. */
  ghostText: boolean
  /** Çalıştırılan komutları öneriler için kaydet. */
  saveHistory: boolean
  /** Bağlantı koparsa otomatik yeniden bağlan. */
  autoReconnect: boolean
  /** Terminal üst çubuğunda sunucu CPU/RAM/disk kullanımını göster. */
  showServerStats: boolean
  /** Anahtar atanmamış host'larda ssh-agent ve ~/.ssh/id_* anahtarlarını dene. */
  useSystemKeys: boolean
  /** Terminali GPU (WebGL) ile çiz; kapalıysa DOM ile çizilir. */
  gpuRendering: boolean
  /** Sabitlenmiş sekmeler; uygulama açılınca yeniden açılır. */
  pinnedTabs: PinnedTab[]
}

export interface PinnedTab {
  kind: 'terminal' | 'sftp'
  hostId: string
}

export interface HistoryEntry {
  cmd: string
  count: number
  last: number
}

export interface ServerStats {
  /** /proc/stat toplam ve boşta CPU sayaçları (yüzde için iki ölçüm arası fark alınır) */
  cpuTotal: number
  cpuIdle: number
  memTotal: number
  memAvailable: number
  diskTotal: number
  diskUsed: number
  load1: number
  cores: number
}

export interface HostProbe {
  id: string
  /** null: denenmedi (ör. jump host arkasında) */
  online: boolean | null
  ms?: number
}

export interface KnownHost {
  /** "adres:port" */
  hostPort: string
  fingerprint: string
}

export interface BackupSummary {
  hosts: number
  keys: number
  identities: number
  snippets: number
  forwards: number
  groups: number
  createdAt: number
}

export interface DirListing {
  /** Sunucudaki mutlak klasör yolu */
  dir: string
  entries: Array<{ name: string; isDir: boolean }>
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: 'kabuk',
  customThemes: [],
  fontSize: 14,
  fontFamily: '"JetBrains Mono", Menlo, Monaco, Consolas, monospace',
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  padding: 12,
  scrollback: 10000,
  copyOnSelect: false,
  autocomplete: true,
  ghostText: true,
  saveHistory: true,
  gpuRendering: true,
  useSystemKeys: true,
  autoReconnect: true,
  showServerStats: true,
  pinnedTabs: []
}

/** Arayüze gönderilen kasa içeriği (özel anahtarlar hariç). */
export interface VaultData {
  groups: Group[]
  hosts: Host[]
  keys: SshKey[]
  identities: Identity[]
  snippets: Snippet[]
  forwards: PortForward[]
  settings: Settings
  encrypted: boolean
}

export type Collection = 'groups' | 'hosts' | 'identities' | 'snippets' | 'forwards'

export type ForwardState = 'stopped' | 'starting' | 'running' | 'error'

export interface ForwardStatus {
  id: string
  state: ForwardState
  message?: string
}

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  isLink: boolean
  size: number
  mtime: number
  mode?: number
}

export interface TransferProgress {
  id: string
  sftpId: string
  direction: 'upload' | 'download' | 'copy'
  name: string
  transferred: number
  total: number
  state: 'running' | 'done' | 'error'
  error?: string
}

export interface PromptField {
  label: string
  secret: boolean
}

export interface PromptRequest {
  id: string
  title: string
  message?: string
  fields: PromptField[]
}

export type SessionEvent =
  | { type: 'status'; message: string }
  | { type: 'ready' }
  | { type: 'closed'; reason: 'exit' | 'lost'; message?: string }
  | { type: 'error'; message: string; retryable?: boolean }

/** preload tarafından window.api olarak açılan arayüz. */
/** Uygulama güncellemesinin durumu (GitHub Releases) */
export type UpdateState =
  | { status: 'idle' | 'checking' | 'current' }
  /** Yeni sürüm var; kullanıcı isteyene kadar indirilmez. manual: bu platformda elle kurulur (imzasız macOS, deb) */
  | { status: 'available'; version: string; manual: boolean }
  | { status: 'downloading'; version: string; percent: number }
  /** İndirildi; yeniden başlatınca ya da çıkışta kurulur */
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

export interface Api {
  platform: string
  update: {
    version(): Promise<string>
    state(): Promise<UpdateState>
    check(): void
    /** Bulunan sürümü indirir; elle kurulan platformlarda indirme sayfasını açar. */
    download(): void
    /** İndirilen güncellemeyi kurmak için uygulamayı yeniden başlatır. */
    install(): void
    onState(cb: (s: UpdateState) => void): () => void
  }
  vault: {
    get(): Promise<VaultData>
    upsert<T extends { id: string }>(collection: Collection, item: T): Promise<VaultData>
    remove(collection: Collection, id: string): Promise<VaultData>
    saveSettings(settings: Settings): Promise<VaultData>
    onChange(cb: (data: VaultData) => void): () => void
  }
  keys: {
    generate(name: string, type: KeyType, bits: number | undefined, passphrase: string): Promise<VaultData>
    importText(name: string, privateKey: string, passphrase: string): Promise<VaultData>
    pickFile(): Promise<{ name: string; content: string } | null>
    rename(id: string, name: string): Promise<VaultData>
    remove(id: string): Promise<VaultData>
    exportPrivate(id: string): Promise<boolean>
  }
  ssh: {
    open(sessionId: string, hostId: string, cols: number, rows: number): Promise<void>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    close(sessionId: string): void
    onData(cb: (sessionId: string, data: Uint8Array) => void): () => void
    onEvent(cb: (sessionId: string, ev: SessionEvent) => void): () => void
    /** Otomatik tamamlama için açık oturumun sunucusundaki bir klasörü listeler. */
    listDir(sessionId: string, dir: string): Promise<DirListing | null>
    /** Açık oturumun sunucusundan CPU/RAM/disk bilgisi (Linux değilse null) */
    stats(sessionId: string): Promise<ServerStats | null>
  }
  hosts: {
    /** Host'ların SSH portuna TCP ile ulaşılabiliyor mu? */
    probe(ids: string[]): Promise<HostProbe[]>
  }
  knownHosts: {
    list(): Promise<KnownHost[]>
    remove(hostPort: string): Promise<void>
  }
  backup: {
    /** Kasayı parolayla şifreli bir dosyaya yazar; iptal edilirse null döner. */
    export(password: string): Promise<string | null>
    pickFile(): Promise<string | null>
    inspect(file: string, password: string): Promise<BackupSummary>
    import(file: string, password: string, mode: 'merge' | 'replace'): Promise<BackupSummary>
  }
  history: {
    get(hostId: string): Promise<{ host: HistoryEntry[]; global: HistoryEntry[] }>
    add(hostId: string, cmd: string): void
    clear(): Promise<void>
    count(): Promise<number>
  }
  sftp: {
    open(sftpId: string, hostId: string): Promise<string>
    close(sftpId: string): void
    list(sftpId: string, path: string): Promise<FileEntry[]>
    mkdir(sftpId: string, path: string): Promise<void>
    rename(sftpId: string, from: string, to: string): Promise<void>
    remove(sftpId: string, path: string, isDir: boolean): Promise<void>
    download(sftpId: string, remotePaths: string[], localDir: string): Promise<void>
    upload(sftpId: string, localPaths: string[], remoteDir: string): Promise<void>
    /** Sunucudan sunucuya kopyalama (veri uygulama üzerinden akar) */
    copy(fromId: string, paths: string[], toId: string, destDir: string): Promise<void>
    onProgress(cb: (p: TransferProgress) => void): () => void
  }
  local: {
    home(): Promise<string>
    list(path: string): Promise<FileEntry[]>
    mkdir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    remove(path: string): Promise<void>
    copy(paths: string[], destDir: string): Promise<void>
    reveal(path: string): void
    /** Sürükle-bırak ile gelen dosyanın diskteki yolu. */
    pathForFile(file: File): string
  }
  forwards: {
    start(id: string): Promise<void>
    stop(id: string): Promise<void>
    statuses(): Promise<ForwardStatus[]>
    onStatus(cb: (s: ForwardStatus) => void): () => void
  }
  prompt: {
    onRequest(cb: (req: PromptRequest) => void): () => void
    respond(id: string, values: string[] | null): void
  }
  importSshConfig(): Promise<{ added: number; skipped: number }>
}
