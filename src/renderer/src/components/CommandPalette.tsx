import { useEffect, useMemo, useRef, useState } from 'react'
import type { Host } from '@shared/types'
import { LOCAL_HOST_ID } from '@shared/types'
import { api, colorFor, errMsg, uid } from '../api'
import type { Tab } from '../App'
import { useApp } from '../App'
import { allThemes } from '../themes'
import { fillSnippet, runInTab } from '../sessions'
import { Icon } from './Icon'
import { useUi } from './Ui'

export type View = 'hosts' | 'keychain' | 'forwards' | 'snippets' | 'settings'

interface Item {
  id: string
  title: string
  subtitle?: string
  group: string
  icon: string
  color?: string
  run(): void | Promise<void>
}

/** Harflerin sırayla geçmesine dayalı basit bulanık eşleştirme; eşleşmezse -1. */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLocaleLowerCase('tr')
  const t = text.toLocaleLowerCase('tr')
  if (!q) return 0
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx + (idx === 0 || t[idx - 1] === ' ' ? 200 : 0)
  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    streak = found === ti ? streak + 1 : 0
    score += 10 + streak * 5 - Math.min(found - ti, 10)
    if (found === 0 || t[found - 1] === ' ' || t[found - 1] === '@' || t[found - 1] === '.') score += 15
    ti = found + 1
  }
  return score
}

const QUICK_RE = /^(?:([^@\s]+)@)?([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/

interface Props {
  onClose(): void
  setView(v: View): void
  activeTab: Tab | undefined
}

export function CommandPalette({ onClose, setView, activeTab }: Props) {
  const { data, tabs, openTab, focusTab, updateSettings } = useApp()
  const ui = useUi()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const list: Item[] = []
    const addr = (h: Host): string => `${h.username ? h.username + '@' : ''}${h.address}${h.port !== 22 ? ':' + h.port : ''}`
    for (const h of data.hosts) {
      list.push({ id: 'ssh-' + h.id, title: h.label, subtitle: addr(h), group: 'Bağlan', icon: 'terminal', color: colorFor(h.id), run: () => openTab('terminal', h.id) })
    }
    for (const t of tabs) {
      list.push({ id: 'tab-' + t.id, title: t.kind === 'sftp' ? `SFTP · ${t.title}` : t.title, subtitle: 'açık sekme', group: 'Sekmeler', icon: t.kind === 'sftp' ? 'folder' : 'terminal', color: colorFor(t.hostId), run: () => focusTab(t.id) })
    }
    for (const h of data.hosts) {
      list.push({ id: 'sftp-' + h.id, title: `SFTP: ${h.label}`, subtitle: addr(h), group: 'Dosyalar', icon: 'folder', run: () => openTab('sftp', h.id) })
    }
    list.push({ id: 'local', title: 'Yerel terminal', subtitle: 'bu bilgisayarda kabuk aç', group: 'Bağlan', icon: 'terminal', run: () => openTab('terminal', LOCAL_HOST_ID, 'Yerel terminal') })
    if (activeTab?.kind === 'terminal') {
      for (const s of data.snippets) {
        list.push({
          id: 'snip-' + s.id,
          title: s.name,
          subtitle: s.command.split('\n')[0],
          group: `Snippet çalıştır → ${activeTab.title}`,
          icon: 'code',
          run: async () => {
            const cmd = await fillSnippet(ui, s)
            if (cmd === null) return
            runInTab(activeTab.id, cmd)
            focusTab(activeTab.id)
          }
        })
      }
    }
    for (const f of data.forwards) {
      list.push({
        id: 'fw-' + f.id,
        title: `Tüneli başlat: ${f.name || f.bindPort}`,
        subtitle: `${f.bindAddress}:${f.bindPort}`,
        group: 'Port yönlendirme',
        icon: 'forward',
        run: async () => {
          try {
            await api.forwards.start(f.id)
            ui.toast(`"${f.name}" başlatıldı`, 'success')
          } catch (e) {
            ui.toast(errMsg(e), 'error')
          }
        }
      })
    }
    const views: Array<[View, string, string]> = [
      ['hosts', 'Hostlar', 'server'],
      ['keychain', 'Keychain', 'key'],
      ['forwards', 'Port Yönlendirme', 'forward'],
      ['snippets', 'Snippetler', 'code'],
      ['settings', 'Ayarlar', 'settings']
    ]
    for (const [v, title, icon] of views) {
      list.push({ id: 'view-' + v, title, subtitle: 'sayfaya git', group: 'Git', icon, run: () => setView(v) })
    }
    for (const th of allThemes(data.settings)) {
      list.push({ id: 'theme-' + th.id, title: `Tema: ${th.name}`, group: 'Görünüm', icon: 'palette', color: th.background, run: () => updateSettings({ themeId: th.id }) })
    }
    return list
  }, [data, tabs, activeTab, openTab, focusTab, setView, updateSettings, ui])

  const quick = useMemo<Item | null>(() => {
    const m = query.trim().match(QUICK_RE)
    if (!m || !(m[1] || /[.:]/.test(m[2]))) return null
    const [, user, address, portStr] = m
    const port = Number(portStr) || 22
    if (port > 65535) return null
    return {
      id: 'quick',
      title: `Hızlı bağlan: ${query.trim()}`,
      subtitle: 'Host kasaya kaydedilir ve bağlanılır',
      group: 'Hızlı bağlantı',
      icon: 'zap',
      run: async () => {
        const existing = data.hosts.find((h) => h.address === address && h.port === port && (h.username || '') === (user || ''))
        if (existing) return openTab('terminal', existing.id)
        const host: Host = { id: uid(), label: address, address, port, username: user, tags: ['hızlı'] }
        await api.vault.upsert('hosts', host)
        openTab('terminal', host.id, host.label)
      }
    }
  }, [query, data.hosts, openTab])

  const results = useMemo(() => {
    const scored = items
      .map((it) => ({ it, s: fuzzyScore(query, `${it.title} ${it.subtitle ?? ''}`) }))
      .filter((x) => x.s >= 0)
    if (query) scored.sort((a, b) => b.s - a.s)
    const out = scored.slice(0, 40).map((x) => x.it)
    return quick ? [quick, ...out] : out
  }, [items, query, quick])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.pal-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = async (it: Item | undefined): Promise<void> => {
    if (!it) return
    onClose()
    await it.run()
  }

  let lastGroup = ''
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" onKeyDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Host'a bağlan, komut çalıştır… ya da kullanici@sunucu yazın"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(results[sel])
              } else if (e.key === 'Escape') onClose()
            }}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list" ref={listRef}>
          {results.length === 0 && <div className="pal-empty">Sonuç bulunamadı</div>}
          {results.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <div key={it.id}>
                {header && <div className="pal-group">{header}</div>}
                <div className={`pal-item ${i === sel ? 'sel' : ''}`} onMouseMove={() => i !== sel && setSel(i)} onClick={() => run(it)}>
                  <span className="pal-icon" style={it.color ? { color: it.color } : undefined}>
                    <Icon name={it.icon} size={15} />
                  </span>
                  <span className="pal-title">{it.title}</span>
                  {it.subtitle && <span className="pal-sub">{it.subtitle}</span>}
                  {i === sel && <kbd className="pal-enter">↵</kbd>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑↓</kbd> gezin
          </span>
          <span>
            <kbd>↵</kbd> çalıştır
          </span>
          <span>
            <kbd>Esc</kbd> kapat
          </span>
        </div>
      </div>
    </div>
  )
}
