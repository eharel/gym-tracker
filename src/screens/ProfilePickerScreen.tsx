import { useState } from 'react'
import { useProfileStore } from '../store/profile'

/** "Who's training?" — shown until this device has a selected profile.
 *  Replaced by a real login screen when accounts land. */
export default function ProfilePickerScreen() {
  const profiles = useProfileStore(s => s.profiles)
  const select = useProfileStore(s => s.select)
  const addProfile = useProfileStore(s => s.addProfile)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  // Full reload from the home screen: flushes all per-profile in-memory
  // state and never strands the new profile on another profile's route.
  function enterAs(id: string) {
    select(id)
    window.location.assign('/')
  }

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const p = await addProfile(trimmed)
      enterAs(p.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xs flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-ink">Who's training?</h1>
          <p className="text-sm text-ink-secondary mt-1">Pick your profile to continue</p>
        </div>

        <div className="flex flex-col gap-2.5">
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => enterAs(p.id)}
              className="bg-surface/80 border border-edge rounded-2xl px-5 py-4 flex items-center gap-3 text-left active:opacity-70 shadow-card"
            >
              <div className="w-10 h-10 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
                <span className="text-accent font-bold">{p.name.charAt(0).toUpperCase()}</span>
              </div>
              <span className="font-semibold text-ink text-base">{p.name}</span>
            </button>
          ))}
        </div>

        {adding ? (
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="Name"
              className="flex-1 bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-disabled outline-none focus:border-accent transition-colors"
            />
            <button
              onClick={handleAdd}
              disabled={!name.trim() || saving}
              className="bg-accent text-on-accent font-semibold text-sm rounded-xl px-4 disabled:opacity-40 active:opacity-80"
            >
              {saving ? '…' : 'Add'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-sm text-ink-secondary underline underline-offset-4 active:opacity-70 mx-auto"
          >
            Add a profile
          </button>
        )}
      </div>
    </div>
  )
}
