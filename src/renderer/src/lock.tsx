import { ReactNode, useEffect, useRef, useState } from 'react'
import type { LockState } from '@shared/types'
import { api, errMsg } from './api'
import { DaemonttyLogo } from './components/DaemonttyLogo'
import { Icon } from './components/Icon'

/** Pencere düzeyindeki kısayol dinleyicileri kilitliyken çalışmasın diye bakılan bayrak. */
export const lockFlag = { locked: false }

export function useLockState(): LockState | null {
  const [st, setSt] = useState<LockState | null>(null)
  useEffect(() => {
    api.lock.state().then(setSt)
    return api.lock.onChange(setSt)
  }, [])
  return st
}

/**
 * Uygulamayı sarar. Açılışta kasa parola bekliyorsa içerik hiç kurulmaz (veri zaten okunamaz).
 * Sonradan kilitlenirse içerik yerinde kalır (oturumlar kopmasın) ama `inert` ile dondurulur.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const st = useLockState()
  const [mounted, setMounted] = useState(false)
  lockFlag.locked = !!st?.locked
  useEffect(() => {
    if (st && !st.locked) setMounted(true)
  }, [st])
  if (!st) return null
  return (
    <>
      {mounted && (
        <div style={{ display: 'contents' }} inert={st.locked}>
          {children}
        </div>
      )}
      {st.locked && <LockScreen touchId={st.touchId} />}
    </>
  )
}

function LockScreen({ touchId }: { touchId: boolean }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const viaTouchId = async (): Promise<void> => {
    if (!(await api.lock.touchId())) input.current?.focus()
  }

  useEffect(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    input.current?.focus()
    if (touchId) viaTouchId()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      if (!(await api.lock.unlock(password))) {
        setError('Parola hatalı')
        setPassword('')
        input.current?.focus()
      }
    } catch (err) {
      setError(errMsg(err))
    }
    setBusy(false)
  }

  return (
    <div className="lock-screen" onKeyDown={(e) => e.stopPropagation()}>
      <form className="lock-card" onSubmit={submit}>
        <DaemonttyLogo size={52} />
        <h2>Daemontty kilitli</h2>
        <p className="muted small">Devam etmek için ana parolanızı girin. Açık oturumlarınız arka planda çalışmaya devam ediyor.</p>
        <input
          ref={input}
          type="password"
          placeholder="Ana parola"
          value={password}
          autoComplete="off"
          onChange={(e) => setPassword(e.target.value)}
          className={error ? 'lock-input-err' : ''}
        />
        {error && <span className="text-danger small">{error}</span>}
        <button className="btn btn-primary" type="submit" disabled={!password || busy}>
          <Icon name="lock" /> {busy ? 'Açılıyor…' : 'Kilidi aç'}
        </button>
        {touchId && (
          <button className="btn" type="button" onClick={viaTouchId}>
            Touch ID ile aç
          </button>
        )}
      </form>
    </div>
  )
}
