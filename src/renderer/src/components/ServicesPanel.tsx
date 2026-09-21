import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ServiceAction, ServiceKind, ServiceList } from '@shared/types'
import { api, errMsg, matches, uid } from '../api'
import { Icon } from './Icon'
import { useUi } from './Ui'

const SUDO_NEEDED = 'SUDO_PAROLASI_GEREKLI'
const REFRESH_MS = 5000
const MAX_LOG_CHARS = 400_000

type Level = 'ok' | 'bad' | 'busy' | 'off'
interface Row {
  kind: ServiceKind
  name: string
  detail: string
  state: string
  level: Level
}
type Filter = 'all' | 'ok' | 'bad'

const LEVEL_ORDER: Record<Level, number> = { bad: 0, busy: 1, ok: 2, off: 3 }

function rowsOf(list: ServiceList, kind: ServiceKind): Row[] {
  const rows: Row[] =
    kind === 'systemd'
      ? (list.systemd ?? []).map((u) => ({
          kind,
          name: u.name,
          detail: u.description,
          state: u.active === 'active' ? u.sub : u.active,
          level: u.active === 'failed' ? 'bad' : u.active === 'active' ? 'ok' : /ing$/.test(u.active) ? 'busy' : 'off'
        }))
      : (list.docker ?? []).map((c) => ({
          kind,
          name: c.name,
          detail: `${c.image} · ${c.status}`,
          state: c.state,
          level: c.state === 'running' ? 'ok' : c.state === 'restarting' || c.state === 'paused' ? 'busy' : c.state === 'dead' || /Exited \((?!0\))/.test(c.status) ? 'bad' : 'off'
        }))
  return rows.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.name.localeCompare(b.name, 'tr'))
}

