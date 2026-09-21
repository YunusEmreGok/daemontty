import { useState } from 'react'
import type { Snippet } from '@shared/types'
import { api, matches, uid } from '../api'
import { runInTab } from '../sessions'
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
        <Field label="Komut" hint="Birden çok satır yazabilirsiniz; her satır sırayla çalıştırılır.">
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
  const { tabs, focusTab } = useApp()
  const ui = useUi()
  const terminals = tabs.filter((t) => t.kind === 'terminal')
  const [selected, setSelected] = useState<Set<string>>(new Set(terminals.map((t) => t.id)))

  const run = (): void => {
    selected.forEach((id) => runInTab(id, snippet.command))
    ui.toast(`"${snippet.name}" ${selected.size} terminalde çalıştırıldı`, 'success')
    if (selected.size === 1) focusTab([...selected][0])
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
          <button className="btn btn-primary" disabled={!selected.size} onClick={run}>
            <Icon name="play" /> Çalıştır
          </button>
        </>
      }
    >
      <pre className="snippet-preview">{snippet.command}</pre>
      {terminals.length === 0 ? (
        <p className="muted">Açık terminal yok. Önce bir host'a bağlanın.</p>
      ) : (
        <div className="form">
          <h4>Hangi terminallerde çalışsın?</h4>
          {terminals.map((t) => (
            <label key={t.id} className="check">
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={(e) =>
                  setSelected((s) => {
                    const n = new Set(s)
                    if (e.target.checked) n.add(t.id)
                    else n.delete(t.id)
                    return n
                  })
                }
              />
              <Icon name="terminal" /> {t.title}
            </label>
          ))}
        </div>
      )}
    </Drawer>
  )
}
