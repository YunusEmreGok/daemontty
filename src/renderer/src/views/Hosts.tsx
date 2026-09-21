import { useEffect, useMemo, useState } from 'react'
import type { Host, HostProbe } from '@shared/types'
import { api, colorFor, errMsg, matches, uid } from '../api'
import { useApp } from '../App'
import { Icon } from '../components/Icon'
import { Drawer, Empty, Field, useUi } from '../components/Ui'
import { TerminalPreview } from '../components/TerminalPreview'
import { allThemes, findTheme, themeForHost } from '../themes'

export function HostsView() {
  const { data, openTab } = useApp()
  const ui = useUi()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Host | null>(null)
  const [reach, setReach] = useState<Record<string, HostProbe>>({})

  // Ekran açıkken dakikada bir sunuculara erişilebiliyor mu diye bak.
  const hostKey = data.hosts.map((h) => `${h.id}:${h.address}:${h.port}`).join('|')
  useEffect(() => {
    let stopped = false
    const run = (): void => {
      api.hosts.probe(data.hosts.map((h) => h.id)).then((list) => {
        if (!stopped) setReach(Object.fromEntries(list.map((r) => [r.id, r])))
      })
    }
    run()
    const t = setInterval(run, 60_000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [hostKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () =>
      data.hosts.filter(
        (h) =>
          !query ||
          matches(h.label, query) ||
          matches(h.address, query) ||
          matches(h.username, query) ||
          h.tags.some((t) => matches(t, query))
      ),
    [data.hosts, query]
  )

  const sections = useMemo(() => {
    const out = data.groups
      .map((g) => ({ group: g, hosts: filtered.filter((h) => h.groupId === g.id) }))
      .sort((a, b) => a.group.name.localeCompare(b.group.name, 'tr'))
    const ungrouped = filtered.filter((h) => !h.groupId || !data.groups.some((g) => g.id === h.groupId))
    return [{ group: null, hosts: ungrouped }, ...out]
  }, [data.groups, filtered])

  const newHost = (): void =>
    setEditing({ id: '', label: '', address: '', port: 22, tags: [], username: '' })

  const newGroup = async (): Promise<void> => {
    const name = await ui.ask('Yeni grup', 'Grup adı')
    if (name) await api.vault.upsert('groups', { id: uid(), name })
  }

  const renameGroup = async (id: string, current: string): Promise<void> => {
    const name = await ui.ask('Grubu yeniden adlandır', 'Grup adı', current)
    if (name) await api.vault.upsert('groups', { id, name })
  }

  const deleteGroup = async (id: string, name: string): Promise<void> => {
    if (await ui.confirm(`"${name}" grubu silinsin mi?`, 'İçindeki host\'lar silinmez, grupsuz kalır.', { confirmLabel: 'Sil', danger: true }))
      await api.vault.remove('groups', id)
  }

  const importConfig = async (): Promise<void> => {
    try {
      const r = await api.importSshConfig()
      ui.toast(
        r.added ? `${r.added} host içe aktarıldı${r.skipped ? `, ${r.skipped} tanesi zaten vardı` : ''}` : 'Eklenecek yeni host bulunamadı',
        r.added ? 'success' : 'info'
      )
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <h1>Hostlar</h1>
          <p>
            {data.hosts.length} sunucu{data.groups.length ? ` · ${data.groups.length} grup` : ''}
          </p>
        </div>
        <div className="search">
          <Icon name="search" />
          <input placeholder="Host, adres veya etiket ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn" onClick={importConfig} title="~/.ssh/config dosyasındaki host'ları ekle">
          <Icon name="import" /> SSH config'ten al
        </button>
        <button className="btn" onClick={newGroup}>
          <Icon name="folder" /> Yeni grup
        </button>
        <button className="btn btn-primary" onClick={newHost}>
          <Icon name="plus" /> Yeni host
        </button>
      </header>

      {data.hosts.length === 0 ? (
        <Empty
          icon="server"
          title="Henüz host eklenmedi"
          text="Bağlanmak istediğiniz sunucuyu ekleyin ya da mevcut ~/.ssh/config dosyanızı içe aktarın."
          action={
            <div className="row">
              <button className="btn" onClick={importConfig}>
                SSH config'ten al
              </button>
              <button className="btn btn-primary" onClick={newHost}>
                <Icon name="plus" /> Yeni host
              </button>
            </div>
          }
        />
      ) : (
        <div className="view-body">
          {sections.map(({ group, hosts }) =>
            !group && hosts.length === 0 ? null : (
              <section key={group?.id ?? 'none'} className="host-section">
                <div className="section-head">
                  <h2>{group ? group.name : data.groups.length ? 'Grupsuz' : 'Tüm hostlar'}</h2>
                  <span className="count">{hosts.length}</span>
                  {group && (
                    <div className="section-actions">
                      <button className="icon-btn" title="Yeniden adlandır" onClick={() => renameGroup(group.id, group.name)}>
                        <Icon name="edit" size={14} />
                      </button>
                      <button className="icon-btn" title="Grubu sil" onClick={() => deleteGroup(group.id, group.name)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {hosts.length === 0 ? (
                  <p className="muted small">{query ? 'Eşleşen host yok' : 'Bu grupta host yok'}</p>
                ) : (
                  <div className="host-grid">
                    {hosts.map((h) => (
                      <HostCard key={h.id} host={h} reach={reach[h.id]} onEdit={() => setEditing(h)} onSftp={() => openTab('sftp', h.id)} onConnect={() => openTab('terminal', h.id)} />
                    ))}
                  </div>
                )}
              </section>
            )
          )}
        </div>
      )}

      {editing && <HostForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function HostCard({
  host,
  reach,
  onConnect,
  onSftp,
  onEdit
}: {
  host: Host
  reach?: HostProbe
  onConnect(): void
  onSftp(): void
  onEdit(): void
}) {
  const { data, tabs } = useApp()
  const identity = data.identities.find((i) => i.id === host.identityId)
  const user = identity?.username || host.username
  const initials = host.label.slice(0, 2).toLocaleUpperCase('tr')
  const live = tabs.filter((t) => t.hostId === host.id && t.kind === 'terminal').length
  const color = colorFor(host.id)
  const theme = host.themeId ? findTheme(data.settings, host.themeId) : null
  return (
    <div className="host-card" onDoubleClick={onConnect} style={{ ['--host' as string]: color }}>
      <div className="host-avatar">
        {initials}
        {live > 0 && <span className="live-badge" title={`${live} açık oturum`} />}
      </div>
      <div className="host-info">
        <strong>{host.label}</strong>
        <span className="host-addr">
          {user ? `${user}@` : ''}
          {host.address}
          {host.port !== 22 ? `:${host.port}` : ''}
        </span>
        {reach && reach.online !== null && (
          <span className={`reach ${reach.online ? 'reach-on' : 'reach-off'}`} title={reach.online ? 'SSH portu yanıt veriyor' : 'SSH portuna ulaşılamıyor'}>
            <i />
            {reach.online ? `çevrimiçi · ${reach.ms} ms` : 'ulaşılamıyor'}
          </span>
        )}
        {(host.tags.length > 0 || host.jumpHostId || theme) && (
          <div className="tags">
            {theme && (
              <span className="tag tag-theme" title={`Tema: ${theme.name}`}>
                <i style={{ background: theme.background, boxShadow: `inset -5px 0 0 ${theme.cursor}` }} />
                {theme.name}
              </span>
            )}
            {host.jumpHostId && <span className="tag tag-jump">jump</span>}
            {host.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="host-actions">
        <button className="icon-btn" title="SFTP" onClick={onSftp}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn" title="Düzenle" onClick={onEdit}>
          <Icon name="edit" />
        </button>
        <button className="connect-btn" title="Bağlan" onClick={onConnect}>
          <Icon name="terminal" size={14} />
          Bağlan
        </button>
      </div>
    </div>
  )
}

function HostForm({ initial, onClose }: { initial: Host; onClose(): void }) {
  const { data } = useApp()
  const ui = useUi()
  const [h, setH] = useState<Host>(initial)
  const [tags, setTags] = useState(initial.tags.join(', '))
  const [showPw, setShowPw] = useState(false)
  const isNew = !initial.id
  const set = <K extends keyof Host>(k: K, v: Host[K]): void => setH((x) => ({ ...x, [k]: v }))

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!h.address.trim()) return ui.toast('Adres zorunlu', 'error')
    const port = Number(h.port) || 22
    if (port < 1 || port > 65535) return ui.toast('Port 1 ile 65535 arasında olmalı', 'error')
    const host: Host = {
      ...h,
      id: h.id || uid(),
      label: h.label.trim() || h.address.trim(),
      address: h.address.trim(),
      port,
      username: h.identityId ? undefined : h.username?.trim() || undefined,
      password: h.identityId ? undefined : h.password || undefined,
      keyId: h.identityId ? undefined : h.keyId || undefined,
      groupId: h.groupId || undefined,
      jumpHostId: h.jumpHostId || undefined,
      startupCommand: h.startupCommand?.trim() || undefined,
      themeId: h.themeId || undefined,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
    await api.vault.upsert('hosts', host)
    ui.toast(isNew ? 'Host eklendi' : 'Host kaydedildi', 'success')
    onClose()
  }

  const del = async (): Promise<void> => {
    if (!(await ui.confirm(`"${initial.label}" silinsin mi?`, 'Bu host\'a ait port yönlendirme kuralları da silinir.', { confirmLabel: 'Sil', danger: true })))
      return
    await api.vault.remove('hosts', initial.id)
    onClose()
  }

  return (
    <Drawer
      title={isNew ? 'Yeni host' : 'Host düzenle'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn btn-danger-ghost" onClick={del}>
              <Icon name="trash" /> Sil
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button className="btn btn-primary" form="host-form" type="submit">
            Kaydet
          </button>
        </>
      }
    >
      <form id="host-form" onSubmit={save} className="form">
        <h4>Genel</h4>
        <Field label="Adres" hint="IP adresi ya da alan adı">
          <input autoFocus value={h.address} onChange={(e) => set('address', e.target.value)} placeholder="192.168.1.10" spellCheck={false} />
        </Field>
        <div className="form-row">
          <Field label="Etiket">
            <input value={h.label} onChange={(e) => set('label', e.target.value)} placeholder="Web sunucusu" />
          </Field>
          <Field label="Port">
            <input className="w-port" type="number" min={1} max={65535} value={h.port} onChange={(e) => set('port', Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Grup">
          <select value={h.groupId ?? ''} onChange={(e) => set('groupId', e.target.value || undefined)}>
            <option value="">— Grup yok —</option>
            {data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Etiketler" hint="Virgülle ayırın: prod, web">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>

        <h4>Kimlik doğrulama</h4>
        <Field label="Kimlik" hint="Keychain'deki kayıtlı bir kimliği kullanın ya da bilgileri aşağıya girin">
          <select value={h.identityId ?? ''} onChange={(e) => set('identityId', e.target.value || undefined)}>
            <option value="">— Bu host'a özel bilgiler —</option>
            {data.identities.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.username})
              </option>
            ))}
          </select>
        </Field>
        {!h.identityId && (
          <>
            <Field label="Kullanıcı adı">
              <input value={h.username ?? ''} onChange={(e) => set('username', e.target.value)} placeholder="root" spellCheck={false} />
            </Field>
            <Field label="Parola" hint="Boş bırakırsanız bağlanırken sorulur">
              <div className="input-group">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={h.password ?? ''}
                  onChange={(e) => set('password', e.target.value)}
                  autoComplete="new-password"
                />
                <button type="button" className="icon-btn" onClick={() => setShowPw((v) => !v)} title="Göster / gizle">
                  <Icon name="eye" />
                </button>
              </div>
            </Field>
            <Field
              label="SSH anahtarı"
              hint={data.settings.useSystemKeys ? 'Boş bırakılırsa ssh-agent ve ~/.ssh/id_* anahtarları otomatik denenir' : undefined}
            >
              <select value={h.keyId ?? ''} onChange={(e) => set('keyId', e.target.value || undefined)}>
                <option value="">— Anahtar yok —</option>
                {data.keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.type})
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <h4>Görünüm</h4>
        <Field label="Terminal teması">
          <select value={h.themeId ?? ''} onChange={(e) => set('themeId', e.target.value || undefined)}>
            <option value="">Genel tema ({findTheme(data.settings).name})</option>
            {allThemes(data.settings).map((th) => (
              <option key={th.id} value={th.id}>
                {th.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-preview">
          <TerminalPreview theme={themeForHost(data.settings, h)} fontFamily={data.settings.fontFamily} mini />
        </div>

        <h4>Gelişmiş</h4>
        <Field label="Jump host (ProxyJump)" hint="Bu sunucuya önce seçilen host üzerinden bağlanılır">
          <select value={h.jumpHostId ?? ''} onChange={(e) => set('jumpHostId', e.target.value || undefined)}>
            <option value="">— Doğrudan bağlan —</option>
            {data.hosts
              .filter((x) => x.id !== h.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={!!h.agentForward} onChange={(e) => set('agentForward', e.target.checked || undefined)} />
          <span>
            Ajan yönlendirme (ssh -A)
            <small className="muted block">Sunucudan başka sunuculara (ör. git) kendi anahtarlarınızla geçmenizi sağlar</small>
          </span>
        </label>
        <Field label="Başlangıç komutu" hint="Bağlandıktan sonra otomatik çalıştırılır">
          <input value={h.startupCommand ?? ''} onChange={(e) => set('startupCommand', e.target.value)} placeholder="cd /var/www && ls" spellCheck={false} />
        </Field>
      </form>
    </Drawer>
  )
}