/** Terminal sekmesinin sağında açılan servis paneli; odaktaki panelin bağlantısını kullanır. */
export function ServicesPanel({ sessionId, hostLabel, onClose }: { sessionId: string; hostLabel: string; onClose(): void }) {
  const ui = useUi()
  const [list, setList] = useState<ServiceList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<ServiceKind>('systemd')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [logsOf, setLogsOf] = useState<Row | null>(null)
  const pickedKind = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const l = await api.services.list(sessionId)
      setList(l)
      setError(null)
      // systemd yoksa ama Docker varsa doğrudan onu göster.
      if (!pickedKind.current && !l.systemd && l.docker) setKind('docker')
    } catch (e) {
      setError(errMsg(e))
    }
  }, [sessionId])

  useEffect(() => {
    setList(null)
    refresh()
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  const run = async (row: Row, action: ServiceAction): Promise<void> => {
    const key = `${row.kind}:${row.name}`
    setBusy(key)
    try {
      try {
        await api.services.action(sessionId, row.kind, row.name, action)
      } catch (e) {
        if (!errMsg(e).includes(SUDO_NEEDED)) throw e
        const pw = await ui.form(`${hostLabel}: sudo parolası`, [{ label: 'sudo parolası', secret: true }], {
          message: `"${row.name}" için yönetici yetkisi gerekiyor. Parola kaydedilmez; bu oturum kapanana kadar bellekte tutulur.`,
          confirmLabel: 'Devam'
        })
        if (!pw) return
        await api.services.action(sessionId, row.kind, row.name, action, pw[0])
      }
      ui.toast(`${row.name}: ${action === 'start' ? 'başlatıldı' : action === 'stop' ? 'durduruldu' : 'yeniden başlatıldı'}`, 'success')
      await refresh()
    } catch (e) {
      ui.toast(`${row.name}: ${errMsg(e)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const rows = useMemo(() => (list ? rowsOf(list, kind) : []), [list, kind])
  const shown = rows.filter((r) => (filter === 'all' || (filter === 'ok' ? r.level === 'ok' : r.level === 'bad')) && (!query || matches(r.name, query) || matches(r.detail, query)))
  const count = (l: Level): number => rows.filter((r) => r.level === l).length

  if (logsOf) return <LogView sessionId={sessionId} row={logsOf} busy={busy !== null} onAction={(a) => run(logsOf, a)} onBack={() => setLogsOf(null)} />

  const missing = list && (kind === 'systemd' ? !list.systemd : !list.docker)
  return (
    <aside className="svc-panel">
      <div className="svc-head">
        <Icon name="zap" />
        <strong>Servisler</strong>
        <span className="muted small svc-host">{hostLabel}</span>
        <div className="spacer" />
        <button className="icon-btn" title="Yenile" onClick={refresh}>
          <Icon name="refresh" size={14} />
        </button>
        <button className="icon-btn" title="Paneli kapat" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="svc-tabs">
        {(['systemd', 'docker'] as const).map((k) => (
          <button
            key={k}
            className={kind === k ? 'active' : ''}
            onClick={() => {
              pickedKind.current = true
              setKind(k)
            }}
          >
            {k === 'systemd' ? 'systemd' : 'Docker'}
            {list && <em>{(k === 'systemd' ? list.systemd : list.docker)?.length ?? '–'}</em>}
          </button>
        ))}
      </div>
      <div className="svc-tools">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Servis ara…" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        </div>
        <div className="svc-filters">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Tümü
          </button>
          <button className={filter === 'ok' ? 'active' : ''} onClick={() => setFilter('ok')}>
            Çalışan {count('ok')}
          </button>
          <button className={`${filter === 'bad' ? 'active' : ''} ${count('bad') ? 'has-bad' : ''}`} onClick={() => setFilter('bad')}>
            Hatalı {count('bad')}
          </button>
        </div>
      </div>
      <div className="svc-list">
        {error ? (
          <p className="svc-empty text-danger">{error}</p>
        ) : !list ? (
          <p className="svc-empty muted">Servisler okunuyor…</p>
        ) : missing ? (
          <p className="svc-empty muted">
            {kind === 'systemd'
              ? 'Bu sunucuda systemd bulunamadı.'
              : list.dockerDenied
                ? 'Docker kurulu ama bu kullanıcının erişim izni yok (docker grubuna ekleyin).'
                : 'Bu sunucuda Docker bulunamadı.'}
          </p>
        ) : !shown.length ? (
          <p className="svc-empty muted">Eşleşen servis yok.</p>
        ) : (
          shown.map((r) => {
            const working = busy === `${r.kind}:${r.name}`
            return (
              <div key={r.name} className={`svc-row ${working ? 'working' : ''}`} onDoubleClick={() => setLogsOf(r)}>
                <span className={`svc-dot svc-${r.level}`} />
                <div className="svc-text">
                  <strong>{r.name}</strong>
                  <small className="muted">{r.detail}</small>
                </div>
                <span className={`svc-state svc-${r.level}`}>{working ? '…' : r.state}</span>
                <div className="svc-actions">
                  {r.level === 'ok' || r.level === 'busy' ? (
                    <>
                      <button className="icon-btn" title="Yeniden başlat" disabled={working} onClick={() => run(r, 'restart')}>
                        <Icon name="refresh" size={13} />
                      </button>
                      <button className="icon-btn" title="Durdur" disabled={working} onClick={() => run(r, 'stop')}>
                        <Icon name="stop" size={13} />
                      </button>
                    </>
                  ) : (
                    <button className="icon-btn" title="Başlat" disabled={working} onClick={() => run(r, 'start')}>
                      <Icon name="play" size={13} />
                    </button>
                  )}
                  <button className="icon-btn" title="Günlükleri izle" onClick={() => setLogsOf(r)}>
                    <Icon name="file" size={13} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

function LogView({ sessionId, row, busy, onAction, onBack }: { sessionId: string; row: Row; busy: boolean; onAction(a: ServiceAction): void; onBack(): void }) {
  const ui = useUi()
  const [text, setText] = useState('')
  const [ended, setEnded] = useState(false)
  const [follow, setFollow] = useState(true)
  const [attempt, setAttempt] = useState<{ n: number; password?: string }>({ n: 0 })
  const pre = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const streamId = uid()
    setText('')
    setEnded(false)
    const offLog = api.services.onLog((id, chunk) => id === streamId && setText((t) => (t + chunk).slice(-MAX_LOG_CHARS)))
    const offEnd = api.services.onLogEnd((id) => id === streamId && setEnded(true))
    api.services.logs(sessionId, streamId, row.kind, row.name, attempt.password).catch((e) => setText(errMsg(e)))
    return () => {
      offLog()
      offEnd()
      api.services.stopLogs(streamId)
    }
  }, [sessionId, row.kind, row.name, attempt])

  useEffect(() => {
    if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [text, follow])

  const withSudo = async (): Promise<void> => {
    const pw = await ui.form('sudo parolası', [{ label: 'sudo parolası', secret: true }], { message: 'Günlükler yönetici yetkisiyle okunacak.', confirmLabel: 'Devam' })
    if (pw) setAttempt((a) => ({ n: a.n + 1, password: pw[0] }))
  }

  const lacksAccess = /insufficient permissions|No journal files were (found|opened)|not seeing messages|permission denied/i.test(text)

  return (
    <aside className="svc-panel">
      <div className="svc-head">
        <button className="icon-btn" title="Listeye dön" onClick={onBack}>
          <Icon name="arrowLeft" size={14} />
        </button>
        <span className={`svc-dot svc-${row.level}`} />
        <strong className="svc-log-title">{row.name}</strong>
        <div className="spacer" />
        <button className="icon-btn" title="Yeniden başlat" disabled={busy} onClick={() => onAction('restart')}>
          <Icon name="refresh" size={14} />
        </button>
        <button className="icon-btn" title={row.level === 'ok' ? 'Durdur' : 'Başlat'} disabled={busy} onClick={() => onAction(row.level === 'ok' ? 'stop' : 'start')}>
          <Icon name={row.level === 'ok' ? 'stop' : 'play'} size={14} />
        </button>
      </div>
      <div className="svc-log-bar">
        <span className="muted small">{ended ? 'Akış bitti' : 'Canlı izleniyor'}</span>
        {!ended && <span className="svc-live" />}
        <div className="spacer" />
        {lacksAccess && (
          <button className="btn btn-sm" onClick={withSudo}>
            sudo ile oku
          </button>
        )}
        <label className="check small">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Sona kaydır
        </label>
      </div>
      <pre
        ref={pre}
        className="svc-log"
        onWheel={(e) => e.deltaY < 0 && follow && setFollow(false)} // yukarı kaydırınca takibi bırak
      >
        {text || (ended ? 'Günlük boş.' : '')}
      </pre>
    </aside>
  )
}
