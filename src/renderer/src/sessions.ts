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
