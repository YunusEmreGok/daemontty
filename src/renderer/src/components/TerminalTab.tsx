import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerStats } from '@shared/types'
import { api, colorFor, formatSize, isMac, uid } from '../api'
import { Tab, useApp } from '../App'
import { registerTab, runInTab } from '../sessions'
import { allThemes, themeForHost } from '../themes'
import { Icon } from './Icon'
import { PaneHandle, PaneShortcut, PaneStatus, TerminalPane } from './TerminalPane'
import { useUi } from './Ui'

interface PaneInfo {
  id: string
  hostId: string
}

const MAX_PANES = 4
const MOD = isMac ? '⌘' : 'Ctrl+Shift+'

export function TerminalTab({ tab, visible, onClose }: { tab: Tab; visible: boolean; onClose(): void }) {
  const { data, updateSettings } = useApp()
  const ui = useUi()
  const settings = data.settings
  // İlk panelin oturum kimliği sekme kimliğiyle aynıdır.
  const [panes, setPanes] = useState<PaneInfo[]>([{ id: tab.id, hostId: tab.hostId }])
  const [focusedId, setFocusedId] = useState(tab.id)
  const [dir, setDir] = useState<'row' | 'col'>('row')
  const [broadcast, setBroadcast] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, PaneStatus>>({})
  const [menu, setMenu] = useState<'snippets' | 'look' | 'split' | null>(null)
  const handles = useRef(new Map<string, PaneHandle>())

  const focused = panes.find((p) => p.id === focusedId) ?? panes[0]
  const host = data.hosts.find((h) => h.id === focused.hostId)
  const theme = themeForHost(settings, host)
  const state = statuses[focused.id] ?? 'connecting'
  const multi = panes.length > 1

  // Snippet/komut paletinin yazacağı hedefler
  const live = useRef({ panes, focusedId, broadcast })
  live.current = { panes, focusedId, broadcast }
  useEffect(
    () =>
      registerTab(tab.id, {
        targets: () => (live.current.broadcast ? live.current.panes.map((p) => p.id) : [live.current.focusedId]),
        focus: () => handles.current.get(live.current.focusedId)?.focus()
      }),
    [tab.id]
  )

  const split = useCallback(
    (direction: 'row' | 'col', hostId?: string) => {
      setMenu(null)
      if (panes.length >= MAX_PANES) return ui.toast(`En fazla ${MAX_PANES} panel açılabilir`, 'error')
      const pane = { id: uid(), hostId: hostId ?? focused.hostId }
      const idx = panes.findIndex((p) => p.id === focused.id)
      if (panes.length === 1) setDir(direction)
      setPanes([...panes.slice(0, idx + 1), pane, ...panes.slice(idx + 1)])
      setFocusedId(pane.id)
    },
    [panes, focused, ui]
  )

  const closePane = (id: string): void => {
    if (panes.length === 1) return onClose()
    const idx = panes.findIndex((p) => p.id === id)
    const next = panes.filter((p) => p.id !== id)
    setPanes(next)
    if (focusedId === id) setFocusedId(next[Math.max(0, idx - 1)].id)
    if (next.length === 1) setBroadcast(false)
  }

  const cycle = (step: number): void => {
    const idx = panes.findIndex((p) => p.id === focusedId)
    setFocusedId(panes[(idx + step + panes.length) % panes.length].id)
  }

  const onShortcut = (s: PaneShortcut, paneId: string): void => {
    if (s === 'split-right') split('row')
    else if (s === 'split-down') split('col')
    else if (s === 'close-pane') closePane(paneId)
    else if (s === 'next-pane') cycle(1)
    else if (s === 'prev-pane') cycle(-1)
    else if (s === 'broadcast' && multi) setBroadcast((b) => !b)
  }

  // Yayın modu: bir panelde yazılan her tuş diğer panellere de gider.
  const onInput = (from: string, d: string): void => {
    if (!live.current.broadcast) return
    live.current.panes.forEach((p) => p.id !== from && api.ssh.write(p.id, d))
  }

  const stats = useServerStats(focused.id, visible && state === 'ready' && settings.showServerStats)

  const runSnippet = (command: string): void => {
    setMenu(null)
    runInTab(tab.id, command)
    handles.current.get(focusedId)?.focus()
  }

  const setHostTheme = (themeId: string | undefined): void => {
    if (host) api.vault.upsert('hosts', { ...host, themeId })
  }

  const stateLabel = state === 'ready' ? 'Bağlı' : state === 'connecting' ? 'Bağlanıyor…' : 'Bağlantı yok'
  const layout = `panes-grid n${panes.length} dir-${dir}`

  return (
    <div
      className={`session session-term ${theme.light ? 'session-light' : ''}`}
      hidden={!visible}
      style={{ ['--term-bg' as string]: theme.background, ['--term-fg' as string]: theme.foreground }}
    >
      <div className="session-bar term-bar">
        <span className={`dot dot-${state}`} />
        <strong>{host?.label ?? tab.title}</strong>
        <span className="term-bar-sub">
          {host ? `${host.username ? host.username + '@' : ''}${host.address}${host.port !== 22 ? ':' + host.port : ''}` : ''}
        </span>
        <span className={`pill pill-${state}`}>{stateLabel}</span>
        {stats && <StatsBar s={stats} />}
        <div className="spacer" />

        {multi && (
          <button
            className={`bar-btn ${broadcast ? 'bar-btn-danger' : ''}`}
            onClick={() => setBroadcast((b) => !b)}
            title={`Yazdıklarınız tüm panellere gider (${isMac ? '⌘⇧B' : 'Ctrl+Shift+B'})`}
          >
            <Icon name="broadcast" size={13} /> {broadcast ? 'Tümüne yazılıyor' : 'Tümüne yaz'}
          </button>
        )}
        <div className="menu-anchor">
          <button className="bar-btn" onClick={() => setMenu(menu === 'split' ? null : 'split')} title="Ekranı böl">
            <Icon name="split" size={13} /> Böl
          </button>
          {menu === 'split' && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              <button className="menu-item menu-row" onClick={() => split('row')} disabled={panes.length >= MAX_PANES}>
                <Icon name="split" size={14} /> Sağa böl <kbd className="menu-kbd">{MOD}D</kbd>
              </button>
              <button className="menu-item menu-row" onClick={() => split('col')} disabled={panes.length >= MAX_PANES}>
                <Icon name="splitDown" size={14} /> Aşağı böl {isMac && <kbd className="menu-kbd">⌘⇧D</kbd>}
              </button>
              <div className="menu-label">Başka sunucuyla böl</div>
              {data.hosts.map((h) => (
                <button key={h.id} className="menu-item menu-row" onClick={() => split(dir, h.id)} disabled={panes.length >= MAX_PANES}>
                  <span className="tab-dot" style={{ background: colorFor(h.id) }} /> {h.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="bar-btn" onClick={() => handles.current.get(focusedId)?.openSearch()} title={isMac ? 'Ara (⌘F)' : 'Ara (Ctrl+Shift+F)'}>
          <Icon name="search" size={13} />
        </button>
        <div className="menu-anchor">
          <button className="bar-btn" onClick={() => setMenu(menu === 'look' ? null : 'look')} title="Terminal görünümü">
            <span className="theme-dot" style={{ background: `linear-gradient(135deg, ${theme.background} 50%, ${theme.cursor} 50%)` }} />
            Görünüm
          </button>
          {menu === 'look' && (
            <div className="menu menu-look" onMouseLeave={() => setMenu(null)}>
              <div className="menu-label">Yazı boyutu</div>
              <div className="font-stepper">
                <button onClick={() => updateSettings({ fontSize: Math.max(9, settings.fontSize - 1) })}>A−</button>
                <span>{settings.fontSize}px</span>
                <button onClick={() => updateSettings({ fontSize: Math.min(28, settings.fontSize + 1) })}>A+</button>
              </div>
              <div className="menu-label">{host?.label ?? 'Bu host'} teması</div>
              <button className={`menu-item theme-item ${!host?.themeId ? 'on' : ''}`} onClick={() => setHostTheme(undefined)}>
                <ThemeChip th={themeForHost(settings)} />
                Genel tema ({themeForHost(settings).name})
                {!host?.themeId && <Icon name="check" size={14} />}
              </button>
              {allThemes(settings).map((th) => (
                <button key={th.id} className={`menu-item theme-item ${host?.themeId === th.id ? 'on' : ''}`} onClick={() => setHostTheme(th.id)}>
                  <ThemeChip th={th} />
                  {th.name}
                  {host?.themeId === th.id && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="menu-anchor">
          <button className="bar-btn" onClick={() => setMenu(menu === 'snippets' ? null : 'snippets')} disabled={state !== 'ready'}>
            <Icon name="code" /> Snippetler
          </button>
          {menu === 'snippets' && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              {broadcast && <div className="menu-label">Tüm panellerde çalışır</div>}
              {data.snippets.length === 0 && <div className="menu-empty">Henüz snippet yok</div>}
              {data.snippets.map((s) => (
                <button key={s.id} className="menu-item" onClick={() => runSnippet(s.command)}>
                  <strong>{s.name}</strong>
                  <code>{s.command.split('\n')[0]}</code>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={layout}>
        {panes.map((p) => (
          <TerminalPane
            key={p.id}
            paneId={p.id}
            hostId={p.hostId}
            visible={visible}
            focused={p.id === focused.id}
            multi={multi}
            broadcast={broadcast}
            onFocus={() => setFocusedId(p.id)}
            onStatus={(s) => setStatuses((m) => (m[p.id] === s ? m : { ...m, [p.id]: s }))}
            onClosePane={() => closePane(p.id)}
            onInput={(d) => onInput(p.id, d)}
            onShortcut={(s) => onShortcut(s, p.id)}
            registerHandle={(h) => (h ? handles.current.set(p.id, h) : handles.current.delete(p.id))}
          />
        ))}
      </div>
    </div>
  )
}

function ThemeChip({ th }: { th: { background: string; green: string; blue: string; red: string } }) {
  return (
    <span className="theme-chip" style={{ background: th.background }}>
      <i style={{ background: th.green }} />
      <i style={{ background: th.blue }} />
      <i style={{ background: th.red }} />
    </span>
  )
}

// --- Sunucu durumu ---

interface StatsView {
  cpu: number | null
  memUsed: number
  memTotal: number
  diskUsed: number
  diskTotal: number
  load: number
  cores: number
}

/** Odaktaki panelin sunucusundan birkaç saniyede bir CPU/RAM/disk okur. */
function useServerStats(sessionId: string, enabled: boolean): StatsView | null {
  const [view, setView] = useState<StatsView | null>(null)
  useEffect(() => {
    setView(null)
    if (!enabled) return
    let prev: ServerStats | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async (): Promise<void> => {
      const s = await api.ssh.stats(sessionId)
      if (stopped) return
      if (!s) return setView(null) // Linux değil: tekrar deneme
      // CPU yüzdesi iki ölçüm arasındaki farktan hesaplanır.
      const cpu = prev && s.cpuTotal > prev.cpuTotal ? (1 - (s.cpuIdle - prev.cpuIdle) / (s.cpuTotal - prev.cpuTotal)) * 100 : null
      prev = s
      setView({
        cpu,
        memUsed: s.memTotal - s.memAvailable,
        memTotal: s.memTotal,
        diskUsed: s.diskUsed,
        diskTotal: s.diskTotal,
        load: s.load1,
        cores: s.cores
      })
      timer = setTimeout(tick, cpu === null ? 1000 : 3000)
    }
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [sessionId, enabled])
  return view
}

function Meter({ label, pct, text, title }: { label: string; pct: number | null; text: string; title: string }) {
  const level = pct === null ? '' : pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok'
  return (
    <span className={`meter meter-${level}`} title={title}>
      <b>{label}</b>
      <span className="meter-bar">
        <i style={{ width: `${Math.min(100, Math.max(2, pct ?? 0))}%` }} />
      </span>
      <span className="meter-text">{text}</span>
    </span>
  )
}

function StatsBar({ s }: { s: StatsView }) {
  const memPct = s.memTotal ? (s.memUsed / s.memTotal) * 100 : null
  const diskPct = s.diskTotal ? (s.diskUsed / s.diskTotal) * 100 : null
  const pct = (n: number | null): string => (n === null ? '…' : `%${Math.round(n)}`)
  return (
    <span className="stats">
      <Meter label="CPU" pct={s.cpu} text={pct(s.cpu)} title={`İşlemci kullanımı · ${s.cores} çekirdek`} />
      <Meter
        label="RAM"
        pct={memPct}
        text={pct(memPct)}
        title={`Bellek: ${formatSize(s.memUsed)} / ${formatSize(s.memTotal)} kullanılıyor`}
      />
      <Meter label="Disk" pct={diskPct} text={pct(diskPct)} title={`Kök disk (/): ${formatSize(s.diskUsed)} / ${formatSize(s.diskTotal)}`} />
      <span className="meter meter-load" title={`Son 1 dakikalık sistem yükü (${s.cores} çekirdek)`}>
        <b>Yük</b>
        <span className="meter-text">{s.load.toFixed(2).replace('.', ',')}</span>
      </span>
    </span>
  )
}
