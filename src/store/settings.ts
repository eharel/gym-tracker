import { create } from 'zustand'
import { getUserSettings, upsertUserSettings } from '../lib/db'
import type { UnitSystem, UserSettings } from '../types'

interface SettingsState {
  settings: UserSettings | null
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Pick<UserSettings, 'unit_system'>>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loaded: false,

  async load() {
    if (get().loaded) return
    const s = await getUserSettings()
    set({ settings: s, loaded: true })
  },

  async update(patch) {
    const updated = await upsertUserSettings(patch)
    set({ settings: updated })
  },
}))

export function getUnitSystem(): UnitSystem {
  return useSettingsStore.getState().settings?.unit_system ?? 'imperial'
}
