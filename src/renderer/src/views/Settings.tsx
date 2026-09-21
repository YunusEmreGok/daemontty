import { useEffect, useState } from 'react'
import { BackupSummary, CursorStyle, DEFAULT_SETTINGS, Settings, TerminalTheme } from '@shared/types'
import { api, errMsg, formatDate, uid } from '../api'
import { useApp } from '../App'
import { Icon } from '../components/Icon'
import { DaemonttyLogo } from '../components/DaemonttyLogo'
import { TerminalPreview } from '../components/TerminalPreview'
import { Drawer, Field, useUi } from '../components/Ui'
import { useUpdateState } from '../update'
import { useLockState } from '../lock'
import { allThemes, COLOR_KEYS, findTheme, FONT_CHOICES, fontStack, isBuiltin, primaryFont } from '../themes'

type Section = 'look' | 'behavior' | 'security' | 'backup' | 'keys' | 'about'

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'look', label: 'Terminal görünümü', icon: 'palette' },
  { id: 'behavior', label: 'Davranış', icon: 'terminal' },
  { id: 'security', label: 'Güvenlik', icon: 'lock' },
  { id: 'backup', label: 'Yedekleme', icon: 'archive' },
  { id: 'keys', label: 'Kısayollar', icon: 'keyboard' },
  { id: 'about', label: 'Hakkında', icon: 'info' }
]

