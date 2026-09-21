import { useEffect, useState } from 'react'
import type { ForwardStatus, ForwardType, PortForward } from '@shared/types'
import { api, errMsg, uid } from '../api'
import { useApp } from '../App'
import { Icon } from '../components/Icon'
import { Drawer, Empty, Field, useUi } from '../components/Ui'

const TYPES: Record<ForwardType, { label: string; desc: string }> = {
  local: {
    label: 'Yerel (Local)',
    desc: 'Bu bilgisayardaki bir portu, sunucu üzerinden ulaşılan bir hedefe bağlar. Örn: uzaktaki veritabanına localhost:5432 ile erişmek.'
  },
  remote: {
    label: 'Uzak (Remote)',
    desc: 'Sunucudaki bir portu, bu bilgisayardan ulaşılan bir hedefe bağlar. Örn: yereldeki geliştirme sunucusunu uzaktan erişime açmak.'
  },
  dynamic: {
    label: 'Dinamik (SOCKS)',
    desc: 'Bu bilgisayarda bir SOCKS5 vekil sunucusu açar; tarayıcı trafiğini sunucu üzerinden geçirir.'
  }
}

function describe(f: PortForward): string {
  const bind = `${f.bindAddress || '127.0.0.1'}:${f.bindPort}`
  if (f.type === 'local') return `${bind} → ${f.destHost}:${f.destPort}`
  if (f.type === 'remote') return `sunucu ${bind} → ${f.destHost || '127.0.0.1'}:${f.destPort}`
  return `SOCKS5 ${bind}`
}

