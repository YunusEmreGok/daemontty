import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { PromptField } from '@shared/types'
import { api } from '../api'
import { Icon } from './Icon'

// --- Bildirimler, onay ve soru pencereleri için ortak altyapı ---

type ToastKind = 'info' | 'success' | 'error'
interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface Dialog {
  id: number
  title: string
  message?: string
  fields: Array<PromptField & { initial?: string }>
  confirmLabel: string
  danger?: boolean
  resolve(values: string[] | null): void
}

interface UiApi {
  toast(text: string, kind?: ToastKind): void
  confirm(title: string, message?: string, opts?: { confirmLabel?: string; danger?: boolean }): Promise<boolean>
  ask(title: string, label: string, initial?: string): Promise<string | null>
}

const UiContext = createContext<UiApi>(null as never)
export const useUi = (): UiApi => useContext(UiContext)

let toastSeq = 0

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialogs, setDialogs] = useState<Dialog[]>([])

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++toastSeq
    setToasts((t) => [...t.filter((x) => x.text !== text), { id, kind, text }].slice(-3))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])

  const open = useCallback((d: Omit<Dialog, 'resolve' | 'id'>) => {
    return new Promise<string[] | null>((resolve) => setDialogs((ds) => [...ds, { ...d, id: ++toastSeq, resolve }]))
  }, [])

  const confirm = useCallback<UiApi['confirm']>(
    async (title, message, opts) =>
      (await open({ title, message, fields: [], confirmLabel: opts?.confirmLabel ?? 'Tamam', danger: opts?.danger })) !== null,
    [open]
  )

  const ask = useCallback<UiApi['ask']>(
    async (title, label, initial) => {
      const v = await open({ title, fields: [{ label, secret: false, initial }], confirmLabel: 'Kaydet' })
      return v ? v[0].trim() || null : null
    },
    [open]
  )

  // Ana süreçten gelen sorular (parola, kullanıcı adı, 2FA kodu…)
  useEffect(
    () =>
      api.prompt.onRequest(async (req) => {
        const v = await open({ title: req.title, message: req.message, fields: req.fields, confirmLabel: 'Devam' })
        api.prompt.respond(req.id, v)
      }),
    [open]
  )

  const close = (d: Dialog, values: string[] | null): void => {
    d.resolve(values)
    setDialogs((ds) => ds.filter((x) => x !== d))
  }

  return (
    <UiContext.Provider value={{ toast, confirm, ask }}>
      {children}
      {dialogs.slice(0, 1).map((d) => (
        <DialogView key={d.id} dialog={d} onClose={(v) => close(d, v)} />
      ))}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </UiContext.Provider>
  )
}

function DialogView({ dialog, onClose }: { dialog: Dialog; onClose(values: string[] | null): void }) {
  const [values, setValues] = useState(dialog.fields.map((f) => f.initial ?? ''))
  const first = useRef<HTMLInputElement>(null)
  const okBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (first.current) {
      first.current.focus()
      first.current.select()
    } else okBtn.current?.focus()
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(null)}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          onClose(values)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation() // alttaki çekmece de kapanmasın
          onClose(null)
        }}
      >
        <h3>{dialog.title}</h3>
        {dialog.message && <p className="modal-message">{dialog.message}</p>}
        {dialog.fields.map((f, i) => (
          <label className="field" key={i}>
            <span>{f.label}</span>
            <input
              ref={i === 0 ? first : undefined}
              type={f.secret ? 'password' : 'text'}
              value={values[i]}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </label>
        ))}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => onClose(null)}>
            İptal
          </button>
          <button ref={okBtn} type="submit" className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}>
            {dialog.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

// --- Sağdan açılan düzenleme paneli ---

export function Drawer({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title: string
  onClose(): void
  children: ReactNode
  footer: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer ${wide ? 'drawer-wide' : ''}`}>
        <header className="drawer-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Kapat">
            <Icon name="x" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        <footer className="drawer-footer">{footer}</footer>
      </aside>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}
