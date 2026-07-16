// Personalization registry for the reminder bubble: colour theme, message font,
// and sound. Shared by the settings picker (renderer) and the overlay renderer.
// Free tier gets one default in each; the rest are Pro (gated in the main process,
// see src/main/windows/overlay.ts). Keep the free ids in sync there.

export type BubbleTheme = {
  id: string
  name: string
  free: boolean
  bg: string // bubble background
  ink: string // bubble text/border-contrast colour
  tail: string // tail fill (usually === bg)
}

export const BUBBLE_THEMES: BubbleTheme[] = [
  { id: 'cream', name: 'Cream', free: true, bg: '#fdfdf7', ink: '#1b1a2e', tail: '#fdfdf7' },
  { id: 'grape', name: 'Grape', free: false, bg: '#6b5ff0', ink: '#ffffff', tail: '#6b5ff0' },
  { id: 'midnight', name: 'Midnight', free: false, bg: '#232a44', ink: '#eaf0ff', tail: '#232a44' },
  { id: 'sunset', name: 'Sunset', free: false, bg: '#ffb27a', ink: '#3a1f12', tail: '#ffb27a' },
  { id: 'mint', name: 'Mint', free: false, bg: '#bfe9cc', ink: '#123322', tail: '#bfe9cc' },
  { id: 'bubblegum', name: 'Bubblegum', free: false, bg: '#f5c4e6', ink: '#4a1440', tail: '#f5c4e6' }
]

export type BubbleFont = { id: string; name: string; free: boolean; family: string }

export const BUBBLE_FONTS: BubbleFont[] = [
  { id: 'mono', name: 'Mono', free: true, family: "ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace" },
  { id: 'system', name: 'System', free: false, family: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif" },
  { id: 'rounded', name: 'Rounded', free: false, family: "ui-rounded,'SF Pro Rounded','Nunito','Segoe UI',system-ui,sans-serif" },
  { id: 'serif', name: 'Serif', free: false, family: "Georgia,'Iowan Old Style','Times New Roman',serif" },
  { id: 'condensed', name: 'Condensed', free: false, family: "'Avenir Next Condensed','Arial Narrow','Roboto Condensed',sans-serif" }
]

// Sounds. 'chime' is the bundled default; the middle ones are placeholders to fill
// with real audio later; 'custom' lets a Pro user upload their own (<= 5s).
export type SoundOption = { id: string; name: string; free: boolean; comingSoon?: boolean; upload?: boolean }

export const SOUND_OPTIONS: SoundOption[] = [
  { id: 'chime', name: 'Default chime', free: true },
  { id: 'sparkle', name: 'Sparkle', free: false, comingSoon: true },
  { id: 'bell', name: 'Soft bell', free: false, comingSoon: true },
  { id: 'pop', name: 'Pop', free: false, comingSoon: true },
  { id: 'custom', name: 'Upload your own', free: false, upload: true }
]

export const APPEARANCE_DEFAULTS = { theme: 'cream', font: 'mono', sound: 'chime' } as const

export const themeById = (id: string | undefined): BubbleTheme =>
  BUBBLE_THEMES.find((t) => t.id === id) ?? BUBBLE_THEMES[0]

export const fontById = (id: string | undefined): BubbleFont =>
  BUBBLE_FONTS.find((f) => f.id === id) ?? BUBBLE_FONTS[0]
