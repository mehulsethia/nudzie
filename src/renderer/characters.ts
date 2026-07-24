// The character registry - the walk-in companion shown by the corner-walk overlay.
// Each character is an idle/action sprite pair (produced by `npm run prepare-assets`)
// plus a small bit of metadata. The free tier ships three base identities (one per
// gender); the Pro build adds novelty characters + the user's own custom one, gated
// by the license in the main process (see src/main/license.ts and PRO-TIER.md).
// Shared by the overlay (rendering) and settings (the character picker).
//
// To add a character: drop raw art in assets/raw/<id>/{idle,action}.png, run
// `npm run prepare-assets -- <id>`, then add an entry here importing the output.
import maleIdle from './overlay/characters/male/idle.png'
import maleAction from './overlay/characters/male/action.png'
import femaleIdle from './overlay/characters/female/idle.png'
import femaleAction from './overlay/characters/female/action.png'
import androgynousIdle from './overlay/characters/androgynous/idle.png'
import androgynousAction from './overlay/characters/androgynous/action.png'

export type Character = {
  id: string
  name: string
  free: boolean
  idle: string // idle pose sprite URL (bundled by Vite)
  action: string // action pose sprite URL (celebration / "doing the thing")
}

// The default identity (also drives the tray/app icon in scripts/prepare-assets.cjs).
export const DEFAULT_CHARACTER = 'androgynous'

export const CHARACTERS: Character[] = [
  { id: 'male', name: 'Male', free: true, idle: maleIdle, action: maleAction },
  { id: 'female', name: 'Female', free: true, idle: femaleIdle, action: femaleAction },
  { id: 'androgynous', name: 'Androgynous', free: true, idle: androgynousIdle, action: androgynousAction }
  // --- Pro novelty characters get added here (with free: false) ---
]

export function characterById(id: string | undefined): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]
}
