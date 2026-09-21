import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry, TransferProgress } from '@shared/types'
import { api, colorFor, errMsg, formatDate, formatSize, uid } from '../api'
import { Tab, useApp } from '../App'
import { Icon } from './Icon'
import { useUi } from './Ui'

const DRAG_TYPE = 'application/x-kabuk-files'
const isWinLocal = api.platform === 'win32'

// --- Yol yardımcıları (uzak taraf her zaman POSIX) ---

function join(dir: string, name: string, remote: boolean): string {
  const sep = remote || !isWinLocal ? '/' : '\\'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

function parent(p: string, remote: boolean): string {
  if (remote || !isWinLocal) {
    if (p === '/' || !p) return '/'
    const i = p.replace(/\/+$/, '').lastIndexOf('/')
    return i <= 0 ? '/' : p.slice(0, i)
  }
  const trimmed = p.replace(/\\+$/, '')
  const i = trimmed.lastIndexOf('\\')
  if (i < 0) return p
  const up = trimmed.slice(0, i)
  return /^[A-Za-z]:$/.test(up) ? up + '\\' : up
}

interface PaneApi {
  list(p: string): Promise<FileEntry[]>
  mkdir(p: string): Promise<void>
  rename(a: string, b: string): Promise<void>
  remove(e: FileEntry): Promise<void>
}

type Side = 'left' | 'right'

interface PaneProps {
  side: Side
  tabId: string
  remote: boolean
  /** Başlıktaki kaynak seçici */
  picker: React.ReactNode
  cwd: string
  setCwd(p: string): void
  ops: PaneApi
  reloadKey: number
  /** Diğer panelden sürüklenen ya da işletim sisteminden bırakılan dosyalar */
  onDropPaths(paths: string[], from: Side | 'os'): void
  transferLabel: string
  onTransfer(paths: string[]): void
  onReveal?(p: string): void
  /** Klasör içeriği değişince (üzerine yazma kontrolü için) */
  onEntries(entries: FileEntry[]): void
}

function FilePane(props: PaneProps) {
  const { side, cwd, ops, reloadKey, remote } = props
  const ui = useUi()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathInput, setPathInput] = useState(cwd)
  const [showHidden, setShowHidden] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null)

  // Sadece en son istenen listenin sonucu uygulanır: klasör hızlı değişirse ya da panel
  // kaynağı değişip bu bileşen kaldırılırsa geç gelen eski sonuçlar yok sayılır.
  const loadSeq = useRef(0)
  useEffect(() => () => void (loadSeq.current = -1), [])

  const load = useCallback(async () => {
    if (!cwd) return
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const list = await ops.list(cwd)
      if (seq !== loadSeq.current) return
      list.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'tr') : a.isDir ? -1 : 1))
      setEntries(list)
      props.onEntries(list)
      setSelected(new Set())
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(errMsg(e))
      setEntries([])
      props.onEntries([])
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [cwd, ops])

  useEffect(() => {
    setPathInput(cwd)
    load()
  }, [cwd, reloadKey, load])

  const visibleEntries = useMemo(
    () => (showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))),
    [entries, showHidden]
  )

  const open = (e: FileEntry): void => {
    if (e.isDir) props.setCwd(e.path)
  }

  const clickRow = (e: React.MouseEvent, entry: FileEntry): void => {
    setSelected((prev) => {
      const next = new Set(e.metaKey || e.ctrlKey ? prev : [])
      if (next.has(entry.path) && (e.metaKey || e.ctrlKey)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }

  const mkdir = async (): Promise<void> => {
    const name = await ui.ask('Yeni klasör', 'Klasör adı')
    if (!name) return
    try {
      await ops.mkdir(join(cwd, name, remote))
      load()
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  const rename = async (entry: FileEntry): Promise<void> => {
    const name = await ui.ask('Yeniden adlandır', 'Yeni ad', entry.name)
    if (!name || name === entry.name) return
    try {
      await ops.rename(entry.path, join(cwd, name, remote))
      load()
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  const remove = async (targets: FileEntry[]): Promise<void> => {
    if (!targets.length) return
    const names = targets.length === 1 ? `"${targets[0].name}"` : `${targets.length} öğe`
    const ok = await ui.confirm(
      `${names} silinsin mi?`,
      remote ? 'Sunucudaki dosyalar kalıcı olarak silinir. Klasörler içerikleriyle birlikte silinir.' : 'Öğeler çöp kutusuna taşınır.',
      { confirmLabel: 'Sil', danger: true }
    )
    if (!ok) return
    for (const t of targets) {
      try {
        await ops.remove(t)
      } catch (e) {
        ui.toast(`${t.name}: ${errMsg(e)}`, 'error')
      }
    }
    load()
  }

  const selectedEntries = entries.filter((e) => selected.has(e.path))

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const internal = e.dataTransfer.getData(DRAG_TYPE)
    if (internal) {
      const { tabId, from, paths } = JSON.parse(internal) as { tabId: string; from: Side; paths: string[] }
      if (tabId === props.tabId && from !== side) props.onDropPaths(paths, from)
      return
    }
    if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => api.local.pathForFile(f)).filter(Boolean)
      props.onDropPaths(paths, 'os')
    }
  }

  return (
    <section
      className={`pane ${dragOver ? 'pane-drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={onDrop}
      onClick={() => setMenu(null)}
    >
      <header className="pane-header">
        <div className="pane-title">{props.picker}</div>
        <div className="pane-tools">
          <button className="icon-btn" title="Üst klasör" onClick={() => props.setCwd(parent(cwd, remote))}>
            <Icon name="up" />
          </button>
          <button className="icon-btn" title="Yenile" onClick={load}>
            <Icon name="refresh" />
          </button>
          <button className="icon-btn" title="Yeni klasör" onClick={mkdir}>
            <Icon name="newFolder" />
          </button>
          <button
            className={`icon-btn ${showHidden ? 'on' : ''}`}
            title="Gizli dosyaları göster"
            onClick={() => setShowHidden((v) => !v)}
          >
            <Icon name="eye" />
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={!selected.size}
            onClick={() => props.onTransfer([...selected])}
          >
            {side === 'right' && <Icon name="arrowLeft" />}
            {props.transferLabel}
            {side === 'left' && <Icon name="arrowRight" />}
          </button>
        </div>
      </header>
      <form
        className="pathbar"
        onSubmit={(e) => {
          e.preventDefault()
          props.setCwd(pathInput.trim() || cwd)
        }}
      >
        <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} spellCheck={false} />
      </form>
      <div className="file-list" onKeyDown={(e) => e.key === 'Delete' && remove(selectedEntries)} tabIndex={0}>
        <div className="file-row file-head">
          <span>Ad</span>
          <span>Boyut</span>
          <span>Değiştirilme</span>
        </div>
        {loading && <div className="pane-msg">Yükleniyor…</div>}
        {error && (
          <div className="pane-msg pane-error">
            <Icon name="alert" /> {error}
          </div>
        )}
        {!loading && !error && visibleEntries.length === 0 && <div className="pane-msg">Klasör boş</div>}
        {!loading &&
          visibleEntries.map((entry) => (
            <div
              key={entry.path}
              className={`file-row ${selected.has(entry.path) ? 'selected' : ''}`}
              draggable
              onDragStart={(e) => {
                const paths = selected.has(entry.path) ? [...selected] : [entry.path]
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ tabId: props.tabId, from: side, paths }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={(e) => clickRow(e, entry)}
              onDoubleClick={() => open(entry)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (!selected.has(entry.path)) setSelected(new Set([entry.path]))
                setMenu({ x: e.clientX, y: e.clientY, entry })
              }}
            >
              <span className="file-name">
                <Icon name={entry.isDir ? 'folder' : entry.isLink ? 'link' : 'file'} className={entry.isDir ? 'ico-dir' : ''} />
                {entry.name}
              </span>
              <span className="muted">{entry.isDir ? '—' : formatSize(entry.size)}</span>
              <span className="muted">{formatDate(entry.mtime)}</span>
            </div>
          ))}
      </div>
      {menu && (
        <div className="menu context-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          {menu.entry.isDir && (
            <button className="menu-item" onClick={() => open(menu.entry)}>
              Aç
            </button>
          )}
          <button className="menu-item" onClick={() => props.onTransfer(selected.size ? [...selected] : [menu.entry.path])}>
            {props.transferLabel}
          </button>
          <button className="menu-item" onClick={() => rename(menu.entry)}>
            Yeniden adlandır
          </button>
          {props.onReveal && (
            <button className="menu-item" onClick={() => props.onReveal!(menu.entry.path)}>
              {api.platform === 'darwin' ? "Finder'da göster" : 'Klasörde göster'}
            </button>
          )}
          <button className="menu-item danger" onClick={() => remove(selectedEntries.length ? selectedEntries : [menu.entry])}>
            Sil
          </button>
        </div>
      )}
    </section>
  )
}

type Source = { kind: 'local' } | { kind: 'remote'; hostId: string }

interface PaneState {
  source: Source
  /** Uzak kaynakta bu panele ait SFTP oturumu */
  sftpId: string | null
  status: 'connecting' | 'ready' | 'error'
  error?: string
  cwd: string
  reload: number
}

const basename = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

export function SftpTab({ tab, visible }: { tab: Tab; visible: boolean }) {
  const { data } = useApp()
  const ui = useUi()
  const [panes, setPanes] = useState<Record<Side, PaneState>>({
    left: { source: { kind: 'local' }, sftpId: null, status: 'connecting', cwd: '', reload: 0 },
    right: { source: { kind: 'remote', hostId: tab.hostId }, sftpId: null, status: 'connecting', cwd: '', reload: 0 }
  })
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({})
  const entries = useRef<Record<Side, FileEntry[]>>({ left: [], right: [] })
  const live = useRef(panes)
  live.current = panes

  const patch = (side: Side, p: Partial<PaneState>): void => setPanes((ps) => ({ ...ps, [side]: { ...ps[side], ...p } }))

  /** Panelin kaynağını açar; önceki uzak oturum varsa kapatılır. */
  const openSource = useCallback(
    async (side: Side, source: Source) => {
      const old = live.current[side].sftpId
      if (old) api.sftp.close(old)
      entries.current[side] = []
      if (source.kind === 'local') {
        const home = await api.local.home()
        patch(side, { source, sftpId: null, status: 'ready', error: undefined, cwd: home })
        return
      }
      const sftpId = `${tab.id}:${side}:${uid()}`
      patch(side, { source, sftpId, status: 'connecting', error: undefined, cwd: '' })
      try {
        const home = await api.sftp.open(sftpId, source.hostId)
        if (live.current[side].sftpId === sftpId) patch(side, { status: 'ready', cwd: home })
      } catch (e) {
        if (live.current[side].sftpId === sftpId) patch(side, { status: 'error', error: errMsg(e) })
      }
    },
    [tab.id]
  )

  useEffect(() => {
    openSource('left', { kind: 'local' })
    openSource('right', { kind: 'remote', hostId: tab.hostId })
    const off = api.sftp.onProgress((p) => {
      if (!p.sftpId.startsWith(tab.id + ':')) return
      setTransfers((t) => ({ ...t, [p.id]: p }))
      if (p.state === 'done') setPanes((ps) => ({ left: { ...ps.left, reload: ps.left.reload + 1 }, right: { ...ps.right, reload: ps.right.reload + 1 } }))
      if (p.state === 'error') ui.toast(`${p.name}: ${p.error}`, 'error')
    })
    return () => {
      off()
      Object.values(live.current).forEach((pn) => pn.sftpId && api.sftp.close(pn.sftpId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const opsFor = (pn: PaneState): PaneApi =>
    pn.sftpId
      ? {
          list: (p) => api.sftp.list(pn.sftpId!, p),
          mkdir: (p) => api.sftp.mkdir(pn.sftpId!, p),
          rename: (a, b) => api.sftp.rename(pn.sftpId!, a, b),
          remove: (e) => api.sftp.remove(pn.sftpId!, e.path, e.isDir)
        }
      : {
          list: (p) => api.local.list(p),
          mkdir: (p) => api.local.mkdir(p),
          rename: (a, b) => api.local.rename(a, b),
          remove: (e) => api.local.remove(e.path)
        }
  const leftOps = useMemo(() => opsFor(panes.left), [panes.left.sftpId]) // eslint-disable-line react-hooks/exhaustive-deps
  const rightOps = useMemo(() => opsFor(panes.right), [panes.right.sftpId]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Seçilen dosyaları karşı panele kopyalar. Yöntem iki tarafın türüne göre seçilir:
   * yerel→sunucu yükleme, sunucu→yerel indirme, sunucu→sunucu uygulama üzerinden akış.
   */
  const transfer = async (from: Side | 'os', paths: string[], to: Side): Promise<void> => {
    const dst = live.current[to]
    const src = from === 'os' ? null : live.current[from]
    if (dst.status !== 'ready') return ui.toast('Hedef panel hazır değil', 'error')
    const existing = new Set(entries.current[to].map((e) => e.name))
    const clash = paths.map(basename).filter((n) => existing.has(n))
    if (
      clash.length &&
      !(await ui.confirm(
        clash.length === 1 ? `"${clash[0]}" hedefte zaten var` : `${clash.length} öğe hedefte zaten var`,
        'Üzerine yazılsın mı?',
        { confirmLabel: 'Üzerine yaz', danger: true }
      ))
    )
      return
    const srcRemote = src?.sftpId ?? null
    try {
      if (!srcRemote && !dst.sftpId) {
        await api.local.copy(paths, dst.cwd)
        patch(to, { reload: dst.reload + 1 })
        ui.toast('Kopyalandı', 'success')
      } else if (!srcRemote) await api.sftp.upload(dst.sftpId!, paths, dst.cwd)
      else if (!dst.sftpId) await api.sftp.download(srcRemote, paths, dst.cwd)
      else await api.sftp.copy(srcRemote, paths, dst.sftpId, dst.cwd)
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  const label = (pn: PaneState): string =>
    pn.source.kind === 'local' ? 'Bu bilgisayar' : (data.hosts.find((h) => h.id === (pn.source as { hostId: string }).hostId)?.label ?? 'Sunucu')

  const picker = (side: Side): React.ReactNode => {
    const pn = panes[side]
    const value = pn.source.kind === 'local' ? 'local' : pn.source.hostId
    return (
      <label className="source-picker" title="Bu panelde gösterilecek konum">
        {pn.source.kind === 'local' ? (
          <Icon name="home" />
        ) : (
          <span className="tab-dot" style={{ background: colorFor(pn.source.hostId) }} />
        )}
        <select
          value={value}
          onChange={(e) => openSource(side, e.target.value === 'local' ? { kind: 'local' } : { kind: 'remote', hostId: e.target.value })}
        >
          <option value="local">Bu bilgisayar</option>
          <optgroup label="Sunucular">
            {data.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </optgroup>
        </select>
        <Icon name="chevronDown" size={12} />
      </label>
    )
  }

  const renderPane = (side: Side): React.ReactNode => {
    const pn = panes[side]
    const other: Side = side === 'left' ? 'right' : 'left'
    if (pn.status !== 'ready')
      return (
        <section className="pane">
          <header className="pane-header">
            <div className="pane-title">{picker(side)}</div>
          </header>
          <div className="center-msg">
            {pn.status === 'connecting' ? (
              `${label(pn)} bağlanılıyor…`
            ) : (
              <>
                <Icon name="alert" size={22} />
                <p>{pn.error}</p>
                <button className="btn btn-primary" onClick={() => openSource(side, pn.source)}>
                  Tekrar dene
                </button>
              </>
            )}
          </div>
        </section>
      )
    return (
      <FilePane
        key={pn.sftpId ?? 'local-' + side}
        side={side}
        tabId={tab.id}
        remote={!!pn.sftpId}
        picker={picker(side)}
        cwd={pn.cwd}
        setCwd={(cwd) => patch(side, { cwd })}
        ops={side === 'left' ? leftOps : rightOps}
        reloadKey={pn.reload}
        transferLabel={side === 'left' ? 'Sağa kopyala' : 'Sola kopyala'}
        onTransfer={(paths) => transfer(side, paths, other)}
        onDropPaths={(paths, from) => transfer(from, paths, side)}
        onReveal={pn.sftpId ? undefined : (p) => api.local.reveal(p)}
        onEntries={(list) => (entries.current[side] = list)}
      />
    )
  }

  const list = Object.values(transfers)
  const active = list.filter((t) => t.state === 'running')
  const ready = panes.left.status === 'ready' && panes.right.status === 'ready'

  return (
    <div className="session" hidden={!visible}>
      <div className="session-bar">
        <span className={`dot dot-${ready ? 'ready' : 'connecting'}`} />
        <strong>SFTP</strong>
        <span className="muted">
          {label(panes.left)} ⇄ {label(panes.right)}
        </span>
        <div className="spacer" />
        {active.length > 0 && <span className="muted">{active.length} aktarım sürüyor</span>}
      </div>
      <div className="panes">
        {renderPane('left')}
        {renderPane('right')}
      </div>
      {list.length > 0 && (
        <div className="transfers">
          <div className="transfers-head">
            <strong>Aktarımlar</strong>
            <button
              className="btn btn-sm"
              onClick={() => setTransfers((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.state === 'running')))}
            >
              Bitenleri temizle
            </button>
          </div>
          {list
            .slice()
            .reverse()
            .map((t) => {
              const pct = t.total ? Math.min(100, Math.round((t.transferred / t.total) * 100)) : t.state === 'done' ? 100 : 0
              return (
                <div key={t.id} className={`transfer transfer-${t.state}`}>
                  <Icon name={t.direction === 'upload' ? 'upload' : t.direction === 'download' ? 'download' : 'copy'} />
                  <span className="transfer-name">{t.name}</span>
                  <div className="progress">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <span className="muted transfer-info">
                    {t.state === 'error' ? 'Hata' : t.state === 'done' ? 'Tamamlandı' : `${pct}% · ${formatSize(t.transferred)} / ${formatSize(t.total)}`}
                  </span>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