export function ForwardsView() {
  const { data } = useApp()
  const ui = useUi()
  const [statuses, setStatuses] = useState<Record<string, ForwardStatus>>({})
  const [editing, setEditing] = useState<PortForward | null>(null)

  useEffect(() => {
    api.forwards.statuses().then((list) => setStatuses(Object.fromEntries(list.map((s) => [s.id, s]))))
    return api.forwards.onStatus((s) => setStatuses((m) => ({ ...m, [s.id]: s })))
  }, [])

  const toggle = async (f: PortForward): Promise<void> => {
    const st = statuses[f.id]?.state
    try {
      if (st === 'running' || st === 'starting') await api.forwards.stop(f.id)
      else await api.forwards.start(f.id)
    } catch (e) {
      ui.toast(`${f.name}: ${errMsg(e)}`, 'error')
    }
  }

  const newRule = (): void => {
    if (!data.hosts.length) return ui.toast('Önce bir host ekleyin', 'error')
    setEditing({ id: '', name: '', type: 'local', hostId: data.hosts[0].id, bindAddress: '127.0.0.1', bindPort: 8080, destHost: '127.0.0.1', destPort: 80 })
  }

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <h1>Port Yönlendirme</h1>
          <p>{`${data.forwards.length} kural`}</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={newRule}>
          <Icon name="plus" /> Yeni kural
        </button>
      </header>
      <div className="view-body">
        {data.forwards.length === 0 ? (
          <Empty
            icon="forward"
            title="Yönlendirme kuralı yok"
            text="SSH tüneli ile uzak servislere güvenli şekilde erişmek için bir kural ekleyin."
            action={
              <button className="btn btn-primary" onClick={newRule}>
                <Icon name="plus" /> Yeni kural
              </button>
            }
          />
        ) : (
          <div className="list">
            {data.forwards.map((f) => {
              const st = statuses[f.id]
              const state = st?.state ?? 'stopped'
              const host = data.hosts.find((h) => h.id === f.hostId)
              const on = state === 'running' || state === 'starting'
              return (
                <div key={f.id} className="list-row">
                  <span className={`dot dot-fw-${state}`} />
                  <div className="list-main">
                    <strong>{f.name || describe(f)}</strong>
                    <span className="muted small">
                      {TYPES[f.type].label} · {host?.label ?? '?'} · {describe(f)}
                      {f.autoStart && ' · açılışta başlar'}
                    </span>
                    {st?.message && state !== 'running' && (
                      <span className={`small ${state === 'error' ? 'text-danger' : 'muted'}`}>{st.message}</span>
                    )}
                  </div>
                  <div className="list-actions">
                    <button className={`btn btn-sm ${on ? '' : 'btn-primary'}`} onClick={() => toggle(f)}>
                      <Icon name={on ? 'stop' : 'play'} /> {on ? 'Durdur' : 'Başlat'}
                    </button>
                    <button className="icon-btn" title="Düzenle" disabled={on} onClick={() => setEditing(f)}>
                      <Icon name="edit" />
                    </button>
                    <button
                      className="icon-btn"
                      title="Sil"
                      onClick={async () => {
                        if (await ui.confirm('Kural silinsin mi?', undefined, { confirmLabel: 'Sil', danger: true })) {
                          await api.forwards.stop(f.id)
                          await api.vault.remove('forwards', f.id)
                        }
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {editing && <ForwardForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ForwardForm({ initial, onClose }: { initial: PortForward; onClose(): void }) {
  const { data } = useApp()
  const ui = useUi()
  const [f, setF] = useState<PortForward>(initial)
  const set = <K extends keyof PortForward>(k: K, v: PortForward[K]): void => setF((x) => ({ ...x, [k]: v }))
  const validPort = (p?: number): boolean => !!p && p >= 1 && p <= 65535

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!validPort(f.bindPort)) return ui.toast('Dinleme portu geçersiz', 'error')
    if (f.type !== 'dynamic' && (!f.destHost?.trim() || !validPort(f.destPort)))
      return ui.toast('Hedef adres ve port zorunlu', 'error')
    await api.vault.upsert('forwards', {
      ...f,
      id: f.id || uid(),
      name: f.name.trim(),
      bindAddress: f.bindAddress.trim() || '127.0.0.1',
      destHost: f.type === 'dynamic' ? undefined : f.destHost?.trim(),
      destPort: f.type === 'dynamic' ? undefined : f.destPort
    })
    onClose()
  }

  return (
    <Drawer
      title={initial.id ? 'Kuralı düzenle' : 'Yeni yönlendirme kuralı'}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button className="btn btn-primary" type="submit" form="fw-form">
            Kaydet
          </button>
        </>
      }
    >
      <form id="fw-form" className="form" onSubmit={submit}>
        <Field label="Ad">
          <input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Veritabanı tüneli" />
        </Field>
        <div className="segmented">
          {(Object.keys(TYPES) as ForwardType[]).map((t) => (
            <button type="button" key={t} className={f.type === t ? 'active' : ''} onClick={() => set('type', t)}>
              {TYPES[t].label}
            </button>
          ))}
        </div>
        <p className="muted small">{TYPES[f.type].desc}</p>
        <Field label="SSH host">
          <select value={f.hostId} onChange={(e) => set('hostId', e.target.value)}>
            {data.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        <h4>{f.type === 'remote' ? 'Sunucuda dinlenecek adres' : 'Bu bilgisayarda dinlenecek adres'}</h4>
        <div className="form-row">
          <Field label="Adres">
            <input value={f.bindAddress} onChange={(e) => set('bindAddress', e.target.value)} spellCheck={false} />
          </Field>
          <Field label="Port">
            <input className="w-port" type="number" value={f.bindPort} onChange={(e) => set('bindPort', Number(e.target.value))} />
          </Field>
        </div>
        {f.type !== 'dynamic' && (
          <>
            <h4>{f.type === 'remote' ? 'Bu bilgisayardan ulaşılacak hedef' : 'Sunucudan ulaşılacak hedef'}</h4>
            <div className="form-row">
              <Field label="Hedef adres">
                <input value={f.destHost ?? ''} onChange={(e) => set('destHost', e.target.value)} spellCheck={false} />
              </Field>
              <Field label="Hedef port">
                <input className="w-port" type="number" value={f.destPort ?? ''} onChange={(e) => set('destPort', Number(e.target.value))} />
              </Field>
            </div>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={!!f.autoStart} onChange={(e) => set('autoStart', e.target.checked || undefined)} />
          <span>
            Açılışta başlat
            <small className="muted block">Daemontty açılınca bu tünel kendiliğinden kurulur</small>
          </span>
        </label>
      </form>
    </Drawer>
  )
}
