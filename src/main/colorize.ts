import { ClientChannel } from 'ssh2'
import { Connection } from './connection'

// Debian/Ubuntu'da root'un .bashrc'si renkli istemi ve ls renklerini kapalı getirir; terminal
// renkleri destekler ama sunucu göndermez. Bağlanınca, o oturumla sınırlı kalmak üzere kabuğa
// tek satır göndeririz. Sunucudaki dosyalara dokunulmaz.
//
// Güvenlik ağları:
// - Yalnızca giriş kabuğu bash/zsh ise gönderilir (ağ cihazlarının CLI'sine komut yazmamak için).
// - İstem zaten renk/kaçış kodu içeriyorsa (Ubuntu kullanıcıları, starship, oh-my-zsh…) dokunulmaz.
// - ls/grep için takma ad zaten varsa ya da `ls --color` desteklenmiyorsa (eski BSD) eklenmez.

const START = ': DTTY;'
const END = 'DTTY_OK'
const TIMEOUT_MS = 4000

const BASH_PS1 = String.raw`\[\e[1;32m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ `
const ZSH_PROMPT = '%B%F{green}%n@%m%f%b:%B%F{blue}%~%f%b%# '
// CLICOLOR: macOS/BSD ls, --color=auto verilse bile bu olmadan renk üretmez; Linux'ta etkisizdir.
const ALIASES =
  'export CLICOLOR=1; ' +
  "ls --color=auto -d / >/dev/null 2>&1 && { alias ls >/dev/null 2>&1 || alias ls='ls --color=auto'; }; " +
  "alias grep >/dev/null 2>&1 || alias grep='grep --color=auto'"

// Baştaki boşluk: bash'te (HISTCONTROL=ignorespace) satır geçmişe yazılmaz.
// Sondaki printf tırnakla bölünmüştür ki satırın kendi yankısı bitiş işaretini içermesin.
export const COLORIZE_LINE =
  ` ${START} if [ -n "$BASH_VERSION" ]; then case "$PS1" in ` +
  String.raw`*\\\[*|*\\e*|*\\0*) ;; *) PS1='${BASH_PS1}';; esac; ${ALIASES}; ` +
  `elif [ -n "$ZSH_VERSION" ] && [ -z "$ZSH" ]; then case "$PROMPT" in *%F*|*%{*) ;; *) PROMPT='${ZSH_PROMPT}';; esac; ${ALIASES}; fi; ` +
  `printf 'DTTY''_OK'\n`

function loginShell(conn: Connection): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), 3000)
    conn.client.exec('echo "$SHELL"', (err, ch) => {
      if (err) return resolve('')
      let out = ''
      ch.on('data', (d: Buffer) => (out += d.toString()))
      ch.stderr.on('data', () => {})
      ch.on('close', () => {
        clearTimeout(timer)
        resolve(out.trim())
      })
    })
  })
}

/**
 * Satırı gönderir ve kabuğun onu yankılamasını çıktıdan süzer: kullanıcı yalnızca yeni (renkli)
 * istemi görür, MOTD gibi önceki çıktı korunur. `emit` süzülmüş veriyi arayüze iletir.
 * İşaretler görülmezse (ör. yankıyı boyayan bir zsh eklentisi) süzmeyi bırakır; hiçbir veri kaybolmaz.
 * `install`, kabuktan gelen verinin bundan sonra geçeceği süzgeci yerleştirir. Süzme bitince döner.
 */
export async function colorize(conn: Connection, stream: ClientChannel, emit: (d: Buffer) => void, install: (filter: (d: Buffer) => void) => void): Promise<void> {
  if (!/\/(ba|z)sh$/.test(await loginShell(conn))) return

  let mode: 'start' | 'end' | 'pass' = 'start'
  let held = ''
  let done: () => void = () => {}
  const finished = new Promise<void>((r) => (done = r))
  const pass = (): void => {
    if (mode === 'pass') return
    mode = 'pass'
    if (held) emit(Buffer.from(held, 'latin1'))
    held = ''
    done()
  }
  const timer = setTimeout(pass, TIMEOUT_MS)

  // latin1: baytları bire bir korur; işaretler ASCII olduğu için UTF-8 verinin ortasında da güvenle aranır.
  const filter = (d: Buffer): void => {
    if (mode === 'pass') return emit(d)
    held += d.toString('latin1')
    if (mode === 'start') {
      const i = held.indexOf(START)
      if (i < 0) {
        // Parça sınırında bölünmüş işareti kaçırmamak için son birkaç baytı tut, gerisini ilet.
        const keep = START.length - 1
        if (held.length > keep) {
          emit(Buffer.from(held.slice(0, -keep), 'latin1'))
          held = held.slice(-keep)
        }
        return
      }
      emit(Buffer.from(held.slice(0, i), 'latin1'))
      held = held.slice(i)
      mode = 'end'
    }
    const j = held.indexOf(END)
    if (j < 0) return
    clearTimeout(timer)
    const rest = held.slice(j + END.length)
    held = ''
    mode = 'pass'
    // Eski (renksiz) istemin durduğu satırı sil; yeni istem aynı satıra gelir.
    emit(Buffer.from('\r\x1b[2K' + rest, 'latin1'))
    done()
  }

  install(filter)
  stream.write(COLORIZE_LINE)
  await finished
}
