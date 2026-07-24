// Personalization registry for the reminder bubble: colour theme, message font,
// and sound. Shared by the settings picker (renderer) and the overlay renderer.
// Themes, non-system fonts, and sounds are Pro-gated in the main process (see
// src/main/windows/overlay.ts). Keep free flags aligned with that gate.

export type BubbleTheme = {
  id: string
  name: string
  free: boolean
  bg: string // bubble background
  ink: string // bubble text/border-contrast colour
  tail: string // tail fill (usually === bg)
}

export const BUBBLE_THEMES: BubbleTheme[] = [
  { id: 'cream', name: 'White', free: true, bg: '#fdfdf7', ink: '#1b1a2e', tail: '#fdfdf7' },
  { id: 'grape', name: 'Grape', free: false, bg: '#6b5ff0', ink: '#ffffff', tail: '#6b5ff0' },
  { id: 'midnight', name: 'Midnight', free: false, bg: '#232a44', ink: '#eaf0ff', tail: '#232a44' },
  { id: 'sunset', name: 'Sunset', free: false, bg: '#ffb27a', ink: '#3a1f12', tail: '#ffb27a' },
  { id: 'mint', name: 'Mint', free: false, bg: '#bfe9cc', ink: '#123322', tail: '#bfe9cc' },
  { id: 'bubblegum', name: 'Bubblegum', free: false, bg: '#f5c4e6', ink: '#4a1440', tail: '#f5c4e6' },
  { id: 'lemon', name: 'Lemon', free: false, bg: '#fff1a8', ink: '#2f2a10', tail: '#fff1a8' },
  { id: 'cloud', name: 'Cloud', free: false, bg: '#e8e8ee', ink: '#252538', tail: '#e8e8ee' },
  { id: 'sky', name: 'Sky', free: false, bg: '#b9e3ff', ink: '#10283a', tail: '#b9e3ff' }
]

export type BubbleFont = { id: string; name: string; free: boolean; family: string }

export const BUBBLE_FONTS: BubbleFont[] = [
  { id: 'system', name: 'System', free: true, family: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif" },
  { id: 'mono', name: 'Mono', free: false, family: "ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace" },
  { id: 'rounded', name: 'Rounded', free: false, family: "ui-rounded,'SF Pro Rounded','Nunito','Segoe UI',system-ui,sans-serif" },
  { id: 'serif', name: 'Serif', free: false, family: "Georgia,'Iowan Old Style','Times New Roman',serif" },
  { id: 'condensed', name: 'Condensed', free: false, family: "'Avenir Next Condensed','Arial Narrow','Roboto Condensed',sans-serif" }
]

// Sounds. 'chime' is the bundled default; the rest are Pro-gated in the main
// process. 'custom' lets a Pro user upload their own (<= 5s).
export type SoundOption = { id: string; name: string; free: boolean; upload?: boolean }

export const SOUND_OPTIONS: SoundOption[] = [
  { id: 'chime', name: 'Default chime', free: true },
  { id: 'kalimba-pluck', name: 'Kalimba pluck', free: false },
  { id: 'pop', name: 'Pop', free: false },
  { id: 'sparkle', name: 'Sparkle', free: false },
  { id: 'steel-drum', name: 'Steel drum', free: false },
  { id: 'synth-blip', name: 'Synth blip', free: false },
  { id: 'zen-bowl', name: 'Zen bowl', free: false },
  { id: 'custom', name: 'Upload your own', free: false, upload: true }
]

export const APPEARANCE_DEFAULTS = { theme: 'cream', font: 'system', sound: 'chime' } as const

// Pro "custom bubble colour": bubbleTheme === 'custom' uses the bubbleColor hex.
export const CUSTOM_THEME_ID = 'custom'
export const CUSTOM_BUBBLE_DEFAULT = '#ffffff'

// Pick a readable ink (dark or light) for an arbitrary bubble background hex.
export function inkForBg(hex: string): string {
  const c = (hex || '').replace('#', '')
  const full = c.length === 3 ? c[0] + c[0] + c[1] + c[1] + c[2] + c[2] : c
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#1b1a2e' : '#ffffff'
}

export const themeById = (id: string | undefined): BubbleTheme =>
  BUBBLE_THEMES.find((t) => t.id === id) ?? BUBBLE_THEMES[0]

export const fontById = (id: string | undefined): BubbleFont =>
  BUBBLE_FONTS.find((f) => f.id === id) ?? BUBBLE_FONTS[0]
