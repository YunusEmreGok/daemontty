import type { Api, SessionEvent } from '@shared/types'

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api
export const isMac = api.platform === 'darwin'

/** IPC hatalarındaki "Error invoking remote method…" önekini temizler. */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

// Her terminal kendi oturumunu dinler; tek bir IPC dinleyicisi üzerinden dağıtırız.
type SessionHandlers = { data(d: Uint8Array): void; event(ev: SessionEvent): void }
const handlers = new Map<string, SessionHandlers>()
api.ssh.onData((id, d) => handlers.get(id)?.data(d))
api.ssh.onEvent((id, ev) => handlers.get(id)?.event(ev))

export function subscribeSession(id: string, h: SessionHandlers): () => void {
  handlers.set(id, h)
  return () => {
    if (handlers.get(id) === h) handlers.delete(id)
  }
}

export function uid(): string {
  return crypto.randomUUID()
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Türkçe'ye uygun büyük/küçük harf duyarsız arama. */
export function matches(text: string | undefined, q: string): boolean {
  return (text ?? '').toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))
}

const HOST_COLORS = ['#22c3a6', '#5c9dff', '#b07cff', '#f2994a', '#ef5d6c', '#e8b93f', '#3fc8d0', '#6fcf8a']

/** Host kimliğinden sabit bir renk üretir (avatar ve sekme işareti için). */
export function colorFor(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return HOST_COLORS[h % HOST_COLORS.length]
}
