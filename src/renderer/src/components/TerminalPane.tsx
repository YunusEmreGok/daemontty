import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { LOCAL_HOST_ID } from '@shared/types'
import { api, colorFor, isMac, subscribeSession } from '../api'
import { useApp } from '../App'
import { ensureFont, themeForHost, toXterm } from '../themes'
import { useAutocomplete } from '../autocomplete/useAutocomplete'
import { Icon } from './Icon'

export type PaneStatus = 'connecting' | 'ready' | 'closed'

export type PaneShortcut = 'split-right' | 'split-down' | 'close-pane' | 'next-pane' | 'prev-pane' | 'broadcast'

export interface PaneHandle {
  openSearch(): void
  focus(): void
  reconnect(): void
}

interface Props {
  paneId: string
  hostId: string
  /** İlk bağlantıda bir kez çalıştırılır */
  initialCommand?: string
  /** Sekme görünür mü */
  visible: boolean
  focused: boolean
  /** Sekmede birden fazla panel var mı (panel başlığı gösterilir) */
  multi: boolean
  broadcast: boolean
  onFocus(): void
  onStatus(s: PaneStatus): void
  onClosePane(): void
  /** Kullanıcının yazdığı veri (yayın modunda diğer panellere kopyalanır) */
  onInput(data: string): void
  onShortcut(s: PaneShortcut): void
  registerHandle(h: PaneHandle | null): void
}

const PANE_SHORTCUTS: Record<string, PaneShortcut> = {
  KeyD: 'split-right',
  KeyW: 'close-pane',
  BracketRight: 'next-pane',
  BracketLeft: 'prev-pane'
}

// Yeniden bağlanma aralıkları (sn); bittiğinde vazgeçilir.
const RETRY_DELAYS = [1, 2, 4, 8, 15, 30, 30, 30]

interface Conn {
  status: PaneStatus
  error?: string
  /** Geri sayımdaki yeniden bağlanma denemesi */
  retry?: { attempt: number; at: number }
  exited?: boolean
}

