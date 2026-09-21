import type { ITheme } from '@xterm/xterm'
import type { Host, Settings, TerminalTheme } from '@shared/types'

type Palette = Omit<TerminalTheme, 'id' | 'name' | 'light'>

// Sıra: black red green yellow blue magenta cyan white, sonra parlak (bright) tonlar.
function t(id: string, name: string, bg: string, fg: string, cursor: string, selection: string, ansi: string[], light = false): TerminalTheme {
  const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const
  const pal = {} as Record<string, string>
  keys.forEach((k, i) => {
    pal[k] = ansi[i]
    pal['bright' + k[0].toUpperCase() + k.slice(1)] = ansi[i + 8]
  })
  return { ...(pal as unknown as Palette), id, name, light, background: bg, foreground: fg, cursor, selection }
}

export const BUILTIN_THEMES: TerminalTheme[] = [
  t('kabuk', 'Kabuk', '#0f1117', '#d8dbe4', '#22c3a6', '#2e5a6b', [
    '#1b1e28', '#ef5d6c', '#6fcf8a', '#f2c35b', '#5c9dff', '#c580f2', '#3fd0c9', '#d8dbe4',
    '#5a6072', '#ff7a88', '#8ee6a6', '#ffd67a', '#80b4ff', '#d9a3ff', '#6ee6df', '#ffffff'
  ]),
  t('tokyo-night', 'Tokyo Gecesi', '#1a1b26', '#c0caf5', '#c0caf5', '#33467c', [
    '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
    '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'
  ]),
  t('dracula', 'Dracula', '#282a36', '#f8f8f2', '#f8f8f2', '#44475a', [
    '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
    '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'
  ]),
  t('catppuccin', 'Catppuccin Mocha', '#1e1e2e', '#cdd6f4', '#f5e0dc', '#45475a', [
    '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
    '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'
  ]),
  t('nord', 'Nord', '#2e3440', '#d8dee9', '#d8dee9', '#434c5e', [
    '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
    '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'
  ]),
  t('one-dark', 'One Dark', '#282c34', '#abb2bf', '#528bff', '#3e4451', [
    '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
    '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'
  ]),
  t('gruvbox', 'Gruvbox', '#282828', '#ebdbb2', '#ebdbb2', '#504945', [
    '#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
    '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'
  ]),
  t('monokai', 'Monokai', '#272822', '#f8f8f2', '#f8f8f0', '#49483e', [
    '#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2',
    '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'
  ]),
  t('rose-pine', 'Rosé Pine', '#191724', '#e0def4', '#e0def4', '#403d52', [
    '#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
    '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'
  ]),
  t('solarized-dark', 'Solarized Koyu', '#002b36', '#839496', '#93a1a1', '#073642', [
    '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
    '#586e75', '#cb4b16', '#93a1a1', '#b58900', '#839496', '#6c71c4', '#2aa198', '#fdf6e3'
  ]),
  t('fosfor', 'Fosfor (Retro)', '#0a100b', '#41ff78', '#41ff78', '#1d4a2a', [
    '#0a100b', '#ff5f56', '#41ff78', '#d5ff41', '#38c9a0', '#7dff9f', '#62ffd0', '#b8ffcb',
    '#2a5a36', '#ff8a80', '#7dffa4', '#eaff80', '#6fe0bf', '#a8ffbf', '#98ffe2', '#e6fff0'
  ]),
  t('solarized-light', 'Solarized Açık', '#fdf6e3', '#586e75', '#586e75', '#eee8d5', [
    '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#93a1a1',
    '#586e75', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#2aa198', '#073642'
  ], true),
  t('github-light', 'GitHub Açık', '#ffffff', '#24292f', '#0969da', '#b6d7ff', [
    '#24292f', '#cf222e', '#116329', '#9a6700', '#0969da', '#8250df', '#1b7c83', '#6e7781',
    '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f'
  ], true)
]

