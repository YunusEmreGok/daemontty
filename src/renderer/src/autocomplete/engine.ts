import type { DirListing, HistoryEntry, Snippet } from '@shared/types'
import { COMMAND_NAMES, COMMANDS, DIR_ONLY_COMMANDS, PATH_COMMANDS } from './commands'

export type SuggestionKind = 'history' | 'path' | 'command' | 'snippet' | 'fix'

export interface Suggestion {
  /** Kabul edilince satırın alacağı tam hali */
  text: string
  /** Listede gösterilecek kısa ad */
  label: string
  desc?: string
  kind: SuggestionKind
}

export interface SuggestContext {
  hostHistory: HistoryEntry[]
  globalHistory: HistoryEntry[]
  snippets: Snippet[]
  path?: PathQuery | null
  listing?: DirListing | null
}

const MAX = 8

// --- Yol tamamlama ---

export interface PathQuery {
  /** Listelenecek klasör (sunucuya gönderilir; ~ ve göreli yollar orada çözülür) */
  dir: string
  /** Satırın son kelimeden önceki kısmı */
  head: string
  /** Son kelimenin klasör kısmı, yazıldığı haliyle (kaçış karakterleri dahil) */
  rawDir: string
  /** Aranan dosya adı öneki */
  prefix: string
  dirOnly: boolean
}

/** Son kelimeyi ayırır; "\ " ile kaçırılmış boşlukları kelimenin parçası sayar. */
function lastToken(input: string): { head: string; raw: string } {
  let i = input.length
  while (i > 0) {
    if (input[i - 1] === ' ' && input[i - 2] !== '\\') break
    i--
  }
  return { head: input.slice(0, i), raw: input.slice(i) }
}