export function TerminalPane(p: Props) {
  const { data } = useApp()
  const host = data.hosts.find((h) => h.id === p.hostId)
  const settings = data.settings
  const theme = themeForHost(settings, host)

  const el = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState<{ query: string; caseSensitive: boolean } | null>(null)
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)
  const [conn, setConn] = useState<Conn>({ status: 'connecting' })
  const [, setTick] = useState(0)

  // Terminal olay işleyicileri bir kez kurulur; güncel prop/durumlara ref üzerinden erişir.
  const props = useRef(p)
  props.current = p
  const connRef = useRef(conn)
  connRef.current = conn
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const everConnected = useRef(false)
  const ranInitial = useRef(false)
  /** Ekrandaki soluk "bağlanılıyor…" satırlarının sayısı; sunucudan ilk veri gelince silinirler. */
  const statusLines = useRef(0)
  /** Yeniden bağlanma başarılı olunca sunucunun ilk çıktısından önce bir kez duyurulur. */
  const announceReconnect = useRef(false)

  const ac = useAutocomplete({ termRef, wrapRef, sessionId: p.paneId, hostId: p.hostId, settings, snippets: data.snippets, theme })

  useEffect(() => p.onStatus(conn.status), [conn.status]) // eslint-disable-line react-hooks/exhaustive-deps

  function enableWebgl(term: Terminal): void {
    if (webglRef.current) return
    try {
      const gl = new WebglAddon()
      gl.onContextLoss(() => {
        gl.dispose()
        webglRef.current = null
      })
      term.loadAddon(gl)
      webglRef.current = gl
    } catch {
      webglRef.current = null // WebGL yok: DOM çizimi kullanılır
    }
  }

  const refit = (): void => {
    if (!el.current || el.current.clientWidth === 0) return
    try {
      fitRef.current?.fit()
    } catch {
      /* görünmez panel */
    }
  }

  const connect = (): void => {
    const term = termRef.current
    if (!term) return
    clearTimeout(retryTimer.current)
    announceReconnect.current = !!connRef.current.retry
    setConn((c) => ({ status: 'connecting', retry: c.retry }))
    api.ssh.open(p.paneId, p.hostId, term.cols, term.rows)
  }

  /** Bağlantı koptuysa artan aralıklarla yeniden dene. */
  const scheduleRetry = (attempt: number, error: string): void => {
    if (attempt > RETRY_DELAYS.length) {
      setConn({ status: 'closed', error: `${error} — ${RETRY_DELAYS.length} deneme başarısız oldu` })
      return
    }
    const delay = RETRY_DELAYS[attempt - 1] * 1000
    setConn({ status: 'closed', error, retry: { attempt, at: Date.now() + delay } })
    clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(connect, delay)
  }

  const cancelRetry = (): void => {
    clearTimeout(retryTimer.current)
    setConn((c) => ({ ...c, retry: undefined }))
  }

  // Geri sayımı göstermek için saniyede bir yeniden çiz.
  useEffect(() => {
    if (!conn.retry) return
    const t = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [conn.retry])

  // İnternet geri gelince beklemeden dene.
  useEffect(() => {
    const onOnline = (): void => {
      if (connRef.current.retry) connect()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let disposed = false
    const cleanups: Array<() => void> = []

    ;(async () => {
      await ensureFont(settings.fontFamily, settings.fontSize)
      if (disposed) return

      const term = new Terminal({
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        lineHeight: settings.lineHeight,
        letterSpacing: settings.letterSpacing,
        cursorStyle: settings.cursorStyle,
        cursorBlink: settings.cursorBlink,
        scrollback: settings.scrollback,
        theme: toXterm(theme),
        allowProposedApi: true,
        macOptionIsMeta: true,
        drawBoldTextInBrightColors: true
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)))
      const searchAddon = new SearchAddon()
      term.loadAddon(searchAddon)
      searchRef.current = searchAddon
      const d0 = searchAddon.onDidChangeResults((r) =>
        setResults(r.resultCount ? { index: r.resultIndex, count: r.resultCount } : { index: -1, count: 0 })
      )
      cleanups.push(() => d0.dispose())
      term.open(el.current!)
      termRef.current = term
      fitRef.current = fit
      if (settingsRef.current.gpuRendering && props.current.visible) enableWebgl(term)
      refit()

      term.attachCustomKeyEventHandler((e) => {
        // Kısayollar: macOS'ta Cmd, diğerlerinde Ctrl+Shift ile.
        const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey
        if (e.type === 'keydown' && mod) {
          if (e.code === 'KeyF') {
            e.preventDefault()
            openSearch()
            return false
          }
          let shortcut: PaneShortcut | undefined = PANE_SHORTCUTS[e.code]
          if (e.code === 'KeyD' && isMac && e.shiftKey) shortcut = 'split-down'
          if (e.code === 'KeyB') shortcut = !isMac || e.shiftKey ? 'broadcast' : undefined
          if (shortcut) {
            e.preventDefault()
            props.current.onShortcut(shortcut)
            return false
          }
        }
        if (!ac.handleKey(e)) return false
        // Windows/Linux'ta Ctrl+Shift+C / Ctrl+Shift+V ile kopyala-yapıştır.
        if (e.type !== 'keydown' || isMac || !e.ctrlKey || !e.shiftKey) return true
        if (e.code === 'KeyC') {
          const sel = term.getSelection()
          if (sel) navigator.clipboard.writeText(sel)
          return false
        }
        if (e.code === 'KeyV') {
          navigator.clipboard.readText().then((t) => term.paste(t))
          return false
        }
        return true
      })

      cleanups.push(
        subscribeSession(p.paneId, {
          data: (d) => {
            if (statusLines.current) {
              // İmleci durum satırlarının başına al ve oradan aşağısını sil: oturum temiz başlasın.
              term.write(`\x1b[${statusLines.current}A\r\x1b[J`)
              statusLines.current = 0
            }
            if (announceReconnect.current) {
              announceReconnect.current = false
              term.write('\x1b[32m● Yeniden bağlandı\x1b[0m\r\n')
            }
            term.write(d)
            ac.onOutput(d)
          },
          event: (ev) => {
            const { autoReconnect } = settingsRef.current
            if (ev.type === 'status') {
              term.write(`\x1b[2m${ev.message}\x1b[0m\r\n`)
              statusLines.current++
            }
            else if (ev.type === 'ready') {
              everConnected.current = true
              const initial = props.current.initialCommand
              if (initial && !ranInitial.current) {
                ranInitial.current = true
                api.ssh.write(p.paneId, initial.replace(/\r?\n/g, '\r') + '\r')
              }
              setConn({ status: 'ready' })
              if (props.current.focused) term.focus()
            } else if (ev.type === 'error') {
              statusLines.current = 0 // hata olduysa adımlar ekranda kalsın
              term.write(`\r\n\x1b[31m✖ ${ev.message}\x1b[0m\r\n`)
              const retrying = connRef.current.retry
              // Yeniden bağlanırken ağ hatası: sıradaki denemeye geç. Parola hatası vb.: dur.
              if (retrying && ev.retryable && autoReconnect) scheduleRetry(retrying.attempt + 1, ev.message)
              else setConn({ status: 'closed', error: ev.message })
            } else if (ev.type === 'closed') {
              term.write(`\r\n\x1b[33m● ${ev.message ?? 'Bağlantı kapandı'}\x1b[0m\r\n`)
              if (ev.reason === 'lost' && autoReconnect && everConnected.current) scheduleRetry(1, ev.message ?? 'Bağlantı koptu')
              else setConn({ status: 'closed', exited: ev.reason === 'exit' })
            }
          }
        })
      )

      cleanups.push(ac.attach(term))
      const d1 = term.onData((d) => {
        ac.onUserData(d)
        api.ssh.write(p.paneId, d)
        props.current.onInput(d)
      })
      const d2 = term.onResize(({ cols, rows }) => api.ssh.resize(p.paneId, cols, rows))
      const ro = new ResizeObserver(refit)
      ro.observe(el.current!)
      cleanups.push(
        () => ro.disconnect(),
        () => d1.dispose(),
        () => d2.dispose()
      )
      term.textarea?.addEventListener('focus', () => props.current.onFocus())

      connect()
    })()

    return () => {
      disposed = true
      clearTimeout(retryTimer.current)
      cleanups.forEach((c) => c())
      api.ssh.close(p.paneId)
      termRef.current?.dispose()
      termRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Görünüm ayarları değişince terminale uygula.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    let cancelled = false
    ensureFont(settings.fontFamily, settings.fontSize).then(() => {
      if (cancelled || !termRef.current) return
      Object.assign(term.options, {
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        lineHeight: settings.lineHeight,
        letterSpacing: settings.letterSpacing,
        cursorStyle: settings.cursorStyle,
        cursorBlink: settings.cursorBlink,
        scrollback: settings.scrollback
      })
      refit()
    })
    return () => {
      cancelled = true
    }
  }, [settings.fontSize, settings.fontFamily, settings.lineHeight, settings.letterSpacing, settings.cursorStyle, settings.cursorBlink, settings.scrollback])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = toXterm(theme)
  }, [theme])

  // WebGL bağlamı ve glif atlası panel başına onlarca MB tutar; yalnızca görünür panellerde
  // açık kalır. Gizli sekme DOM çizimine düşer (zaten çizilmez), görününce yeniden kurulur.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (settings.gpuRendering && p.visible) enableWebgl(term)
    else {
      webglRef.current?.dispose()
      webglRef.current = null
    }
  }, [settings.gpuRendering, p.visible])

  useEffect(refit, [settings.padding, p.multi])

  useEffect(() => {
    const term = termRef.current
    if (!term || !settings.copyOnSelect) return
    const d = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) navigator.clipboard.writeText(sel)
    })
    return () => d.dispose()
  }, [settings.copyOnSelect, conn.status])

  useEffect(() => {
    if (!p.visible) return
    requestAnimationFrame(() => {
      refit()
      if (p.focused) termRef.current?.focus()
    })
  }, [p.visible, p.focused]) // eslint-disable-line react-hooks/exhaustive-deps

  function openSearch(): void {
    setSearch((s) => s ?? { query: termRef.current?.getSelection() || '', caseSensitive: false })
    requestAnimationFrame(() => searchInput.current?.select())
  }

  useEffect(() => {
    p.registerHandle({ openSearch, focus: () => termRef.current?.focus(), reconnect: connect })
    return () => p.registerHandle(null)
  }) // her çizimde güncel fonksiyonları kaydet

  const SEARCH_DECOR = {
    matchBackground: '#f4c35a55',
    matchOverviewRuler: '#f4c35a',
    activeMatchBackground: '#f4c35a',
    activeMatchColorOverviewRuler: '#ff9f1a'
  }

  // incremental: yazarken mevcut eşleşmede kal; Enter'da bir sonrakine geç.
  const find = (dir: 'next' | 'prev', q = search, incremental = false): void => {
    if (!q || !q.query) {
      searchRef.current?.clearDecorations()
      setResults(null)
      return
    }
    const o = { caseSensitive: q.caseSensitive, decorations: SEARCH_DECOR, incremental }
    if (dir === 'next') searchRef.current?.findNext(q.query, o)
    else searchRef.current?.findPrevious(q.query, o)
  }

  const closeSearch = (): void => {
    setSearch(null)
    setResults(null)
    searchRef.current?.clearDecorations()
    termRef.current?.focus()
  }

  const retryIn = conn.retry ? Math.max(0, Math.ceil((conn.retry.at - Date.now()) / 1000)) : 0

  return (
    <div
      className={`pane-term ${p.focused && p.multi ? 'pane-focused' : ''} ${p.broadcast && p.multi ? 'pane-broadcast' : ''}`}
      style={{ ['--term-bg' as string]: theme.background, ['--term-fg' as string]: theme.foreground }}
      onMouseDown={() => !p.focused && p.onFocus()}
    >
      {p.multi && (
        <div className="pane-head">
          <span className={`dot dot-${conn.status}`} />
          <span className="pane-head-dot" style={{ background: colorFor(p.hostId) }} />
          <span className="pane-head-title">{host?.label ?? (p.hostId === LOCAL_HOST_ID ? 'Yerel terminal' : 'Sunucu')}</span>
          {p.broadcast && <span className="pane-badge">YAYIN</span>}
          <div className="spacer" />
          <button className="icon-btn" title="Paneli kapat" onClick={p.onClosePane}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <div ref={wrapRef} className="terminal-wrap" style={{ padding: settings.padding }}>
        <div ref={el} className="terminal" />
        {ac.overlay}
        {search && (
          <div className="term-search" onKeyDown={(e) => e.stopPropagation()}>
            <Icon name="search" size={14} />
            <input
              ref={searchInput}
              autoFocus
              placeholder="Terminalde ara…"
              value={search.query}
              onChange={(e) => {
                const q = { ...search, query: e.target.value }
                setSearch(q)
                find('next', q, true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') find(e.shiftKey ? 'prev' : 'next')
                if (e.key === 'Escape') closeSearch()
              }}
            />
            <span className="term-search-count">{results ? (results.count ? `${results.index + 1}/${results.count}` : 'Sonuç yok') : ''}</span>
            <button
              className={`icon-btn ${search.caseSensitive ? 'on' : ''}`}
              title="Büyük/küçük harf duyarlı"
              onClick={() => {
                const q = { ...search, caseSensitive: !search.caseSensitive }
                setSearch(q)
                find('next', q)
              }}
            >
              <span className="case-btn">Aa</span>
            </button>
            <button className="icon-btn" title="Önceki (Shift+Enter)" onClick={() => find('prev')}>
              <Icon name="chevronUp" size={14} />
            </button>
            <button className="icon-btn" title="Sonraki (Enter)" onClick={() => find('next')}>
              <Icon name="chevronDown" size={14} />
            </button>
            <button className="icon-btn" title="Kapat (Esc)" onClick={closeSearch}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
        {conn.status === 'closed' && (
          <div className="terminal-overlay">
            <div className="overlay-card">
              <div className={`overlay-icon ${conn.error && !conn.retry ? 'err' : ''}`}>
                <Icon name={conn.retry ? 'refresh' : conn.error ? 'alert' : 'info'} size={20} />
              </div>
              {conn.retry ? (
                <>
                  <p>{conn.error}</p>
                  <p className="muted small">
                    {retryIn > 0 ? `${retryIn} sn içinde yeniden bağlanılacak` : 'Yeniden bağlanılıyor…'} · deneme {conn.retry.attempt}/
                    {RETRY_DELAYS.length}
                  </p>
                  <div className="row">
                    <button className="btn" onClick={cancelRetry}>
                      Vazgeç
                    </button>
                    <button className="btn btn-primary" onClick={connect}>
                      <Icon name="refresh" /> Şimdi bağlan
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>{conn.error ?? (conn.exited ? 'Oturum kapandı' : 'Bağlantı kapandı')}</p>
                  <div className="row">
                    <button className="btn" onClick={p.onClosePane}>
                      {p.multi ? 'Paneli kapat' : 'Sekmeyi kapat'}
                    </button>
                    <button className="btn btn-primary" onClick={connect}>
                      <Icon name="refresh" /> Yeniden bağlan
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
