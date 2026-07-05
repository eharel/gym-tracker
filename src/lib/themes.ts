/**
 * Theme registry. Each id maps to a `:root[data-theme='<id>']` variable block
 * in index.css ('ember' is the default @theme, no block needed). Adding a
 * theme = one CSS block + one entry here.
 */
export const THEMES = [
  { id: 'ember', label: 'Ember' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'rose',  label: 'Rose' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME: ThemeId = 'ember'

export function applyTheme(theme: string) {
  if (theme === DEFAULT_THEME) {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = theme
  }
}