const unescape = (s: string): string => s.replace(/\\(.)/g, '$1')
const escape = (s: string): string => s.replace(/([ '"()&;|<>$`\\!*?[\]{}])/g, '\\$1')

export function pathQuery(input: string, cwd: string | null): PathQuery | null {
  const words = input.trimStart().split(/\s+/)
  let cmd = words[0]
  if (cmd === 'sudo' && words.length > 2) cmd = words[1]
  const { head, raw } = lastToken(input)
  const isFirstWord = !head.trim()
  const looksLikePath = /^(\.{0,2}\/|~\/?)/.test(raw) || raw.includes('/')
  if (isFirstWord ? !looksLikePath : !(PATH_COMMANDS.has(cmd) || looksLikePath)) return null
  if (raw.startsWith('-') || /[|;&><$`]/.test(raw)) return null

  const slash = raw.lastIndexOf('/')
  const rawDir = slash >= 0 ? raw.slice(0, slash + 1) : ''
  const prefix = unescape(raw.slice(slash + 1))
  const dirPart = unescape(rawDir)
  let dir: string
  if (dirPart.startsWith('/') || dirPart.startsWith('~')) dir = dirPart || '/'
  else if (cwd) dir = cwd.replace(/\/$/, '') + '/' + dirPart
  else dir = dirPart || '.'
  return { dir, head, rawDir, prefix, dirOnly: DIR_ONLY_COMMANDS.has(cmd) }
}

function pathSuggestions(q: PathQuery, listing: DirListing): Suggestion[] {
  const lower = q.prefix.toLocaleLowerCase('tr')
  return listing.entries
    .filter((e) => e.name !== '.' && e.name !== '..')
    .filter((e) => !q.dirOnly || e.isDir)
    .filter((e) => (q.prefix.startsWith('.') ? true : !e.name.startsWith('.')))
    .filter((e) => e.name.toLocaleLowerCase('tr').startsWith(lower) && e.name !== q.prefix)
    // Önce birebir büyük/küçük harf uyanlar, sonra klasörler, sonra alfabetik
    .sort(
      (a, b) =>
        Number(b.name.startsWith(q.prefix)) - Number(a.name.startsWith(q.prefix)) ||
        Number(b.isDir) - Number(a.isDir) ||
        a.name.localeCompare(b.name, 'tr')
    )
    .slice(0, MAX)
    .map((e) => ({
      text: q.head + q.rawDir + escape(e.name) + (e.isDir ? '/' : ''),
      label: e.name + (e.isDir ? '/' : ''),
      desc: e.isDir ? 'klasör' : 'dosya',
      kind: 'path' as const
    }))
}

// --- Geçmiş ---

function historyScore(e: HistoryEntry, boost: number): number {
  const ageH = (Date.now() - e.last) / 3_600_000
  const recency = ageH < 1 ? 12 : ageH < 24 ? 8 : ageH < 24 * 7 ? 4 : 0
  return boost + Math.log2(e.count + 1) * 10 + recency
}

function historySuggestions(input: string, ctx: SuggestContext): Suggestion[] {
  const scored = new Map<string, number>()
  const consider = (list: HistoryEntry[], boost: number): void => {
    for (const e of list) {
      if (e.cmd === input || !e.cmd.startsWith(input)) continue
      const s = historyScore(e, boost)
      if (s > (scored.get(e.cmd) ?? -1)) scored.set(e.cmd, s)
    }
  }
  consider(ctx.hostHistory, 20)
  consider(ctx.globalHistory, 0)
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cmd]) => ({ text: cmd, label: cmd, desc: 'geçmiş', kind: 'history' as const }))
}

// --- Yazım düzeltme ---

/** Damerau-Levenshtein uzaklığı (yer değiştirme = 1 hata). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** Yanlış yazılmış komut adı için en yakın bilinen komutu bulur. */
export function didYouMean(word: string, extra: string[] = []): string | null {
  if (word.length < 2) return null
  const known = new Set([...COMMAND_NAMES, ...extra])
  if (known.has(word)) return null
  const limit = word.length <= 4 ? 1 : 2
  let best: string | null = null
  let bestD = Infinity
  for (const k of known) {
    if (Math.abs(k.length - word.length) > limit) continue
    const dist = editDistance(word, k)
    if (dist <= limit && dist < bestD) {
      best = k
      bestD = dist
    }
  }
  return best
}

export function historyCommandNames(ctx: SuggestContext): string[] {
  return [...ctx.hostHistory, ...ctx.globalHistory].map((e) => e.cmd.split(' ')[0])
}

// --- Ana fonksiyon ---

export function suggest(input: string, ctx: SuggestContext): Suggestion[] {
  if (!input.trim()) return []
  const out: Suggestion[] = []
  const seen = new Set<string>()
  const push = (list: Suggestion[]): void => {
    for (const s of list) {
      if (out.length >= MAX) return
      if (seen.has(s.text) || s.text === input) continue
      seen.add(s.text)
      out.push(s)
    }
  }

  // Yol bağlamındaysak dosya adları en üstte olsun.
  if (ctx.path && ctx.listing) push(pathSuggestions(ctx.path, ctx.listing))

  push(historySuggestions(input, ctx))

  const trimmed = input.trimStart()
  push(
    COMMANDS.filter((c) => c.cmd.startsWith(trimmed) && c.cmd !== trimmed)
      .slice(0, 5)
      .map((c) => ({ text: input.slice(0, input.length - trimmed.length) + c.cmd, label: c.cmd, desc: c.desc, kind: 'command' as const }))
  )

  if (trimmed.length >= 2) {
    const q = trimmed.toLocaleLowerCase('tr')
    push(
      ctx.snippets
        .filter((s) => !s.command.includes('\n'))
        .filter((s) => s.command.startsWith(trimmed) || s.name.toLocaleLowerCase('tr').includes(q))
        .slice(0, 3)
        .map((s) => ({ text: s.command, label: s.name, desc: s.command, kind: 'snippet' as const }))
    )
  }

  // Hiç öneri yoksa ve ilk kelime tanınmıyorsa yazım düzeltmesi öner.
  const first = trimmed.split(' ')[0]
  if (out.length === 0 && (trimmed.includes(' ') || first.length >= 3)) {
    const fix = didYouMean(first, historyCommandNames(ctx))
    if (fix) {
      const fixed = input.replace(first, fix)
      push([{ text: fixed, label: fixed, desc: 'Bunu mu demek istediniz?', kind: 'fix' }])
    }
  }
  return out
}

// --- İstemden (prompt) çalışma klasörünü tahmin et ---

export function cwdFromPrompt(prompt: string): string | null {
  const p = prompt.trimEnd()
  const patterns = [
    /:\s?(~[^\s$#%>]*|\/[^\s$#%>]*)\s?[$#%>❯]$/, // yunus@sunucu:~/proje$
    /\s(~[^\s\]]*|\/[^\s\]]*)\]\s?[$#%>]$/, // [yunus@sunucu /etc]$
    /^(~[^\s]*|\/[^\s]*)\s?[$#%>❯]$/ // ~/proje $
  ]
  for (const re of patterns) {
    const m = p.match(re)
    if (m) return m[1]
  }
  return null
}

/** "komut bulunamadı" hatasından yanlış yazılan kelimeyi çıkarır. */
export function notFoundWord(text: string): string | null {
  // zsh: "command not found: gti" — önce bu denenmeli, yoksa diğer desen "zsh" kelimesini yakalar.
  const m =
    text.match(/command not found: (\S+)\s*$/m) ??
    text.match(/(?:^|\n)[^\n]*?([^\s:]+): (?:command not found|komut bulunamadı|not found)\s*$/m)
  return m ? m[1] : null
}

/** Parola vb. içerebilecek komutları geçmişe kaydetme. */
export function looksSensitive(cmd: string): boolean {
  return /(password|passwd|parola|secret|token|api[_-]?key)\s*=|\s-p\S+|--password[= ]\S+/i.test(cmd)
}
