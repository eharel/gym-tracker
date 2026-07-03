import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

// Which profile this device acts as. This module is the app's identity
// context: db functions read the current profile id from here instead of
// taking it as a parameter — the same shape as real auth, where the Supabase
// session carries identity implicitly. When accounts land, this store is
// replaced by supabase.auth and RLS, not rewritten around.

const STORAGE_KEY = 'gym-tracker.profileId'

interface ProfileState {
  profiles: Profile[]
  currentProfileId: string | null
  loaded: boolean
  load: () => Promise<void>
  select: (id: string) => void
  addProfile: (name: string) => Promise<Profile>
  switchProfile: () => void
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  currentProfileId: null,
  loaded: false,

  async load() {
    if (get().loaded) return
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')
    if (error) throw error
    const profiles: Profile[] = data ?? []

    // Restore the device's remembered choice; drop it if the profile is gone
    const stored = localStorage.getItem(STORAGE_KEY)
    const valid = stored && profiles.some(p => p.id === stored) ? stored : null
    // Single-profile household: skip the picker entirely
    const auto = valid ?? (profiles.length === 1 ? profiles[0].id : null)
    if (auto && auto !== stored) localStorage.setItem(STORAGE_KEY, auto)

    set({ profiles, currentProfileId: auto, loaded: true })
  },

  select(id) {
    localStorage.setItem(STORAGE_KEY, id)
    set({ currentProfileId: id })
  },

  async addProfile(name) {
    const { data, error } = await supabase
      .from('profiles')
      .insert({ name })
      .select()
      .single()
    if (error) throw error
    set(s => ({ profiles: [...s.profiles, data] }))
    return data
  },

  switchProfile() {
    localStorage.removeItem(STORAGE_KEY)
    set({ currentProfileId: null })
  },
}))

/** Current profile id for non-hook contexts (db layer). Throws when unset —
 *  callers run behind the profile gate, so this firing means a logic bug. */
export function requireProfileId(): string {
  const id = useProfileStore.getState().currentProfileId
  if (!id) throw new Error('No profile selected')
  return id
}
