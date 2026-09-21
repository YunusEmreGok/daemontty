import { useEffect, useRef, useState } from 'react'
import type { TextFile } from '@shared/types'
import { errMsg, isMac } from '../api'
import { Icon } from './Icon'
import { useUi } from './Ui'

interface Props {
  name: string
  path: string
  /** Başlıkta gösterilir: sunucu adı ya da "Bu bilgisayar" */
  source: string
  read(): Promise<TextFile>
  write(content: string, mtime: number, force: boolean): Promise<number>
  /** saved: en az bir kez kaydedildi (liste yenilensin) */
  onClose(saved: boolean): void
}

/** SFTP panelinden açılan basit metin düzenleyici: ⌘S/Ctrl+S kaydeder, Esc kapatır. */
export function FileEditor(p: Props) {
  const ui = useUi()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const original = useRef('')
  const mtime = useRef(0)
  const crlf = useRef(false)
  const saved = useRef(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    p.read().then(
      (f) => {
        // textarea satır sonlarını \n'e çevirir; Windows dosyalarını kaydederken geri çeviririz.
        crlf.current = f.content.includes('\r\n')
        original.current = f.content.replace(/\r\n/g, '\n')
        mtime.current = f.mtime
        setText(original.current)
        requestAnimationFrame(() => area.current?.focus())
      },
      (e) => setError(errMsg(e))
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = text !== null && text !== original.current

  const save = async (force = false): Promise<void> => {
    if (text === null || saving || (!dirty && !force)) return
    setSaving(true)
    try {
      mtime.current = await p.write(crlf.current ? text.replace(/\n/g, '\r\n') : text, mtime.current, force)
      original.current = text
      saved.current = true
      setText(text) // dirty'yi yeniden hesaplat
      ui.toast(`${p.name} kaydedildi`, 'success')
    } catch (e) {
      const msg = errMsg(e)
      if (/bu arada değişmiş/.test(msg)) {
        setSaving(false)
        if (await ui.confirm('Dosya bu arada değişmiş', 'Siz düzenlerken dosya başka biri ya da bir program tarafından değiştirildi. Üzerine yazılsın mı?', { confirmLabel: 'Üzerine yaz', danger: true }))
          return save(true)
        return
      }
      ui.toast(msg, 'error')
    }
    setSaving(false)
  }

  const close = async (): Promise<void> => {
    if (dirty && !(await ui.confirm('Kaydedilmemiş değişiklikler var', 'Kapatırsanız değişiklikler kaybolur.', { confirmLabel: 'Kaydetmeden kapat', danger: true }))) return
    p.onClose(saved.current)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Odağı kaçırmak yerine sekme karakteri ekle (geri al geçmişini bozmadan).
      e.preventDefault()
      document.execCommand('insertText', false, '\t')
    }
  }

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.stopPropagation()}>
      <div className="editor">
        <div className="editor-head">
          <Icon name="file" />
          <strong>
            {p.name}
            {dirty && <span className="editor-dirty" title="Kaydedilmemiş değişiklik" />}
          </strong>
          <span className="muted small editor-path">
            {p.source} · {p.path}
          </span>
          <div className="spacer" />
          <button className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={() => save()}>
            <Icon name="check" size={13} /> {saving ? 'Kaydediliyor…' : 'Kaydet'} <kbd className="menu-kbd">{isMac ? '⌘S' : 'Ctrl+S'}</kbd>
          </button>
          <button className="icon-btn" title="Kapat (Esc)" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        {error ? (
          <div className="editor-msg">
            <Icon name="alert" size={20} />
            <p>{error}</p>
            <button className="btn" onClick={() => p.onClose(false)}>
              Kapat
            </button>
          </div>
        ) : text === null ? (
          <div className="editor-msg muted">Yükleniyor…</div>
        ) : (
          <textarea
            ref={area}
            className="editor-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
          />
        )}
      </div>
    </div>
  )
}
