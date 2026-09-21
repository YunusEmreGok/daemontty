import type { CSSProperties, ReactNode } from 'react'
import type { CursorStyle, TerminalTheme } from '@shared/types'
import { ANSI_KEYS } from '../themes'

interface Props {
  theme: TerminalTheme
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  cursorStyle?: CursorStyle
  padding?: number
  /** Küçük kart önizlemesi */
  mini?: boolean
}

/** Gerçek bir terminal açmadan temanın nasıl görüneceğini gösteren statik önizleme. */
export function TerminalPreview({
  theme: th,
  fontFamily,
  fontSize = 13,
  lineHeight = 1.25,
  letterSpacing = 0,
  cursorStyle = 'block',
  padding = 12,
  mini
}: Props) {
  const c = (color: string, children: ReactNode, bold = false) => (
    <span style={{ color, fontWeight: bold ? 700 : undefined }}>{children}</span>
  )
  const prompt = (
    <>
      {c(th.green, 'yunus@sunucu', true)}
      {c(th.foreground, ':')}
      {c(th.blue, '~/projeler', true)}
      {c(th.foreground, '$ ')}
    </>
  )
  const cursorCss: CSSProperties =
    cursorStyle === 'block'
      ? { background: th.cursor, width: '0.6em' }
      : cursorStyle === 'bar'
        ? { borderLeft: `2px solid ${th.cursor}`, width: 0 }
        : { borderBottom: `2px solid ${th.cursor}`, width: '0.6em' }

  const style: CSSProperties = {
    background: th.background,
    color: th.foreground,
    fontFamily,
    fontSize: mini ? 10 : fontSize,
    lineHeight: mini ? 1.35 : lineHeight,
    letterSpacing: mini ? 0 : letterSpacing,
    padding: mini ? 10 : padding
  }

  return (
    <div className={`term-preview ${mini ? 'term-preview-mini' : ''}`} style={style}>
      <div>
        {prompt}
        {c(th.foreground, 'ls -la')}
      </div>
      <div>
        {c(th.foreground, 'drwxr-xr-x ')}
        {c(th.blue, 'uygulama/', true)}
      </div>
      <div>
        {c(th.foreground, '-rwxr-xr-x ')}
        {c(th.green, 'yedekle.sh', true)}
      </div>
      {!mini && (
        <>
          <div>
            {c(th.foreground, 'lrwxrwxrwx ')}
            {c(th.cyan, 'güncel', true)}
            {c(th.foreground, ' -> /srv/sürüm-2')}
          </div>
          <div>
            {prompt}
            {c(th.foreground, 'git status')}
          </div>
          <div>{c(th.foreground, "Dal 'main' üzerinde")}</div>
          <div>
            {c(th.red, '  değiştirildi: ')}
            {c(th.red, 'ayarlar.ts')}
          </div>
          <div>
            {c(th.green, '  yeni dosya:   ')}
            {c(th.green, 'tema.ts')}
          </div>
          <div>
            {c(th.yellow, 'uyarı: ')}
            {c(th.foreground, 'disk %82 dolu · ')}
            {c(th.magenta, 'şimdi temizle?')}
          </div>
          <div>
            <span style={{ background: th.selection }}>seçili metin örneği</span> {c(th.brightBlack, '# yorum satırı')}
          </div>
        </>
      )}
      <div>
        {prompt}
        <span className="term-preview-cursor" style={cursorCss}>
          &nbsp;
        </span>
      </div>
      <div className="term-preview-swatches">
        {ANSI_KEYS.map((k) => (
          <span key={k} style={{ background: th[k] }} title={k} />
        ))}
      </div>
    </div>
  )
}
