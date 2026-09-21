import { useState } from 'react'
import type { Snippet } from '@shared/types'
import { api, matches, uid } from '../api'
import { fillSnippet, runInTab } from '../sessions'
import { useApp } from '../App'
import { Icon } from '../components/Icon'
import { Drawer, Empty, Field, useUi } from '../components/Ui'

export function SnippetsView() {
  const { data } = useApp()
  const ui = useUi()
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [running, setRunning] = useState<Snippet | null>(null)
  const [query, setQuery] = useState('')

  const list = data.snippets.filter((s) => !query || matches(s.name, query) || matches(s.command, query))

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <h1>Snippetler</h1>
          <p>{`${data.snippets.length} kayıtlı komut`}</p>
        </div>
        <div className="search">
          <Icon name="search" />
          <input placeholder="Snippet ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ id: '', name: '', command: '' })}>
          <Icon name="plus" /> Yeni snippet
        </button>
      </header>
      <div className="view-body">
        {data.snippets.length === 0 ? (
          <Empty
            icon="code"
            title="Snippet yok"
            text="Sık kullandığınız komutları kaydedin, tek tıkla bir ya da birden çok terminalde çalıştırın."
            action={
              <button className="btn btn-primary" onClick={() => setEditing({ id: '', name: '', command: '' })}>
                <Icon name="plus" /> Yeni snippet
              </button>
            }
          />
        ) : (
          <div className="snippet-grid">
            {list.map((s) => (
              <div key={s.id} className="snippet-card">
                <div className="snippet-head">
                  <strong>{s.name}</strong>
                  <div className="list-actions">
                    <button className="icon-btn" title="Düzenle" onClick={() => setEditing(s)}>
                      <Icon name="edit" />
                    </button>
                    <button
                      className="icon-btn"
                      title="Sil"
                      onClick={async () => {
                        if (await ui.confirm(`"${s.name}" silinsin mi?`, undefined, { confirmLabel: 'Sil', danger: true }))
                          await api.vault.remove('snippets', s.id)
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
                <pre>{s.command}</pre>
                <button className="btn btn-sm btn-primary" onClick={() => setRunning(s)}>
                  <Icon name="play" /> Çalıştır
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <SnippetForm initial={editing} onClose={() => setEditing(null)} />}
      {running && <RunSnippet snippet={running} onClose={() => setRunning(null)} />}
    </div>
  )
}

function SnippetForm({ initial, onClose }: { initial: Snippet; onClose(): void }) {
  const ui = useUi()
  const [s, setS] = useState(initial)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!s.command.trim()) return ui.toast('Komut boş olamaz', 'error')
    await api.vault.upsert('snippets', { ...s, id: s.id || uid(), name: s.name.trim() || s.command.split('\n')[0].slice(0, 40) })
    onClose()
  }

  return (
    <Drawer
      title={initial.id ? 'Snippet düzenle' : 'Yeni snippet'}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button className="btn btn-primary" type="submit" form="snippet-form">
            Kaydet
          </button>
        </>
      }
    >
      <form id="snippet-form" className="form" onSubmit={submit}>
        <Field label="Ad">
          <input autoFocus value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Disk kullanımı" />
        </Field>
        <Field label="Komut" hint="Birden çok satır yazabilirsiniz; her satır sırayla çalıştırılır. {{ad}} yazarsanız çalıştırırken sorulur; {{ad:varsayılan}} ile hazır değer verebilirsiniz.">
          <textarea
            className="mono"
            rows={8}
            value={s.command}
            onChange={(e) => setS({ ...s, command: e.target.value })}
            placeholder="df -h"
            spellCheck={false}
          />
        </Field>
      </form>
    </Drawer>
  )
}

function RunSnippet({ snippet, onClose }: { snippet: Snippet; onClose(): void }) {
  const { data, tabs, focusTab, openTab } = useApp()
  const ui = useUi()
  const terminals = tabs.filter((t) => t.kind === 'terminal')
  const [selected, setSelected] = useState<Set<string>>(new Set(terminals.map((t) => t.id)))
  // Henüz bağlı olmayan sunucular: seçilenler için sekme açılır, bağlanınca komut çalışır.
  const [hosts, setHosts] = useState<Set<string>>(new Set())

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, ids: string[], on: boolean): void =>
    set((s) => {
      const n = new Set(s)
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)))
      return n
    })

  const closed = data.hosts.filter((h) => !terminals.some((t) => t.hostId === h.id))
  const groups = [
    ...data.groups.map((g) => ({ name: g.name, hosts: closed.filter((h) => h.groupId === g.id) })),
    { name: 'Grupsuz', hosts: closed.filter((h) => !h.groupId || !data.groups.some((g) => g.id === h.groupId)) }
  ].filter((g) => g.hosts.length)

  const run = async (): Promise<void> => {
    const cmd = await fillSnippet(ui, snippet)
    if (cmd === null) return
    selected.forEach((id) => runInTab(id, cmd))
    hosts.forEach((id) => openTab('terminal', id, undefined, { command: cmd, background: true }))
    const total = selected.size + hosts.size
    ui.toast(`"${snippet.name}" ${total} sunucuda çalıştırıldı${hosts.size ? ` (${hosts.size} yeni bağlantı)` : ''}`, 'success')
    if (total === 1 && selected.size === 1) focusTab([...selected][0])
    onClose()
  }

  return (
    <Drawer
      title={`Çalıştır: ${snippet.name}`}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button className="btn btn-primary" disabled={!selected.size && !hosts.size} onClick={run}>
            <Icon name="play" /> Çalıştır{selected.size + hosts.size > 1 ? ` (${selected.size + hosts.size})` : ''}
          </button>
        </>
      }
    >
      <pre className="snippet-preview">{snippet.command}</pre>
      <div className="form">
        {terminals.length > 0 && <h4>Açık terminaller</h4>}
        {terminals.map((t) => (
          <label key={t.id} className="check">
            <input type="checkbox" checked={selected.has(t.id)} onChange={(e) => toggle(setSelected, [t.id], e.target.checked)} />
            <Icon name="terminal" /> {t.title}
          </label>
        ))}
        {groups.length > 0 && <h4>Bağlı olmayan sunucular</h4>}
        {groups.length > 0 && <p className="muted small">Seçtikleriniz için sekme açılır; bağlantı kurulunca komut çalışır.</p>}
        {groups.map((g) => {
          const ids = g.hosts.map((h) => h.id)
          const all = ids.every((id) => hosts.has(id))
          return (
            <div key={g.name} className="run-group">
              <label className="check run-group-head">
                <input type="checkbox" checked={all} onChange={(e) => toggle(setHosts, ids, e.target.checked)} />
                <Icon name="folder" /> <strong>{g.name}</strong> <span className="muted small">{ids.length} sunucu</span>
              </label>
              {g.hosts.map((h) => (
                <label key={h.id} className="check run-group-host">
                  <input type="checkbox" checked={hosts.has(h.id)} onChange={(e) => toggle(setHosts, [h.id], e.target.checked)} />
                  <Icon name="server" /> {h.label}
                </label>
              ))}
            </div>
          )
        })}
        {terminals.length === 0 && groups.length === 0 && <p className="muted">Henüz host yok.</p>}
      </div>
    </Drawer>
  )
}
