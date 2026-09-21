import { useEffect, useState } from 'react'
import type { Identity, KeyType, KnownHost, SshKey } from '@shared/types'
import { api, errMsg, formatDate, uid } from '../api'
import { useApp } from '../App'
import { Icon } from '../components/Icon'
import { Drawer, Empty, Field, useUi } from '../components/Ui'

type Panel = { kind: 'generate' } | { kind: 'import' } | { kind: 'identity'; identity: Identity } | null

export function KeychainView() {
  const { data } = useApp()
  const ui = useUi()
  const [panel, setPanel] = useState<Panel>(null)

  const copyPublic = async (k: SshKey): Promise<void> => {
    await navigator.clipboard.writeText(k.publicKey)
    ui.toast('Açık anahtar panoya kopyalandı', 'success')
  }

  const renameKey = async (k: SshKey): Promise<void> => {
    const name = await ui.ask('Anahtarı yeniden adlandır', 'Anahtar adı', k.name)
    if (name) await api.keys.rename(k.id, name)
  }

  const deleteKey = async (k: SshKey): Promise<void> => {
    const users = data.hosts.filter((h) => h.keyId === k.id).length + data.identities.filter((i) => i.keyId === k.id).length
    const ok = await ui.confirm(
      `"${k.name}" anahtarı silinsin mi?`,
      users ? `Bu anahtar ${users} host/kimlik tarafından kullanılıyor; onların anahtar ayarı kaldırılacak.` : 'Bu işlem geri alınamaz.',
      { confirmLabel: 'Sil', danger: true }
    )
    if (ok) await api.keys.remove(k.id)
  }

  const exportKey = async (k: SshKey): Promise<void> => {
    try {
      if (await api.keys.exportPrivate(k.id)) ui.toast('Anahtar dosyaya kaydedildi', 'success')
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  const deleteIdentity = async (i: Identity): Promise<void> => {
    if (await ui.confirm(`"${i.name}" kimliği silinsin mi?`, undefined, { confirmLabel: 'Sil', danger: true }))
      await api.vault.remove('identities', i.id)
  }

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <h1>Keychain</h1>
          <p>{`${data.keys.length} anahtar · ${data.identities.length} kimlik`}</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => setPanel({ kind: 'import' })}>
          <Icon name="import" /> Anahtar içe aktar
        </button>
        <button className="btn" onClick={() => setPanel({ kind: 'generate' })}>
          <Icon name="key" /> Anahtar oluştur
        </button>
        <button className="btn btn-primary" onClick={() => setPanel({ kind: 'identity', identity: { id: '', name: '', username: '' } })}>
          <Icon name="plus" /> Yeni kimlik
        </button>
      </header>

      <div className="view-body">
        <section className="host-section">
          <div className="section-head">
            <h2>SSH anahtarları</h2>
            <span className="count">{data.keys.length}</span>
          </div>
          {data.keys.length === 0 ? (
            <Empty
              icon="key"
              title="Anahtar yok"
              text="Yeni bir ed25519 anahtarı oluşturun ya da mevcut özel anahtarınızı içe aktarın."
            />
          ) : (
            <div className="list">
              {data.keys.map((k) => (
                <div key={k.id} className="list-row">
                  <div className="list-icon">
                    <Icon name="key" />
                  </div>
                  <div className="list-main">
                    <strong>
                      {k.name} {k.hasPassphrase && <Icon name="lock" size={12} className="muted" />}
                    </strong>
                    <span className="muted mono small">
                      {k.type} · {k.fingerprint}
                    </span>
                  </div>
                  <span className="muted small">{formatDate(k.createdAt)}</span>
                  <div className="list-actions">
                    <button className="btn btn-sm" onClick={() => copyPublic(k)} title="Sunucudaki ~/.ssh/authorized_keys dosyasına ekleyin">
                      <Icon name="copy" /> Açık anahtarı kopyala
                    </button>
                    <button className="icon-btn" title="Dışa aktar" onClick={() => exportKey(k)}>
                      <Icon name="download" />
                    </button>
                    <button className="icon-btn" title="Yeniden adlandır" onClick={() => renameKey(k)}>
                      <Icon name="edit" />
                    </button>
                    <button className="icon-btn" title="Sil" onClick={() => deleteKey(k)}>
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="host-section">
          <div className="section-head">
            <h2>Kimlikler</h2>
            <span className="count">{data.identities.length}</span>
          </div>
          <p className="muted small section-desc">
            Kimlik; kullanıcı adı, parola ve/veya anahtarı bir arada tutar. Birden çok host aynı kimliği kullanabilir.
          </p>
          {data.identities.length > 0 && (
            <div className="list">
              {data.identities.map((i) => {
                const key = data.keys.find((k) => k.id === i.keyId)
                const used = data.hosts.filter((h) => h.identityId === i.id).length
                return (
                  <div key={i.id} className="list-row" onDoubleClick={() => setPanel({ kind: 'identity', identity: i })}>
                    <div className="list-icon">
                      <Icon name="user" />
                    </div>
                    <div className="list-main">
                      <strong>{i.name}</strong>
                      <span className="muted small">
                        {i.username}
                        {i.password ? ' · parola' : ''}
                        {key ? ` · ${key.name}` : ''}
                      </span>
                    </div>
                    <span className="muted small">{used} host</span>
                    <div className="list-actions">
                      <button className="icon-btn" title="Düzenle" onClick={() => setPanel({ kind: 'identity', identity: i })}>
                        <Icon name="edit" />
                      </button>
                      <button className="icon-btn" title="Sil" onClick={() => deleteIdentity(i)}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <KnownHosts />
      </div>

      {panel?.kind === 'generate' && <GenerateKey onClose={() => setPanel(null)} />}
      {panel?.kind === 'import' && <ImportKey onClose={() => setPanel(null)} />}
      {panel?.kind === 'identity' && <IdentityForm initial={panel.identity} onClose={() => setPanel(null)} />}
    </div>
  )
}

const BITS: Record<KeyType, number[]> = { ed25519: [], rsa: [4096, 3072, 2048], ecdsa: [256, 384, 521] }

function GenerateKey({ onClose }: { onClose(): void }) {
  const ui = useUi()
  const [name, setName] = useState('')
  const [type, setType] = useState<KeyType>('ed25519')
  const [bits, setBits] = useState<number | undefined>(undefined)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim()) return ui.toast('Anahtar adı zorunlu', 'error')
    if (pass !== pass2) return ui.toast('Parolalar eşleşmiyor', 'error')
    setBusy(true)
    try {
      await api.keys.generate(name.trim(), type, bits ?? BITS[type][0], pass)
      ui.toast('Anahtar oluşturuldu', 'success')
      onClose()
    } catch (err) {
      ui.toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      title="Anahtar oluştur"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button className="btn btn-primary" type="submit" form="gen-form" disabled={busy}>
            {busy ? 'Oluşturuluyor…' : 'Oluştur'}
          </button>
        </>
      }
    >
      <form id="gen-form" className="form" onSubmit={submit}>
        <Field label="Ad">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop-anahtari" />
        </Field>
        <Field label="Tür" hint="ed25519 modern, hızlı ve önerilen seçenektir">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as KeyType)
              setBits(undefined)
            }}
          >
            <option value="ed25519">Ed25519 (önerilen)</option>
            <option value="rsa">RSA</option>
            <option value="ecdsa">ECDSA</option>
          </select>
        </Field>
        {BITS[type].length > 0 && (
          <Field label="Uzunluk (bit)">
            <select value={bits ?? BITS[type][0]} onChange={(e) => setBits(Number(e.target.value))}>
              {BITS[type].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Parola (isteğe bağlı)" hint="Anahtar dışa aktarıldığında bu parola ile korunur">
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </Field>
        {pass && (
          <Field label="Parola (tekrar)">
            <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
          </Field>
        )}
      </form>
    </Drawer>
  )
}

function ImportKey({ onClose }: { onClose(): void }) {
  const ui = useUi()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [pass, setPass] = useState('')

  const pick = async (): Promise<void> => {
    try {
      const f = await api.keys.pickFile()
      if (!f) return
      setText(f.content)
      if (!name) setName(f.name)
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim() || !text.trim()) return ui.toast('Ad ve özel anahtar zorunlu', 'error')
    try {
      await api.keys.importText(name.trim(), text, pass)
      ui.toast('Anahtar içe aktarıldı', 'success')
      onClose()
    } catch (err) {
      ui.toast(errMsg(err), 'error')
    }
  }

  return (
    <Drawer
      title="Anahtar içe aktar"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button className="btn btn-primary" type="submit" form="import-form">
            İçe aktar
          </button>
        </>
      }
    >
      <form id="import-form" className="form" onSubmit={submit}>
        <Field label="Ad">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="id_ed25519" />
        </Field>
        <Field label="Özel anahtar" hint="-----BEGIN … PRIVATE KEY----- ile başlayan metni yapıştırın">
          <textarea className="mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </Field>
        <button type="button" className="btn" onClick={pick}>
          <Icon name="file" /> Dosyadan seç…
        </button>
        <Field label="Anahtar parolası (varsa)">
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
        </Field>
      </form>
    </Drawer>
  )
}

function IdentityForm({ initial, onClose }: { initial: Identity; onClose(): void }) {
  const { data } = useApp()
  const ui = useUi()
  const [i, setI] = useState<Identity>(initial)
  const set = <K extends keyof Identity>(k: K, v: Identity[K]): void => setI((x) => ({ ...x, [k]: v }))

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!i.username.trim()) return ui.toast('Kullanıcı adı zorunlu', 'error')
    await api.vault.upsert('identities', {
      ...i,
      id: i.id || uid(),
      name: i.name.trim() || i.username.trim(),
      username: i.username.trim(),
      password: i.password || undefined,
      keyId: i.keyId || undefined
    })
    ui.toast('Kimlik kaydedildi', 'success')
    onClose()
  }

  return (
    <Drawer
      title={initial.id ? 'Kimlik düzenle' : 'Yeni kimlik'}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button className="btn btn-primary" type="submit" form="identity-form">
            Kaydet
          </button>
        </>
      }
    >
      <form id="identity-form" className="form" onSubmit={submit}>
        <Field label="Ad">
          <input autoFocus value={i.name} onChange={(e) => set('name', e.target.value)} placeholder="Üretim sunucuları" />
        </Field>
        <Field label="Kullanıcı adı">
          <input value={i.username} onChange={(e) => set('username', e.target.value)} placeholder="deploy" spellCheck={false} />
        </Field>
        <Field label="Parola" hint="Boş bırakılabilir">
          <input type="password" value={i.password ?? ''} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="SSH anahtarı">
          <select value={i.keyId ?? ''} onChange={(e) => set('keyId', e.target.value || undefined)}>
            <option value="">— Anahtar yok —</option>
            {data.keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.type})
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Drawer>
  )
}

/** Sunucu parmak izleri: sunucu yeniden kurulduğunda eski kaydı silmek için. */
function KnownHosts() {
  const { data } = useApp()
  const ui = useUi()
  const [list, setList] = useState<KnownHost[] | null>(null)
  const load = (): void => {
    api.knownHosts.list().then(setList)
  }
  useEffect(load, [])

  const remove = async (k: KnownHost): Promise<void> => {
    const ok = await ui.confirm(
      `${k.hostPort} kaydı silinsin mi?`,
      'Bir sonraki bağlantıda sunucu anahtarını yeniden onaylamanız istenir. Sunucu yeniden kurulduysa bunu yapmanız gerekir.',
      { confirmLabel: 'Sil', danger: true }
    )
    if (!ok) return
    await api.knownHosts.remove(k.hostPort)
    load()
  }

  const labelFor = (hp: string): string | undefined => {
    const i = hp.lastIndexOf(':')
    const addr = hp.slice(0, i)
    const port = Number(hp.slice(i + 1))
    return data.hosts.filter((h) => h.address === addr && (h.port || 22) === port).map((h) => h.label).join(', ') || undefined
  }

  return (
    <section className="host-section">
      <div className="section-head">
        <h2>Bilinen sunucular</h2>
        <span className="count">{list?.length ?? 0}</span>
      </div>
      <p className="muted small section-desc">
        İlk bağlantıda onayladığınız sunucu parmak izleri. Parmak izi değişirse bağlanmadan önce uyarılırsınız.
      </p>
      {list && list.length > 0 && (
        <div className="list">
          {list.map((k) => (
            <div key={k.hostPort} className="list-row">
              <div className="list-icon">
                <Icon name="shield" />
              </div>
              <div className="list-main">
                <strong>
                  {k.hostPort}
                  {labelFor(k.hostPort) && <span className="muted"> · {labelFor(k.hostPort)}</span>}
                </strong>
                <span className="muted mono small">{k.fingerprint}</span>
              </div>
              <div className="list-actions">
                <button className="icon-btn" title="Kaydı sil" onClick={() => remove(k)}>
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