export function SettingsView() {
  const { data, updateSettings: save } = useApp()
  const s = data.settings
  const [section, setSection] = useState<Section>('look')

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">
          <h1>Ayarlar</h1>
          <p>Terminalinizi ve uygulamayı zevkinize göre düzenleyin</p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((x) => (
            <button key={x.id} className={section === x.id ? 'active' : ''} onClick={() => setSection(x.id)}>
              <Icon name={x.icon} /> {x.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {section === 'look' && <LookSettings s={s} save={save} />}
          {section === 'behavior' && <BehaviorSettings s={s} save={save} />}
          {section === 'security' && <SecuritySettings encrypted={data.encrypted} s={s} save={save} />}
          {section === 'backup' && <BackupSettings />}
          {section === 'keys' && <Shortcuts />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function LookSettings({ s, save }: { s: Settings; save(p: Partial<Settings>): void }) {
  const ui = useUi()
  const [editing, setEditing] = useState<TerminalTheme | null>(null)
  const current = findTheme(s)
  const fontName = primaryFont(s.fontFamily)
  const known = FONT_CHOICES.find((f) => f.family === fontName)
  const [customFont, setCustomFont] = useState(!known)

  const duplicate = (th: TerminalTheme): void =>
    setEditing({ ...th, id: '', name: `${th.name} (kopya)` })

  const removeTheme = async (th: TerminalTheme): Promise<void> => {
    if (!(await ui.confirm(`"${th.name}" teması silinsin mi?`, undefined, { confirmLabel: 'Sil', danger: true }))) return
    save({
      customThemes: s.customThemes.filter((x) => x.id !== th.id),
      themeId: s.themeId === th.id ? DEFAULT_SETTINGS.themeId : s.themeId
    })
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Tema</h2>
            <p className="muted small">Tüm terminallerde kullanılan renk şeması. Host düzenleme ekranından host'a özel tema da seçebilirsiniz.</p>
          </div>
          <button className="btn" onClick={() => duplicate(current)}>
            <Icon name="plus" /> Yeni tema
          </button>
        </div>
        <div className="theme-grid">
          {allThemes(s).map((th) => (
            <div
              key={th.id}
              role="button"
              tabIndex={0}
              className={`theme-card ${th.id === current.id ? 'selected' : ''}`}
              onClick={() => save({ themeId: th.id })}
              onKeyDown={(e) => e.key === 'Enter' && save({ themeId: th.id })}
            >
              <TerminalPreview theme={th} fontFamily={s.fontFamily} mini />
              <div className="theme-card-foot">
                <span>{th.name}</span>
                {!isBuiltin(th.id) && <span className="tag">özel</span>}
                <div className="spacer" />
                <button
                  className="icon-btn"
                  title={isBuiltin(th.id) ? 'Kopyala ve düzenle' : 'Düzenle'}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isBuiltin(th.id)) duplicate(th)
                    else setEditing(th)
                  }}
                >
                  <Icon name={isBuiltin(th.id) ? 'copy' : 'edit'} size={14} />
                </button>
                {!isBuiltin(th.id) && (
                  <button
                    className="icon-btn"
                    title="Sil"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeTheme(th)
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
              {th.id === current.id && (
                <span className="theme-check">
                  <Icon name="check" size={12} />
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Yazı ve imleç</h2>
        <div className="look-grid">
          <div className="form">
            <Field label="Yazı tipi">
              <select
                value={known && !customFont ? known.family : '__custom'}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomFont(v === '__custom')
                  if (v !== '__custom') save({ fontFamily: fontStack(v) })
                }}
              >
                {FONT_CHOICES.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.label}
                    {f.bundled ? ' (dahili)' : ''}
                  </option>
                ))}
                <option value="__custom">Özel…</option>
              </select>
            </Field>
            {(customFont || !known) && (
              <Field label="Özel yazı tipi listesi" hint="Bilgisayarınızda kurulu yazı tipi adı">
                <input className="mono" value={s.fontFamily} onChange={(e) => save({ fontFamily: e.target.value })} spellCheck={false} />
              </Field>
            )}
            <Slider label="Yazı boyutu" value={s.fontSize} min={9} max={28} step={1} unit="px" onChange={(v) => save({ fontSize: v })} />
            <Slider label="Satır yüksekliği" value={s.lineHeight} min={1} max={2} step={0.05} onChange={(v) => save({ lineHeight: v })} />
            <Slider label="Harf aralığı" value={s.letterSpacing} min={-1} max={4} step={0.5} unit="px" onChange={(v) => save({ letterSpacing: v })} />
            <Slider label="Kenar boşluğu" value={s.padding} min={0} max={40} step={2} unit="px" onChange={(v) => save({ padding: v })} />
            <div className="field">
              <span>İmleç biçimi</span>
              <div className="segmented">
                {(
                  [
                    ['block', 'Blok █'],
                    ['bar', 'Çizgi ▏'],
                    ['underline', 'Alt çizgi _']
                  ] as Array<[CursorStyle, string]>
                ).map(([v, l]) => (
                  <button type="button" key={v} className={s.cursorStyle === v ? 'active' : ''} onClick={() => save({ cursorStyle: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={s.cursorBlink} onChange={(e) => save({ cursorBlink: e.target.checked })} />
              İmleç yanıp sönsün
            </label>
            <button
              className="btn"
              onClick={() =>
                save({
                  fontFamily: DEFAULT_SETTINGS.fontFamily,
                  fontSize: DEFAULT_SETTINGS.fontSize,
                  lineHeight: DEFAULT_SETTINGS.lineHeight,
                  letterSpacing: DEFAULT_SETTINGS.letterSpacing,
                  padding: DEFAULT_SETTINGS.padding,
                  cursorStyle: DEFAULT_SETTINGS.cursorStyle,
                  cursorBlink: DEFAULT_SETTINGS.cursorBlink
                })
              }
            >
              <Icon name="refresh" /> Varsayılanlara dön
            </button>
          </div>
          <div className="look-preview">
            <div className="preview-label">Canlı önizleme</div>
            <div className="preview-window">
              <div className="preview-titlebar">
                <i />
                <i />
                <i />
                <span>yunus@sunucu — {current.name}</span>
              </div>
              <TerminalPreview
                theme={current}
                fontFamily={s.fontFamily}
                fontSize={s.fontSize}
                lineHeight={s.lineHeight}
                letterSpacing={s.letterSpacing}
                cursorStyle={s.cursorStyle}
                padding={s.padding}
              />
            </div>
          </div>
        </div>
      </section>

      {editing && (
        <ThemeEditor
          initial={editing}
          settings={s}
          onClose={() => setEditing(null)}
          onSave={(th) => {
            const exists = s.customThemes.some((x) => x.id === th.id)
            save({
              customThemes: exists ? s.customThemes.map((x) => (x.id === th.id ? th : x)) : [...s.customThemes, th],
              themeId: th.id
            })
            ui.toast(`"${th.name}" teması kaydedildi ve uygulandı`, 'success')
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange(v: number): void }) {
  const shown = Number.isInteger(props.step) ? props.value : props.value.toFixed(2).replace(/0$/, '')
  return (
    <label className="slider">
      <span>
        {props.label}
        <b>
          {String(shown).replace('.', ',')}
          {props.unit ?? ''}
        </b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

function ThemeEditor({
  initial,
  settings,
  onClose,
  onSave
}: {
  initial: TerminalTheme
  settings: Settings
  onClose(): void
  onSave(th: TerminalTheme): void
}) {
  const [th, setTh] = useState<TerminalTheme>(initial)
  const set = (k: keyof TerminalTheme, v: string): void => setTh((x) => ({ ...x, [k]: v }))
  const valid = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v)
  // Açık/koyu bilgisini arka plan parlaklığından çıkar.
  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16)
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  }

  return (
    <Drawer
      wide
      title={initial.id ? 'Temayı düzenle' : 'Yeni tema'}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            İptal
          </button>
          <button
            className="btn btn-primary"
            disabled={!th.name.trim() || COLOR_KEYS.some((c) => !valid(th[c.key]))}
            onClick={() => onSave({ ...th, id: th.id || uid(), name: th.name.trim(), light: lum(th.background) > 0.6 })}
          >
            Kaydet ve uygula
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Tema adı">
          <input autoFocus value={th.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="editor-preview">
          <TerminalPreview
            theme={th}
            fontFamily={settings.fontFamily}
            fontSize={12}
            lineHeight={settings.lineHeight}
            cursorStyle={settings.cursorStyle}
          />
        </div>
        <h4>Temel renkler</h4>
        <div className="color-grid">
          {COLOR_KEYS.slice(0, 4).map((c) => (
            <ColorInput key={c.key} label={c.label} value={th[c.key]} onChange={(v) => set(c.key, v)} />
          ))}
        </div>
        <h4>ANSI renkleri</h4>
        <div className="color-grid">
          {COLOR_KEYS.slice(4).map((c) => (
            <ColorInput key={c.key} label={c.label} value={th[c.key]} onChange={(v) => set(c.key, v)} />
          ))}
        </div>
      </div>
    </Drawer>
  )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const [text, setText] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(value)
  }
  return (
    <label className="color-input">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      <span>{label}</span>
      <input
        className="mono"
        value={text}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase())
        }}
      />
    </label>
  )
}

function BehaviorSettings({ s, save }: { s: Settings; save(p: Partial<Settings>): void }) {
  const ui = useUi()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    api.history.count().then(setCount)
  }, [])

  const clear = async (): Promise<void> => {
    if (!(await ui.confirm('Komut geçmişi silinsin mi?', 'Tüm host\'lar için kaydedilen komutlar silinir; öneriler sıfırlanır.', { confirmLabel: 'Sil', danger: true })))
      return
    await api.history.clear()
    setCount(0)
    ui.toast('Komut geçmişi silindi', 'success')
  }

  return (
    <>
      <section className="card">
        <h2>Otomatik tamamlama</h2>
        <p className="muted small card-desc">
          Yazarken komut geçmişinizden, snippet'lerinizden, sunucudaki dosyalardan ve yaygın Linux komutlarından (Türkçe açıklamalarıyla)
          öneriler sunar. Yanlış yazılan komutlar için düzeltme önerir.
        </p>
        <div className="form narrow">
          <Toggle
            checked={s.autocomplete}
            onChange={(v) => save({ autocomplete: v })}
            title="Öneri listesini göster"
            desc="↑↓ ile seçin, Tab ile kabul edin, Esc ile kapatın"
          />
          <Toggle
            checked={s.ghostText}
            disabled={!s.autocomplete}
            onChange={(v) => save({ ghostText: v })}
            title="Satır içi soluk tamamlama"
            desc="En iyi öneri imlecin sağında soluk görünür; → ile tamamlayın"
          />
          <Toggle
            checked={s.saveHistory}
            onChange={(v) => save({ saveHistory: v })}
            title="Komut geçmişini kaydet"
            desc="Şifreli kasada saklanır. Boşlukla başlayan ve parola içeren komutlar kaydedilmez."
          />
          <div className="row">
            <button className="btn" onClick={clear} disabled={!count}>
              <Icon name="trash" /> Geçmişi temizle
            </button>
            <span className="muted small">{count === null ? '' : `${count} kayıtlı komut`}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Terminal davranışı</h2>
        <div className="form narrow">
          <Field label="Geri kaydırma satır sayısı" hint="Terminal geçmişinde tutulacak satır sayısı">
            <input
              type="number"
              min={1000}
              max={100000}
              step={1000}
              value={s.scrollback}
              onChange={(e) => save({ scrollback: Number(e.target.value) || DEFAULT_SETTINGS.scrollback })}
            />
          </Field>
          <Toggle
            checked={s.autoReconnect}
            onChange={(v) => save({ autoReconnect: v })}
            title="Bağlantı koparsa otomatik yeniden bağlan"
            desc="Mac uykudan uyanınca ya da ağ değişince artan aralıklarla (1 sn … 30 sn) 8 kez dener"
          />
          <Toggle
            checked={s.showServerStats}
            onChange={(v) => save({ showServerStats: v })}
            title="Sunucu durumunu göster"
            desc="Terminal üst çubuğunda CPU, RAM, disk ve sistem yükü (Linux sunucular)"
          />
          <Toggle checked={s.copyOnSelect} onChange={(v) => save({ copyOnSelect: v })} title="Seçilen metni otomatik kopyala" />
          <Toggle
            checked={s.gpuRendering}
            onChange={(v) => save({ gpuRendering: v })}
            title="GPU ile hızlandırılmış çizim"
            desc="Terminal daha akıcı çizilir. Görüntü bozulması olursa kapatın."
          />
          <Toggle
            checked={s.sessionLog}
            onChange={(v) => save({ sessionLog: v })}
            title="Oturumları dosyaya kaydet"
            desc="Terminal çıktısı sunucu başına klasörlere düz metin olarak yazılır. Yeni açılan oturumlardan itibaren geçerlidir; kayıtlar şifrelenmez."
          />
          <button type="button" className="btn btn-sm" onClick={() => api.logs.openDir()}>
            <Icon name="folder" /> Kayıt klasörünü aç
          </button>
        </div>
      </section>
    </>
  )
}

function BackupSettings() {
  const ui = useUi()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [imp, setImp] = useState<{ file: string; password: string; summary?: BackupSummary } | null>(null)

  const doExport = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (pw.length < 8) return ui.toast('Parola en az 8 karakter olmalı', 'error')
    if (pw !== pw2) return ui.toast('Parolalar eşleşmiyor', 'error')
    setBusy(true)
    try {
      const file = await api.backup.export(pw)
      if (file) {
        ui.toast(`Yedek kaydedildi: ${file}`, 'success')
        setPw('')
        setPw2('')
      }
    } catch (err) {
      ui.toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const pick = async (): Promise<void> => {
    const file = await api.backup.pickFile()
    if (file) setImp({ file, password: '' })
  }

  const preview = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!imp) return
    setBusy(true)
    try {
      setImp({ ...imp, summary: await api.backup.inspect(imp.file, imp.password) })
    } catch (err) {
      ui.toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const apply = async (mode: 'merge' | 'replace'): Promise<void> => {
    if (!imp) return
    if (
      mode === 'replace' &&
      !(await ui.confirm('Mevcut kasa silinip yedekle değiştirilsin mi?', 'Şu anki host, anahtar ve ayarlarınızın yerini yedektekiler alır. Bu işlem geri alınamaz.', {
        confirmLabel: 'Değiştir',
        danger: true
      }))
    )
      return
    setBusy(true)
    try {
      await api.backup.import(imp.file, imp.password, mode)
      ui.toast(mode === 'merge' ? 'Yedek mevcut kasayla birleştirildi' : 'Kasa yedekten geri yüklendi', 'success')
      setImp(null)
    } catch (err) {
      ui.toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const sm = imp?.summary
  return (
    <>
      <section className="card">
        <h2>Şifreli yedek al</h2>
        <p className="muted small card-desc">
          Host'lar, anahtarlar, kimlikler, snippet'ler, tüneller, temalar ve ayarlar tek bir dosyaya, belirlediğiniz parolayla
          (AES-256) şifrelenerek kaydedilir. Bu dosyayla başka bir bilgisayara taşıyabilir ya da Mac'i sıfırladıktan sonra geri
          yükleyebilirsiniz. <b>Parolayı unutursanız yedek açılamaz.</b>
        </p>
        <form className="form narrow" onSubmit={doExport}>
          <Field label="Yedek parolası" hint="En az 8 karakter">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Parola (tekrar)">
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy || !pw}>
            <Icon name="download" /> Yedeği kaydet…
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Yedekten geri yükle</h2>
        {!imp ? (
          <button className="btn" onClick={pick}>
            <Icon name="upload" /> Yedek dosyası seç…
          </button>
        ) : !sm ? (
          <form className="form narrow" onSubmit={preview}>
            <p className="muted small mono">{imp.file}</p>
            <Field label="Yedek parolası">
              <input autoFocus type="password" value={imp.password} onChange={(e) => setImp({ ...imp, password: e.target.value })} />
            </Field>
            <div className="row">
              <button type="button" className="btn" onClick={() => setImp(null)}>
                İptal
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !imp.password}>
                {busy ? 'Açılıyor…' : 'Yedeği aç'}
              </button>
            </div>
          </form>
        ) : (
          <div className="form narrow">
            <div className="backup-summary">
              <strong>{formatDate(sm.createdAt)} tarihli yedek</strong>
              <span>
                {sm.hosts} host · {sm.keys} anahtar · {sm.identities} kimlik · {sm.snippets} snippet · {sm.forwards} tünel · {sm.groups} grup
              </span>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setImp(null)}>
                İptal
              </button>
              <button className="btn btn-danger-ghost" onClick={() => apply('replace')} disabled={busy}>
                Tümünü değiştir
              </button>
              <button className="btn btn-primary" onClick={() => apply('merge')} disabled={busy}>
                Birleştir (önerilen)
              </button>
            </div>
            <p className="muted small">Birleştir: sadece kasanızda olmayan kayıtlar eklenir, mevcutlara dokunulmaz.</p>
          </div>
        )}
      </section>
    </>
  )
}

const LOCK_MINUTES: Array<[number, string]> = [
  [0, 'Yalnızca açılışta ve ekran kilitlenince'],
  [1, '1 dakika boşta kalınca'],
  [5, '5 dakika boşta kalınca'],
  [15, '15 dakika boşta kalınca'],
  [30, '30 dakika boşta kalınca'],
  [60, '1 saat boşta kalınca']
]

function AppLockCard({ s, save }: { s: Settings; save(p: Partial<Settings>): void }) {
  const ui = useUi()
  const lock = useLockState()
  if (!lock) return null

  const run = async (fn: () => Promise<void>, done: string): Promise<void> => {
    try {
      await fn()
      ui.toast(done, 'success')
    } catch (e) {
      ui.toast(errMsg(e), 'error')
    }
  }

  const setPassword = async (): Promise<void> => {
    const fields = [
      ...(lock.enabled ? [{ label: 'Mevcut parola', secret: true }] : []),
      { label: 'Yeni ana parola (en az 6 karakter)', secret: true },
      { label: 'Yeni ana parola (tekrar)', secret: true }
    ]
    const v = await ui.form(lock.enabled ? 'Ana parolayı değiştir' : 'Ana parola belirle', fields, {
      message: 'Bu parola verilerinizi diskte şifreler. Unutursanız verileriniz KURTARILAMAZ; önce Yedekleme bölümünden şifreli yedek almanız önerilir.',
      confirmLabel: 'Kaydet'
    })
    if (!v) return
    const [current, next, again] = lock.enabled ? v : [null, v[0], v[1]]
    if (next !== again) return ui.toast('Parolalar eşleşmiyor', 'error')
    await run(() => api.lock.setPassword(next, current), lock.enabled ? 'Ana parola değiştirildi' : 'Uygulama kilidi açıldı')
  }

  const askCurrent = async (title: string, message?: string): Promise<string | null> =>
    (await ui.form(title, [{ label: 'Ana parola', secret: true }], { message, confirmLabel: 'Devam' }))?.[0] ?? null

  const disable = async (): Promise<void> => {
    const pw = await askCurrent('Uygulama kilidini kaldır', 'Veriler yine işletim sisteminin anahtar zinciriyle şifreli kalır, ancak uygulama parola sormaz.')
    if (pw) await run(() => api.lock.disable(pw), 'Uygulama kilidi kaldırıldı')
  }

  const toggleTouchId = async (on: boolean): Promise<void> => {
    const pw = await askCurrent(on ? 'Touch ID ile açmayı etkinleştir' : 'Touch ID ile açmayı kapat')
    if (pw) await run(() => api.lock.setTouchId(on, pw), on ? 'Touch ID etkin' : 'Touch ID kapatıldı')
  }

  return (
    <section className="card">
      <h2>Uygulama kilidi</h2>
      {!lock.enabled ? (
        <div className="form narrow">
          <p className="muted">
            Ana parola belirlerseniz Daemontty açılışta ve boşta kalınca parola sorar; verileriniz diskte bu parolayla da şifrelenir. Bilgisayarınızı açık
            bulan biri sunucularınıza giremez.
          </p>
          <button type="button" className="btn btn-primary" onClick={setPassword}>
            <Icon name="lock" /> Ana parola belirle
          </button>
        </div>
      ) : (
        <div className="form narrow">
          <Field label="Otomatik kilitle">
            <select value={s.lockAfterMinutes} onChange={(e) => save({ lockAfterMinutes: Number(e.target.value) })}>
              {LOCK_MINUTES.map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {lock.touchIdAvailable && (
            <Toggle
              checked={lock.touchId}
              onChange={toggleTouchId}
              title="Touch ID ile aç"
              desc="Kilit anahtarı macOS Anahtar Zinciri'nde saklanır ve parmak izinizle açılır."
            />
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => api.lock.now()}>
              <Icon name="lock" /> Şimdi kilitle
            </button>
            <button type="button" className="btn" onClick={setPassword}>
              Parolayı değiştir
            </button>
            <button type="button" className="btn btn-danger" onClick={disable}>
              Kilidi kaldır
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Toggle(props: { checked: boolean; onChange(v: boolean): void; title: string; desc?: string; disabled?: boolean }) {
  return (
    <label className={`toggle-row ${props.disabled ? 'disabled' : ''}`}>
      <span className="toggle-text">
        <strong>{props.title}</strong>
        {props.desc && <small>{props.desc}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  )
}

function SecuritySettings({ encrypted, s, save }: { encrypted: boolean; s: Settings; save(p: Partial<Settings>): void }) {
  return (
    <>
    <section className="card">
      <h2>Kimlik doğrulama</h2>
      <div className="form narrow">
        <Toggle
          checked={s.useSystemKeys}
          onChange={(v) => save({ useSystemKeys: v })}
          title="ssh-agent ve ~/.ssh anahtarlarını otomatik dene"
          desc="Anahtar atanmamış host'larda, terminaldeki ssh komutu gibi önce ssh-agent'ı, sonra ~/.ssh/id_ed25519, id_ecdsa, id_rsa dosyalarını dener."
        />
      </div>
    </section>
    <AppLockCard s={s} save={save} />
    <section className="card">
      <h2>Güvenlik</h2>
      <div className={`security-banner ${encrypted ? 'ok' : 'bad'}`}>
        <Icon name="lock" size={20} />
        <div>
          <strong>{encrypted ? 'Veriler şifreli' : 'Veriler şifresiz'}</strong>
          <p>
            {encrypted
              ? 'Host bilgileri, parolalar ve anahtarlar işletim sisteminin anahtar zinciri ile şifrelenerek saklanıyor.'
              : 'Bu sistemde işletim sistemi şifrelemesi kullanılamıyor. Linux’ta gnome-keyring ya da kwallet kurmanız önerilir.'}
          </p>
        </div>
      </div>
      <ul className="bullets">
        <li>Sunucu parmak izleri ilk bağlantıda onayınızla kaydedilir; değişirse bağlanmadan önce uyarılırsınız.</li>
        <li>Özel anahtarlar arayüze hiç gönderilmez; yalnızca bağlantı sırasında ana süreçte kullanılır.</li>
      </ul>
    </section>
    </>
  )
}

function Shortcuts() {
  const mac = api.platform === 'darwin'
  const mod = mac ? '⌘' : 'Ctrl'
  // Her satır: alternatif tuş kombinasyonları ve açıklama.
  const rows: Array<[string[][], string]> = [
    [[mac ? ['⌘', 'K'] : ['Ctrl', 'Shift', 'K']], 'Komut paleti (bağlan, çalıştır, git)'],
    [[mac ? ['⌘', 'T'] : ['Ctrl', 'Shift', 'T']], 'Yerel terminal aç'],
    [[mac ? ['⌘', 'F'] : ['Ctrl', 'Shift', 'F']], 'Terminalde ara'],
    [[mac ? ['⌘', 'D'] : ['Ctrl', 'Shift', 'D']], 'Ekranı sağa böl'],
    ...(mac ? ([[[['⌘', '⇧', 'D']], 'Ekranı aşağı böl']] as Array<[string[][], string]>) : []),
    [[mac ? ['⌘', 'W'] : ['Ctrl', 'Shift', 'W']], 'Paneli kapat'],
    [[mac ? ['⌘', ']'] : ['Ctrl', 'Shift', ']']], 'Sonraki panel'],
    [[mac ? ['⌘', '⇧', 'B'] : ['Ctrl', 'Shift', 'B']], 'Tüm panellere yaz (aç/kapat)'],
    [[['Tab']], 'Öneriyi kabul et (liste açıkken)'],
    [[['→']], 'Soluk tamamlamayı kabul et'],
    [[[mod, '1']], 'Sunucular (ana sayfa)'],
    [[[mod, '2 … 9']], 'Açık sekmeler arasında geçiş'],
    [[[mod, '+'], [mod, '−']], 'Terminal yazısını büyüt / küçült'],
    [[[mod, '0']], 'Yazı boyutunu sıfırla'],
    [mac ? [['⌘', 'C'], ['⌘', 'V']] : [['Ctrl', 'Shift', 'C'], ['Ctrl', 'Shift', 'V']], 'Terminalde kopyala / yapıştır'],
    [[['Orta tık']], 'Sekmeyi kapat']
  ]
  return (
    <section className="card">
      <h2>Klavye kısayolları</h2>
      <table className="shortcuts">
        <tbody>
          {rows.map(([combos, desc]) => (
            <tr key={desc}>
              <td>
                {combos.map((keys, i) => (
                  <span key={i} className="combo">
                    {i > 0 && <span className="muted"> / </span>}
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                ))}
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function AboutSettings() {
  const isWin = api.platform === 'win32'
  const isMac = api.platform === 'darwin'
  const platformName = isWin ? 'Windows' : isMac ? 'macOS' : 'Linux'
  const update = useUpdateState()
  const [version, setVersion] = useState('')
  useEffect(() => {
    api.update.version().then(setVersion)
  }, [])

  const updateText =
    update.status === 'checking'
      ? 'Denetleniyor…'
      : update.status === 'current'
        ? 'En güncel sürümü kullanıyorsunuz'
        : update.status === 'available'
          ? `Yeni sürüm: ${update.version}`
          : update.status === 'downloading'
            ? `${update.version} indiriliyor… %${update.percent}`
            : update.status === 'ready'
              ? `${update.version} indirildi, yeniden başlatınca kurulacak`
              : update.status === 'error'
                ? update.message
                : ''

  return (
    <>
      <section className="card about-card">
        <div className="about-hero">
          <div className="about-logo-wrapper" title="Daemontty">
            <DaemonttyLogo size={60} />
          </div>
          <div className="about-meta">
            <div className="about-title-row">
              <h2 className="about-title">Daemontty</h2>
              <span className="about-version">v{version}</span>
            </div>
            <p className="about-subtitle">Arka plan servislerini ve sunucu yönetimini odağa alan modern SSH & Terminal istemcisi</p>
            <div className="about-badges">
              <span className="about-badge-item">İşletim Sistemi: {platformName}</span>
              <span className="about-badge-item">Kasa: AES-256-GCM</span>
              <span className="about-badge-item">Protokol: SSH-2 / SFTP</span>
              <span className="about-badge-item">Lisans: MIT</span>
            </div>
            <div className="row">
              {update.status === 'ready' ? (
                <button className="btn btn-primary" onClick={() => api.update.install()}>
                  <Icon name="refresh" /> Yeniden başlat ve güncelle
                </button>
              ) : update.status === 'available' ? (
                <button className="btn btn-primary" onClick={() => api.update.download()}>
                  <Icon name="download" /> {update.manual ? 'İndirme sayfasını aç' : 'Güncelle'}
                </button>
              ) : (
                <button className="btn" disabled={update.status === 'checking' || update.status === 'downloading'} onClick={() => api.update.check()}>
                  <Icon name="refresh" /> Güncellemeleri denetle
                </button>
              )}
              <span className={`small ${update.status === 'error' ? 'text-danger' : 'muted'}`}>{updateText}</span>
              <div className="spacer" />
              <button className="btn btn-sm" onClick={() => window.open('https://github.com/YunusEmreGok/daemontty/blob/main/CHANGELOG.md')}>
                Yenilikler
              </button>
            </div>
          </div>
        </div>

        <div className="about-grid">
          <div className="about-feature">
            <div className="about-feat-icon">
              <Icon name="terminal" size={18} />
            </div>
            <div>
              <strong>Modern Terminal & SSH</strong>
              <p className="muted small">WebGL GPU hızlandırma, tam UTF-8 / Türkçe karakter desteği, zengin tema ve font kütüphanesi.</p>
            </div>
          </div>
          <div className="about-feature">
            <div className="about-feat-icon">
              <Icon name="folder" size={18} />
            </div>
            <div>
              <strong>Entegre SFTP Dosya Yöneticisi</strong>
              <p className="muted small">Sürükle-bırak yükleme ve indirme, dosya izinleri ve anlık transfer takibi.</p>
            </div>
          </div>
          <div className="about-feature">
            <div className="about-feat-icon">
              <Icon name="forward" size={18} />
            </div>
            <div>
              <strong>SSH Tünelleme (Port Forwarding)</strong>
              <p className="muted small">Yerel (Local), Uzak (Remote) ve Dinamik (SOCKS5) tüneller ile güvenli ağ geçitleri.</p>
            </div>
          </div>
          <div className="about-feature">
            <div className="about-feat-icon">
              <Icon name="lock" size={18} />
            </div>
            <div>
              <strong>Güvenli Kasa & Şifreli Yedekleme</strong>
              <p className="muted small">Anahtar zinciri ve scrypt KDF korumalı yedekleme. Parolalar asla açık metin tutulmaz.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

