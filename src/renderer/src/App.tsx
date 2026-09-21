import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Settings, VaultData } from '@shared/types'
import { api, colorFor, isMac, uid } from './api'
import { DEFAULT_SETTINGS, LOCAL_HOST_ID } from '@shared/types'
import { Icon } from './components/Icon'
import { DaemonttyLogo } from './components/DaemonttyLogo'
import { TerminalTab } from './components/TerminalTab'
import { SftpTab } from './components/SftpTab'
import { HostsView } from './views/Hosts'
import { KeychainView } from './views/Keychain'
import { ForwardsView } from './views/Forwards'
import { SnippetsView } from './views/Snippets'
import { SettingsView } from './views/Settings'
import { CommandPalette, View } from './components/CommandPalette'
import { useUi } from './components/Ui'
import { useUpdateState } from './update'
import { lockFlag } from './lock'

export interface Tab {
  id: string
  kind: 'terminal' | 'sftp'
  hostId: string
  title: string
  pinned?: boolean
  /** Bağlantı kurulunca bir kez çalıştırılacak komut (snippet'i kapalı sunucularda çalıştırma) */
  initialCommand?: string
}


interface AppCtx {
  data: VaultData
  tabs: Tab[]
  /** title verilirse host henüz arayüz verisine gelmemiş olsa da sekme açılır (hızlı bağlantı). */
  openTab(kind: Tab['kind'], hostId: string, title?: string, opts?: { command?: string; background?: boolean }): void
  focusTab(id: string): void
  /** Ayarı ekranda hemen uygular, diske kısa bir gecikmeyle toplu yazar. */
  updateSettings(patch: Partial<Settings>): void
}

const Ctx = createContext<AppCtx>(null as never)
export const useApp = (): AppCtx => useContext(Ctx)

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: 'hosts', label: 'Hostlar', icon: 'server' },
  { id: 'keychain', label: 'Keychain', icon: 'key' },
  { id: 'forwards', label: 'Port Yönlendirme', icon: 'forward' },
  { id: 'snippets', label: 'Snippetler', icon: 'code' },
  { id: 'settings', label: 'Ayarlar', icon: 'settings' }
]

const HOME = 'home'
export const LOCAL_TITLE = 'Yerel terminal'

