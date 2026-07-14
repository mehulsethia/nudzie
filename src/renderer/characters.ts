// The character registry — the walk-in companion shown by the corner-walk overlay.
// Each character is an idle/action sprite pair (produced by `npm run prepare-assets`)
// plus a small bit of metadata. This open-source build ships only the one free
// "Buddy" character; the Pro build adds more on top, gated by the license in the
// main process (see src/main/license.ts and PRO-TIER.md). Shared by the overlay
// (rendering) and settings (the character picker).
//
// To add a character: drop raw art in assets/raw/<id>/{idle,action}.png, run
// `npm run prepare-assets -- <id>`, then add an entry here importing the output.
import buddyIdle from './overlay/characters/buddy/idle.png'
import buddyAction from './overlay/characters/buddy/action.png'

export type Character = {
  id: string
  name: string
  free: boolean
  idle: string // idle pose sprite URL (bundled by Vite)
  action: string // action pose sprite URL (celebration / "doing the thing")
}

export const CHARACTERS: Character[] = [
  { id: 'buddy', name: 'Buddy', free: true, idle: buddyIdle, action: buddyAction }
  // --- Pro characters get added here (with their own sprite imports) ---
  // { id: 'sprout', name: 'Sprout', free: false, idle: sproutIdle, action: sproutAction },
]

export function characterById(id: string | undefined): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]
}
