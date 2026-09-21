import type { Terminal } from '@xterm/xterm'

export interface LineState {
  /** İstemden sonra yazılmış komut satırı (ekranda görüldüğü haliyle) */
  input: string
  /** Aynı satırdaki istem (prompt) metni */
  prompt: string
  /** İmleç satırın sonunda mı */
  atEnd: boolean
  /** Girdinin başladığı sütun ve imleç satırı (ekran koordinatı) */
  anchorCol: number
  cursorRow: number
  cursorCol: number
}

/**
 * Uzak kabuğun komut satırını ekrandan okur.
 *
 * Kullanıcı istemde ilk tuşa bastığında imlecin yeri "çapa" olarak alınır; o noktadan
 * satır sonuna kadar ekranda görünen metin girdidir. Tuş vuruşlarını değil ekranı
 * okuduğumuz için kabuğun kendi Tab tamamlaması ve geçmiş gezintisi de doğru yansır.
 * Parolalar ekrana yansımadığından hiçbir zaman girdi olarak görülmez.
 */
export class InputTracker {
  private anchor: { x: number; y: number } | null = null
  /** Enter'a basılmış ama satırın tamamı henüz ekrana yansımamış komut */
  private pending: { anchor: { x: number; y: number }; at: number } | null = null
  /** Son tuş yazı mıydı, yoksa gezinme (ok tuşları) mi? */
  lastKey: 'type' | 'nav' | null = null

  constructor(private term: Terminal) {}

  reset(): void {
    this.anchor = null
    this.lastKey = null
  }

  /** Kullanıcının terminale gönderdiği veriyi işler. */
  onUserData(d: string): void {
    const buf = this.term.buffer.active
    if (buf.type !== 'normal') {
      this.reset()
      return
    }
    if (d === '\r') {
      // Komutu hemen okumuyoruz: hızlı yazıldıysa son karakterler henüz sunucudan
      // yansımamış olabilir. Satır tamamlanınca poll() okuyacak.
      if (this.anchor) this.pending = { anchor: this.anchor, at: Date.now() }
      this.reset()
      return
    }
    // Ctrl+C, Ctrl+D, Ctrl+L ya da çok satırlı yapıştırma: satır bitti.
    if (d === '\x03' || d === '\x04' || d === '\x0c' || d.includes('\r')) {
      this.reset()
      return
    }
    if (!this.anchor) this.anchor = { x: buf.cursorX, y: buf.baseY + buf.cursorY }
    // Ok tuşları vb. kaçış dizileri gezinmedir; köşeli yapıştırma (\x1b[200~) ise yazı sayılır.
    this.lastKey = d.startsWith('\x1b') && !d.startsWith('\x1b[200~') ? 'nav' : 'type'
  }

  /**
   * Enter sonrası imleç komut satırının altına indiyse (kabuk satırı işlemeye başladı)
   * çalıştırılan komutu döndürür. Ekran çıktısı geldikçe çağrılır.
   */
  poll(): string | undefined {
    const p = this.pending
    if (!p) return undefined
    const buf = this.term.buffer.active
    if (buf.type !== 'normal') {
      this.pending = null
      return undefined
    }
    let y = p.anchor.y
    while (buf.getLine(y + 1)?.isWrapped) y++
    const cursorAbs = buf.baseY + buf.cursorY
    if (cursorAbs <= y && Date.now() - p.at < 1500) return undefined
    this.pending = null
    this.fixPromptAnchor(p.anchor)
    let text = ''
    for (let row = p.anchor.y; row <= y; row++) {
      const line = buf.getLine(row)
      if (!line) return undefined
      text += line.translateToString(row === y, row === p.anchor.y ? p.anchor.x : 0)
    }
    return text.trim() || undefined
  }

  /**
   * Tuşa istem (prompt) ekrana gelmeden basıldıysa çapa 0. sütunda kalır; satır bir istemle
   * başlıyorsa çapayı istemin sonuna taşı.
   */
  private fixPromptAnchor(a: { x: number; y: number }): void {
    if (a.x !== 0) return
    const text = this.term.buffer.active.getLine(a.y)?.translateToString(true) ?? ''
    const m = text.match(/^\S{0,80}?[\w\]~)/:][$#%>❯] /)
    if (m) a.x = m[0].length
  }

  read(): LineState | null {
    const buf = this.term.buffer.active
    const a = this.anchor
    if (!a || buf.type !== 'normal') return null
    const cursorAbs = buf.baseY + buf.cursorY
    if (cursorAbs < a.y) {
      this.anchor = null // ekran temizlendi
      return null
    }
    this.fixPromptAnchor(a)
    const first = buf.getLine(a.y)
    if (!first) return null

    // Çapa satırı ve ardından gelen sarılmış (wrapped) satırlar tek bir girdi satırıdır.
    let y = a.y
    while (buf.getLine(y + 1)?.isWrapped) y++
    if (cursorAbs > y) {
      // İmleç girdinin altına inmiş: çıktı gelmiş, girdi artık geçerli değil.
      this.anchor = null
      return null
    }

    let input = ''
    for (let row = a.y; row <= y; row++) {
      const line = buf.getLine(row)!
      const start = row === a.y ? a.x : 0
      if (row < y) {
        input += line.translateToString(false, start)
      } else {
        // Son satırda sağdaki boşlukları at, ama imlece kadar olan boşlukları koru ("cd " gibi).
        const trimmedLen = line.translateToString(true).length
        const end = Math.max(trimmedLen, row === cursorAbs ? buf.cursorX : 0)
        input += end > start ? line.translateToString(false, start, end) : ''
      }
    }

    const lastLen = buf.getLine(y)!.translateToString(true).length
    const endCol = Math.max(lastLen, y === a.y ? a.x : 0)
    return {
      input,
      prompt: first.translateToString(true, 0, a.x),
      atEnd: cursorAbs === y && buf.cursorX >= endCol,
      anchorCol: y === a.y ? a.x : 0,
      cursorRow: buf.cursorY,
      cursorCol: buf.cursorX
    }
  }
}
