import { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { DirListing, HistoryEntry, Settings, Snippet, TerminalTheme } from '@shared/types'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { cwdFromPrompt, didYouMean, historyCommandNames, looksSensitive, notFoundWord, pathQuery, Suggestion, suggest } from './engine'
import { InputTracker, LineState } from './tracker'

interface Options {
  termRef: RefObject<Terminal | null>
  wrapRef: RefObject<HTMLDivElement | null>
  sessionId: string
  hostId: string
  settings: Settings
  snippets: Snippet[]
  theme: TerminalTheme
}

interface View {
  items: Suggestion[]
  sel: number
  line: LineState
  ghost: string | null
  /** Piksel cinsinden konumlar (terminal kutusuna göre) */
  x: number
  y: number
  cellW: number
  cellH: number
  below: boolean
}

const KIND_ICON: Record<Suggestion['kind'], string> = {
  history: 'history',
  path: 'folder',
  command: 'terminal',
  snippet: 'code',
  fix: 'zap'
}
const DIR_TTL = 8000

export function useAutocomplete(o: Options) {
  const [view, setView] = useState<View | null>(null)
  const [fix, setFix] = useState<string | null>(null)
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const opts = useRef(o)
  opts.current = o

  const tracker = useRef<InputTracker | null>(null)
  const history = useRef<{ host: HistoryEntry[]; global: HistoryEntry[] }>({ host: [], global: [] })
  const dirs = useRef(new Map<string, { at: number; listing: DirListing | null }>())
  const pendingDirs = useRef(new Set<string>())
  const dismissed = useRef<string | null>(null)
  const lastSubmitted = useRef<string | null>(null)
  const outputTail = useRef('')
  const decoder = useRef(new TextDecoder())
  const frame = useRef(0)

  const reloadHistory = useCallback(() => {
    api.history.get(o.hostId).then((h) => (history.current = h))
  }, [o.hostId])

  useEffect(reloadHistory, [reloadHistory])

  const close = (): void => setView(null)

  /** Enter'dan beri gelen çıktıda "komut bulunamadı" varsa düzeltme öner. */
  const checkFix = (): void => {
    const cmd = lastSubmitted.current
    if (!cmd) return
    const word = notFoundWord(outputTail.current.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''))
    if (!word || cmd.split(/\s+/)[0] !== word) return
    const fixed = didYouMean(word, historyCommandNames({ hostHistory: history.current.host, globalHistory: history.current.global, snippets: [] }))
    lastSubmitted.current = null
    if (fixed) setFix(cmd.replace(word, fixed))
  }

  /** Çalıştırılan komut kesinleşince: geçmişe ekle, hata düzeltmesi için hatırla. */
  const onSubmitted = (cmd: string): void => {
    lastSubmitted.current = cmd
    checkFix()
    const { settings, hostId } = opts.current
    // Başında boşluk olan komutlar (bash'teki gibi) ve parola içerebilecekler kaydedilmez.
    if (!settings.saveHistory || cmd.startsWith(' ') || looksSensitive(cmd)) return
    api.history.add(hostId, cmd)
    const h = history.current.host
    const e = h.find((x) => x.cmd === cmd)
    if (e) {
      e.count++
      e.last = Date.now()
    } else h.push({ cmd, count: 1, last: Date.now() })
  }

  const recompute = useCallback(() => {
    const { termRef, wrapRef, settings, snippets, sessionId } = opts.current
    const term = termRef.current
    const t = tracker.current
    const submitted = t?.poll()
    if (submitted) onSubmitted(submitted)
    if (!term || !t || !settings.autocomplete) return close()
    const buf = term.buffer.active
    const line = t.read()
    if (!line || !line.atEnd || !line.input.trim() || t.lastKey !== 'type' || buf.viewportY !== buf.baseY) return close()
    if (dismissed.current === line.input) return close()

    // Dosya yolu bağlamı: klasör içeriği önbellekte yoksa getir, gelince yeniden hesapla.
    const pq = pathQuery(line.input, cwdFromPrompt(line.prompt))
    let listing: DirListing | null = null
    if (pq) {
      const cached = dirs.current.get(pq.dir)
      if (cached && Date.now() - cached.at < DIR_TTL) listing = cached.listing
      else if (!pendingDirs.current.has(pq.dir)) {
        pendingDirs.current.add(pq.dir)
        api.ssh.listDir(sessionId, pq.dir).then((l) => {
          dirs.current.set(pq.dir, { at: Date.now(), listing: l })
          pendingDirs.current.delete(pq.dir)
          schedule()
        })
      }
    }

    const items = suggest(line.input, {
      hostHistory: history.current.host,
      globalHistory: history.current.global,
      snippets,
      path: pq,
      listing
    })
    if (!items.length) return close()

    const screen = wrapRef.current?.querySelector('.xterm-screen') as HTMLElement | null
    const wrap = wrapRef.current
    if (!screen || !wrap) return close()
    const sr = screen.getBoundingClientRect()
    const wr = wrap.getBoundingClientRect()
    const cellW = sr.width / term.cols
    const cellH = sr.height / term.rows
    const top = sr.top - wr.top
    const left = sr.left - wr.left
    const below = (line.cursorRow + 1) * cellH + top + 260 < wr.height || line.cursorRow < term.rows / 2

    const prev = viewRef.current
    const sameList = prev && prev.items.length === items.length && prev.items.every((x, i) => x.text === items[i].text)
    const topItem = items[0]
    setView({
      items,
      sel: sameList ? prev.sel : 0,
      line,
      ghost: settings.ghostText && topItem.text.startsWith(line.input) ? topItem.text.slice(line.input.length) : null,
      x: left,
      y: top,
      cellW,
      cellH,
      below
    })
  }, [])

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(recompute)
  }, [recompute])

  /** Terminal oluşturulunca çağrılır. */
  const attach = useCallback(
    (term: Terminal) => {
      tracker.current = new InputTracker(term)
      const d1 = term.onWriteParsed(schedule)
      const d2 = term.onCursorMove(schedule)
      const d3 = term.onScroll(schedule)
      return () => {
        d1.dispose()
        d2.dispose()
        d3.dispose()
        cancelAnimationFrame(frame.current)
      }
    },
    [schedule]
  )

  /** Kullanıcının yazdığı her veri (terminale gönderilmeden önce). */
  const onUserData = useCallback(
    (d: string) => {
      const t = tracker.current
      if (!t) return
      setFix(null)
      t.onUserData(d)
      dismissed.current = null
      if (d === '\r') {
        close()
        lastSubmitted.current = null
        outputTail.current = ''
      }
    },
    []
  )

  /** Sunucudan gelen çıktı: "komut bulunamadı" hatasını yakalayıp düzeltme öner. */
  // Komut, xterm çıktıyı işledikten sonra (recompute içinde) kesinleşir; bu yüzden çıktıyı
  // Enter'dan itibaren biriktirip hem burada hem komut kesinleşince kontrol ediyoruz.
  const onOutput = useCallback((bytes: Uint8Array) => {
    outputTail.current = (outputTail.current + decoder.current.decode(bytes, { stream: true })).slice(-600)
    checkFix()
  }, [])

  const accept = useCallback((s: Suggestion) => {
    const v = viewRef.current
    const { sessionId, termRef } = opts.current
    if (!v) return
    const input = v.line.input
    // Öneri mevcut girdinin devamıysa sadece eksik kısmı yaz; değilse satırı silip yeniden yaz.
    const data = s.text.startsWith(input) ? s.text.slice(input.length) : '\x7f'.repeat([...input].length) + s.text
    close()
    if (data) {
      tracker.current && (tracker.current.lastKey = 'type')
      api.ssh.write(sessionId, data)
    }
    termRef.current?.focus()
  }, [])

  /** xterm'in klavye olaylarından önce çalışır; false dönerse tuş kabuğa gitmez. */
  const handleKey = useCallback(
    (e: KeyboardEvent): boolean => {
      const v = viewRef.current
      if (!v || e.type !== 'keydown' || e.metaKey || e.ctrlKey || e.altKey) return true
      // Tüketilen tuşlarda tarayıcının varsayılan davranışını (ör. Tab ile odak değiştirme) engelle.
      const consume = (): false => {
        e.preventDefault()
        e.stopPropagation()
        return false
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const n = v.items.length
        setView({ ...v, sel: (v.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })
        return consume()
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        accept(v.items[v.sel])
        return consume()
      }
      if (e.key === 'ArrowRight' && v.ghost) {
        accept(v.items[0])
        return consume()
      }
      if (e.key === 'Escape') {
        dismissed.current = v.line.input
        close()
        return consume()
      }
      if (e.key === 'Enter') close()
      return true
    },
    [accept]
  )

  const runFix = (): void => {
    if (!fix) return
    api.ssh.write(opts.current.sessionId, fix + '\r')
    tracker.current?.reset()
    outputTail.current = ''
    setFix(null)
    onSubmitted(fix)
    opts.current.termRef.current?.focus()
  }

  const { settings, theme } = o
  const overlay = (
    <>
      {view?.ghost && (
        <span
          className="ac-ghost"
          style={{
            left: view.x + view.line.cursorCol * view.cellW,
            top: view.y + view.line.cursorRow * view.cellH,
            height: view.cellH,
            lineHeight: `${view.cellH}px`,
            fontFamily: settings.fontFamily,
            fontSize: settings.fontSize,
            letterSpacing: settings.letterSpacing,
            color: theme.foreground,
            maxWidth: (opts.current.termRef.current!.cols - view.line.cursorCol) * view.cellW
          }}
        >
          {view.ghost}
        </span>
      )}
      {view && (
        <div
          className="ac-popup"
          style={{
            left: Math.max(4, view.x + view.line.anchorCol * view.cellW - 30),
            ...(view.below
              ? { top: view.y + (view.line.cursorRow + 1) * view.cellH + 4 }
              : { bottom: `calc(100% - ${view.y + view.line.cursorRow * view.cellH - 4}px)` })
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {view.items.map((s, i) => (
            <div
              key={s.text}
              className={`ac-item ac-${s.kind} ${i === view.sel ? 'sel' : ''}`}
              onMouseEnter={() => setView({ ...view, sel: i })}
              onClick={() => accept(s)}
            >
              <Icon name={s.kind === 'path' && !s.label.endsWith('/') ? 'file' : KIND_ICON[s.kind]} size={13} />
              <span className="ac-label">{s.label}</span>
              {s.desc && <span className="ac-desc">{s.desc}</span>}
            </div>
          ))}
          <div className="ac-hint">
            <kbd>↑↓</kbd> seç <kbd>Tab</kbd> kabul {view.ghost && (<><kbd>→</kbd> tamamla </>)}<kbd>Esc</kbd> kapat
          </div>
        </div>
      )}
      {fix && (
        <div className="ac-fix">
          <Icon name="zap" size={14} />
          <span>Bunu mu demek istediniz?</span>
          <code>{fix}</code>
          <button className="btn btn-sm btn-primary" onClick={runFix}>
            Çalıştır
          </button>
          <button className="icon-btn" title="Kapat" onClick={() => setFix(null)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </>
  )

  return { attach, onUserData, onOutput, handleKey, overlay, reloadHistory }
}