export const COLOR_KEYS: Array<{ key: keyof Palette; label: string }> = [
  { key: 'background', label: 'Arka plan' },
  { key: 'foreground', label: 'Yazı' },
  { key: 'cursor', label: 'İmleç' },
  { key: 'selection', label: 'Seçim' },
  { key: 'black', label: 'Siyah' },
  { key: 'red', label: 'Kırmızı' },
  { key: 'green', label: 'Yeşil' },
  { key: 'yellow', label: 'Sarı' },
  { key: 'blue', label: 'Mavi' },
  { key: 'magenta', label: 'Mor' },
  { key: 'cyan', label: 'Camgöbeği' },
  { key: 'white', label: 'Beyaz' },
  { key: 'brightBlack', label: 'Parlak siyah' },
  { key: 'brightRed', label: 'Parlak kırmızı' },
  { key: 'brightGreen', label: 'Parlak yeşil' },
  { key: 'brightYellow', label: 'Parlak sarı' },
  { key: 'brightBlue', label: 'Parlak mavi' },
  { key: 'brightMagenta', label: 'Parlak mor' },
  { key: 'brightCyan', label: 'Parlak camgöbeği' },
  { key: 'brightWhite', label: 'Parlak beyaz' }
]

export const ANSI_KEYS = COLOR_KEYS.slice(4).map((c) => c.key)

export function allThemes(settings: Settings): TerminalTheme[] {
  return [...BUILTIN_THEMES, ...settings.customThemes]
}

export function findTheme(settings: Settings, id?: string): TerminalTheme {
  const list = allThemes(settings)
  return list.find((x) => x.id === id) ?? list.find((x) => x.id === settings.themeId) ?? BUILTIN_THEMES[0]
}

export function themeForHost(settings: Settings, host?: Host): TerminalTheme {
  return findTheme(settings, host?.themeId || settings.themeId)
}

export function toXterm(th: TerminalTheme): ITheme {
  const { id: _i, name: _n, light: _l, selection, ...rest } = th
  return { ...rest, cursorAccent: th.background, selectionBackground: selection + 'cc' }
}

export const isBuiltin = (id: string): boolean => BUILTIN_THEMES.some((x) => x.id === id)

// --- Yazı tipleri ---

export const FONT_CHOICES: Array<{ label: string; family: string; bundled?: boolean }> = [
  { label: 'JetBrains Mono', family: '"JetBrains Mono"', bundled: true },
  { label: 'Fira Code', family: '"Fira Code"', bundled: true },
  { label: 'SF Mono', family: '"SF Mono"' },
  { label: 'Menlo', family: 'Menlo' },
  { label: 'Monaco', family: 'Monaco' },
  { label: 'Cascadia Code', family: '"Cascadia Code"' },
  { label: 'Consolas', family: 'Consolas' },
  { label: 'Ubuntu Mono', family: '"Ubuntu Mono"' },
  { label: 'Source Code Pro', family: '"Source Code Pro"' },
  { label: 'Hack', family: 'Hack' }
]

const FALLBACK = 'Menlo, Monaco, Consolas, "DejaVu Sans Mono", monospace'

export function fontStack(family: string): string {
  return `${family}, ${FALLBACK}`
}

/** Ayardaki yazı tipi listesinin ilk öğesi (seçim kutusunda göstermek için). */
export function primaryFont(fontFamily: string): string {
  return fontFamily.split(',')[0].trim()
}

/** Tarayıcıdaki yazı tipinin yüklenmesini bekler; xterm doğru karakter genişliğini ölçsün. */
export async function ensureFont(fontFamily: string, size: number): Promise<void> {
  const first = primaryFont(fontFamily)
  try {
    await Promise.all([document.fonts.load(`${size}px ${first}`), document.fonts.load(`bold ${size}px ${first}`)])
  } catch {
    /* sistem yazı tipi ya da bulunamadı: yedek kullanılır */
  }
}
