import { create } from 'zustand'
import { getUserSettings, upsertUserSettings } from '../lib/db'
import { useProfileStore } from './profile'
import type { UnitSystem, UserSettings } from '../types'

interface SettingsState {
  settings: UserSettings | null
  /** Which profile the settings were loaded for — reloads on switch. */
  loadedFor: string | null
  load: () => Promise<void>
  update: (patch: Partial<Pick<UserSettings, 'unit_system' | 'theme'>>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loadedFor: null,

  async load() {
    const profileId = useProfileStore.getState().currentProfileId
    if (!profileId || get().loadedFor === profileId) return
    const s = await getUserSettings()
    set({ settings: s, loadedFor: profileId })
  },

  async update(patch) {
    const updated = await upsertUserSettings(patch)
    set({ settings: updated })
  },
}))

export function getUnitSystem(): UnitSystem {
  return useSettingsStore.getState().settings?.unit_system ?? 'imperial'
}