export default function App() {
  const [data, setData] = useState<VaultData | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string>(HOME)
  const [view, setView] = useState<View>('hosts')
  const [palette, setPalette] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const restoredPins = useRef(false)
  const ui = useUi()
  const update = useUpdateState()
  const promptedUpdate = useRef<string | null>(null)

  // Yeni sürüm hazır olunca bir kez sor; yeniden başlatmak açık oturumları kapatacağı için onay şart.
  useEffect(() => {
    if (update.status !== 'ready' && update.status !== 'available') return
    // Her aşama (bulundu / indirildi) sürüm başına bir kez sorulur.
    const key = `${update.status}:${update.version}`
    if (promptedUpdate.current === key) return
    promptedUpdate.current = key
    if (update.status === 'ready') {
      ui.confirm(
        `Daemontty ${update.version} indirildi`,
        'Yeniden başlatınca kurulur; açık oturumlar kapanır. Şimdi değilse uygulamadan çıkarken kurulacak.',
        { confirmLabel: 'Yeniden başlat' }
      ).then((ok) => ok && api.update.install())
    } else {
      // Hayır denirse üst çubuktaki "Yeni sürüm mevcut" düğmesi kalır.
      ui.confirm(
        `Yeni sürüm var: Daemontty ${update.version}`,
        (update.notes ? update.notes + '\n\n' : '') +
          (update.manual ? 'Bu platformda güncelleme elle kurulur. İndirme sayfası açılsın mı?' : 'Şimdi indirilsin mi? Açık oturumlarınız indirme sırasında etkilenmez.'),
        { confirmLabel: update.manual ? 'İndirme sayfasını aç' : 'Güncelle', cancelLabel: 'Şimdi değil' }
      ).then((ok) => ok && api.update.download())
    }
  }, [update, ui])

  // Kaydedilmeyi bekleyen ayarlar; kaydırıcı sürüklenirken diskten gelen eski değer ekranı geri almasın.
  const pendingSettings = useRef<Settings | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const apply = (d: VaultData): void =>
      setData(pendingSettings.current ? { ...d, settings: pendingSettings.current } : d)
    api.vault.get().then(apply)
    return api.vault.onChange(apply)
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((d) => {
      if (!d) return d
      const settings = { ...d.settings, ...patch }
      pendingSettings.current = settings
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        api.vault.saveSettings(settings).finally(() => {
          if (pendingSettings.current === settings) pendingSettings.current = null
        })
      }, 250)
      return { ...d, settings }
    })
  }, [])

  const openTab = useCallback(
    (kind: Tab['kind'], hostId: string, title?: string, opts?: { command?: string; background?: boolean }) => {
      const label = title ?? data?.hosts.find((h) => h.id === hostId)?.label
      if (!label) return
      const tab: Tab = { id: uid(), kind, hostId, title: label, initialCommand: opts?.command }
      setTabs((t) => [...t, tab])
      if (!opts?.background) setActive(tab.id)
    },
    [data]
  )

  /** Birden çok sekmeyi kapatır; aktif sekme kapandıysa en yakın komşuya geçer. */
  const closeTabs = (ids: string[]): void => {
    if (!ids.length) return
    const drop = new Set(ids)
    const next = tabs.filter((x) => !drop.has(x.id))
    setTabs(next)
    if (drop.has(active)) {
      const idx = tabs.findIndex((x) => x.id === active)
      const after = tabs.slice(idx + 1).find((x) => !drop.has(x.id))
      const before = tabs.slice(0, idx).reverse().find((x) => !drop.has(x.id))
      setActive((after ?? before)?.id ?? HOME)
    }
  }
  const closeTab = (id: string): void => closeTabs([id])

  // Sekme dizisinde sabitlenmişler her zaman başta durur.
  const pinnedCount = tabs.filter((t) => t.pinned).length

  const setPinned = (id: string, pinned: boolean): void => {
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    const rest = tabs.filter((t) => t.id !== id)
    const at = rest.filter((t) => t.pinned).length
    setTabs([...rest.slice(0, at), { ...tab, pinned }, ...rest.slice(at)])
  }

  const duplicateTab = (id: string): void => {
    const src = tabs.find((t) => t.id === id)
    if (!src) return
    const copy: Tab = { id: uid(), kind: src.kind, hostId: src.hostId, title: src.title }
    const idx = Math.max(tabs.indexOf(src), pinnedCount - 1)
    setTabs([...tabs.slice(0, idx + 1), copy, ...tabs.slice(idx + 1)])
    setActive(copy.id)
  }

  // Sürükleyerek sıralama: imleç hedef sekmenin ortasını geçince yer değiştirir (titremeyi önler).
  // Sabitlenmişler ve diğerleri kendi bölgelerinde kalır.
  const dragTab = useRef<string | null>(null)
  const onTabDragOver = (e: React.DragEvent, overId: string): void => {
    const from = dragTab.current
    if (!from) return
    e.preventDefault()
    if (from === overId) return
    const a = tabs.findIndex((t) => t.id === from)
    const b = tabs.findIndex((t) => t.id === overId)
    if (a < 0 || b < 0 || !!tabs[a].pinned !== !!tabs[b].pinned) return
    const r = e.currentTarget.getBoundingClientRect()
    const mid = r.left + r.width / 2
    if (a < b ? e.clientX < mid : e.clientX > mid) return
    const next = [...tabs]
    next.splice(b, 0, next.splice(a, 1)[0])
    setTabs(next)
  }

  // Açılışta sabitlenmiş sekmeleri geri yükle (bir kez).
  useEffect(() => {
    if (!data || restoredPins.current) return
    restoredPins.current = true
    const restored = data.settings.pinnedTabs
      .map((p) => ({ p, title: p.hostId === LOCAL_HOST_ID ? LOCAL_TITLE : data.hosts.find((h) => h.id === p.hostId)?.label }))
      .filter((x) => x.title)
      .map(({ p, title }) => ({ id: uid(), kind: p.kind, hostId: p.hostId, title: title!, pinned: true }))
    if (restored.length) setTabs((t) => [...restored, ...t])
  }, [data])

  // Sabitlenmiş sekmeler değişince ayarlara kaydet.
  useEffect(() => {
    if (!data || !restoredPins.current) return
    const pins = tabs.filter((t) => t.pinned).map((t) => ({ kind: t.kind, hostId: t.hostId }))
    if (JSON.stringify(pins) !== JSON.stringify(data.settings.pinnedTabs)) updateSettings({ pinnedTabs: pins })
  }, [tabs, data, updateSettings])

  // Ctrl/Cmd+1..9 ile sekmeler arasında geçiş
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (lockFlag.locked || !(isMac ? e.metaKey : e.ctrlKey) || e.altKey) return
      // Komut paleti: Cmd+K (macOS) / Ctrl+Shift+K (Ctrl+K kabukta satır silme kısayolu olduğu için)
      if (e.code === 'KeyK' && (isMac || e.shiftKey)) {
        e.preventDefault()
        e.stopPropagation()
        setPalette((p) => !p)
        return
      }
      // Terminal yazı boyutu: Cmd/Ctrl + / - / 0
      if (data && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0')) {
        e.preventDefault()
        const cur = data.settings.fontSize
        const next = e.key === '0' ? DEFAULT_SETTINGS.fontSize : Math.max(9, Math.min(28, cur + (e.key === '-' ? -1 : 1)))
        if (next !== cur) updateSettings({ fontSize: next })
        return
      }
      // Yerel terminal: Cmd+T (macOS) / Ctrl+Shift+T
      if (e.code === 'KeyT' && (isMac ? !e.shiftKey : e.shiftKey)) {
        e.preventDefault()
        e.stopPropagation()
        openTab('terminal', LOCAL_HOST_ID, LOCAL_TITLE)
        return
      }
      if (e.shiftKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= 9) {
        e.preventDefault()
        setActive(n === 1 ? HOME : (tabs[n - 2]?.id ?? active))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tabs, active, data, updateSettings, openTab])

  if (!data) return <div className="loading">Yükleniyor…</div>

  return (
    <Ctx.Provider value={{ data, tabs, openTab, focusTab: setActive, updateSettings }}>
      <div className="app">
        <div className={`tabbar ${isMac ? 'tabbar-mac' : ''}`}>
          <button className={`tab tab-home ${active === HOME ? 'active' : ''}`} onClick={() => setActive(HOME)} title="Daemontty Ana Sayfa">
            <DaemonttyLogo size={16} />
            <span>Sunucular</span>
          </button>
          <button
            className="tab-new"
            onClick={() => openTab('terminal', LOCAL_HOST_ID, LOCAL_TITLE)}
            title={`Yerel terminal (${isMac ? '⌘T' : 'Ctrl+Shift+T'})`}
          >
            <Icon name="plus" size={14} />
          </button>
          {update.status === 'available' && (
            <button className="update-pill" onClick={() => api.update.download()} title={`Daemontty ${update.version} — ${update.manual ? 'indirme sayfasını aç' : 'indir ve güncelle'}`}>
              <Icon name="download" size={13} /> Yeni sürüm mevcut
            </button>
          )}
          {update.status === 'downloading' && (
            <span className="update-pill update-pill-busy">
              <Icon name="download" size={13} /> İndiriliyor %{update.percent}
            </span>
          )}
          {update.status === 'ready' && (
            <button className="update-pill" onClick={() => api.update.install()} title="Açık oturumlar kapanır">
              <Icon name="refresh" size={13} /> Yeniden başlat ve güncelle
            </button>
          )}
          <button className="palette-trigger" onClick={() => setPalette(true)} title="Komut paleti">
            <Icon name="search" size={13} />
            <span>Ara ya da bağlan…</span>
            <kbd>{isMac ? '⌘K' : 'Ctrl⇧K'}</kbd>
          </button>
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab ${active === t.id ? 'active' : ''} ${t.pinned ? 'tab-pinned' : ''} ${tabMenu?.id === t.id ? 'menu-open' : ''}`}
              onClick={() => setActive(t.id)}
              draggable
              onDragStart={(e) => {
                dragTab.current = t.id
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-daemontty-tab', t.id) // düz metin değil: terminale bırakılırsa yazı yapışmasın
              }}
              onDragOver={(e) => onTabDragOver(e, t.id)}
              onDragEnd={() => (dragTab.current = null)}
              onMouseDown={(e) => e.button === 1 && !t.pinned && closeTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setTabMenu({ id: t.id, x: e.clientX, y: e.clientY })
              }}
              title={t.pinned ? `${t.title} (sabitlendi)` : t.title}
            >
              <span className="tab-dot" style={{ background: colorFor(t.hostId) }} />
              <Icon name={t.kind === 'terminal' ? 'terminal' : 'folder'} />
              <span className="tab-title">{t.kind === 'sftp' ? `SFTP · ${t.title}` : t.title}</span>
              {t.pinned ? (
                <span className="tab-pin" title="Sabitlendi">
                  <Icon name="pin" size={12} />
                </span>
              ) : (
                <button
                  className="tab-close"
                  title="Sekmeyi kapat"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="content">
          <div className="home" hidden={active !== HOME}>
            <nav className="sidebar">
              <div className="brand">
                <div className="brand-logo" title="Daemontty">
                  <DaemonttyLogo size={24} />
                </div>
                <div className="brand-text">
                  <span className="brand-title">Daemontty</span>
                  <span className="brand-badge">TTY</span>
                </div>
              </div>
              {NAV.map((n) => (
                <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                  {n.id === 'hosts' && <em>{data.hosts.length}</em>}
                </button>
              ))}
              <div className={`sidebar-foot ${data.encrypted ? "" : "sidebar-foot-bad"}`}>
                <Icon name="lock" size={13} />
                <span>{data.encrypted ? 'Veriler şifreli' : 'Veriler şifresiz!'}</span>
              </div>
            </nav>
            <main className="main">
              {view === 'hosts' && <HostsView />}
              {view === 'keychain' && <KeychainView />}
              {view === 'forwards' && <ForwardsView />}
              {view === 'snippets' && <SnippetsView />}
              {view === 'settings' && <SettingsView />}
            </main>
          </div>

          {tabs.map((t) =>
            t.kind === 'terminal' ? (
              <TerminalTab key={t.id} tab={t} visible={active === t.id} onClose={() => closeTab(t.id)} />
            ) : (
              <SftpTab key={t.id} tab={t} visible={active === t.id} />
            )
          )}
        </div>
      </div>
      {tabMenu &&
        (() => {
          const idx = tabs.findIndex((t) => t.id === tabMenu.id)
          const tab = tabs[idx]
          if (!tab) return null
          const others = tabs.filter((t) => t.id !== tab.id && !t.pinned)
          const right = tabs.slice(idx + 1).filter((t) => !t.pinned)
          const left = tabs.slice(0, idx).filter((t) => !t.pinned)
          const unpinned = tabs.filter((t) => !t.pinned)
          const act = (fn: () => void) => () => {
            setTabMenu(null)
            fn()
          }
          return (
            <TabMenu x={tabMenu.x} y={tabMenu.y} onClose={() => setTabMenu(null)}>
              <button className="menu-item menu-row" onClick={act(() => setPinned(tab.id, !tab.pinned))}>
                <Icon name="pin" size={14} /> {tab.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
              </button>
              <button className="menu-item menu-row" onClick={act(() => duplicateTab(tab.id))}>
                <Icon name="copy" size={14} /> Çoğalt (yeni oturum)
              </button>
              <div className="menu-sep" />
              <button className="menu-item menu-row" onClick={act(() => closeTab(tab.id))}>
                <Icon name="x" size={14} /> Kapat
              </button>
              <button className="menu-item menu-row" disabled={!others.length} onClick={act(() => closeTabs(others.map((t) => t.id)))}>
                Diğerlerini kapat
              </button>
              <button className="menu-item menu-row" disabled={!right.length} onClick={act(() => closeTabs(right.map((t) => t.id)))}>
                Sağdakileri kapat
              </button>
              <button className="menu-item menu-row" disabled={!left.length} onClick={act(() => closeTabs(left.map((t) => t.id)))}>
                Soldakileri kapat
              </button>
              <div className="menu-sep" />
              <button className="menu-item menu-row danger" disabled={!unpinned.length} onClick={act(() => closeTabs(unpinned.map((t) => t.id)))}>
                Tümünü kapat
              </button>
              {pinnedCount > 0 && <div className="menu-note">Sabitlenmiş sekmeler toplu kapatmadan etkilenmez.</div>}
            </TabMenu>
          )
        })()}
      {palette && (
        <CommandPalette
          onClose={() => setPalette(false)}
          setView={(v) => {
            setView(v)
            setActive(HOME)
          }}
          activeTab={tabs.find((t) => t.id === active)}
        />
      )}
    </Ctx.Provider>
  )
}

/** Fare konumunda açılan, ekran dışına taşmayan küçük menü. */
function TabMenu({ x, y, onClose, children }: { x: number; y: number; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // onClose her çizimde yeni bir fonksiyon; efekti yeniden tetiklemesin diye ref'te tut.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onClose = (): void => closeRef.current()
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) })
    }
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [x, y])

  return (
    <div ref={ref} className="menu context-menu tab-menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  )
}
