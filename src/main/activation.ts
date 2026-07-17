let suppressSettingsUntil = 0

export function suppressSettingsActivation(ms = 5000): void {
  suppressSettingsUntil = Math.max(suppressSettingsUntil, Date.now() + ms)
}

export function shouldOpenSettingsOnActivate(hasVisibleWindows: boolean): boolean {
  if (hasVisibleWindows) return false
  if (Date.now() < suppressSettingsUntil) return false
  return true
}
