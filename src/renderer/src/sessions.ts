import { api } from './api'

// Sekme → panel oturumları kaydı. Snippet çalıştırma ve komut paleti, bir sekmeye
// yazarken hangi panele (ya da "tümüne yaz" açıksa tüm panellere) gideceğini buradan öğrenir.

export interface TabSessions {
  /** Yazının gideceği oturumlar: odaktaki panel ya da yayın açıksa hepsi */
  targets(): string[]
  focus(): void
}

const registry = new Map<string, TabSessions>()

export function registerTab(tabId: string, s: TabSessions): () => void {
  registry.set(tabId, s)
  return () => {
    if (registry.get(tabId) === s) registry.delete(tabId)
  }
}

/** Sekmeye komut yazar; birden fazla satır sırayla çalıştırılır. */
export function runInTab(tabId: string, command: string): void {
  const data = command.replace(/\r?\n/g, '\r') + '\r'
  const targets = registry.get(tabId)?.targets() ?? [tabId]
  targets.forEach((id) => api.ssh.write(id, data))
}

export function focusTabTerminal(tabId: string): void {
  registry.get(tabId)?.focus()
}

// --- Parametreli snippet'ler: `systemctl restart {{servis}}` ya da varsayılanla `{{satır:100}}` ---

const PARAM_RE = /\{\{\s*([^{}:]+?)\s*(?::([^{}]*))?\}\}/g
/** Bu oturumda girilen son değerler; aynı parametre tekrar sorulduğunda hazır gelir. */
const lastValues = new Map<string, string>()

export function snippetParams(command: string): Array<{ name: string; initial: string }> {
  const seen = new Map<string, string>()
  for (const m of command.matchAll(PARAM_RE)) if (!seen.has(m[1])) seen.set(m[1], m[2] ?? '')
  return [...seen].map(([name, initial]) => ({ name, initial }))
}

/** Parametre varsa kullanıcıya sorar ve yerine koyar; iptal edilirse null döner. */
export async function fillSnippet(
  ui: { form(title: string, fields: Array<{ label: string; initial?: string }>, opts?: { message?: string; confirmLabel?: string }): Promise<string[] | null> },
  snippet: { name: string; command: string }
): Promise<string | null> {
  const params = snippetParams(snippet.command)
  if (!params.length) return snippet.command
  const values = await ui.form(
    snippet.name,
    params.map((p) => ({ label: p.name, initial: lastValues.get(p.name) ?? p.initial })),
    { confirmLabel: 'Çalıştır' }
  )
  if (!values) return null
  params.forEach((p, i) => lastValues.set(p.name, values[i]))
  return snippet.command.replace(PARAM_RE, (_m, name: string) => values[params.findIndex((p) => p.name === name)])
}
