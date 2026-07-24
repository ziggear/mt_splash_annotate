/** Keyboard frame navigation helpers (038 WP-G). */

function isEditableTarget(target?: { tagName?: string } | null): boolean {
  const tag = target?.tagName?.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function frameNavKeyDelta(
  key: string,
  target?: { tagName?: string } | null,
): number {
  if (isEditableTarget(target)) return 0
  if (key === 'ArrowLeft') return -1
  if (key === 'ArrowRight') return 1
  return 0
}

export function shouldToggleFrameSelection(
  key: string,
  target?: { tagName?: string } | null,
): boolean {
  if (isEditableTarget(target)) return false
  return key === ' ' || key === 'Spacebar'
}

function hasModifierShortcut(modifiers?: {
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}): boolean {
  return Boolean(modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.altKey)
}

export function shouldSaveAnnotation(
  key: string,
  target?: { tagName?: string } | null,
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): boolean {
  if (isEditableTarget(target)) return false
  if (hasModifierShortcut(modifiers)) return false
  return key === 's'
}

export function shouldClearFrameSelection(
  key: string,
  target?: { tagName?: string } | null,
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): boolean {
  if (isEditableTarget(target)) return false
  if (hasModifierShortcut(modifiers)) return false
  return key === 'c'
}

export function shouldToggleSplashProperty(
  key: string,
  target?: { tagName?: string } | null,
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): boolean {
  if (isEditableTarget(target)) return false
  if (hasModifierShortcut(modifiers)) return false
  return key.toLowerCase() === 'w'
}

export function shouldToggleAthleteProperty(
  key: string,
  target?: { tagName?: string } | null,
  modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): boolean {
  if (isEditableTarget(target)) return false
  if (hasModifierShortcut(modifiers)) return false
  return key.toLowerCase() === 'a'
}
