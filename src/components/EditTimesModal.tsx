import { useState } from 'react'
import { updateSessionTimes } from '../lib/db'

// Convert an ISO string to the "YYYY-MM-DDTHH:MM" format datetime-local expects
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Convert a datetime-local input value back to an ISO string (local time → UTC)
function fromLocalInput(value: string): string {
  return new Date(value).toISOString()
}

export default function EditTimesModal({
  sessionId,
  startedAt,
  completedAt,
  onSave,
  onClose,
}: {
  sessionId: string
  startedAt: string
  completedAt: string | null
  onSave: (startedAt: string, completedAt: string | null) => void
  onClose: () => void
}) {
  const [startVal, setStartVal] = useState(toLocalInput(startedAt))
  const [endVal, setEndVal]     = useState(completedAt ? toLocalInput(completedAt) : '')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  async function handleSave() {
    const startIso = fromLocalInput(startVal)
    const endIso   = endVal ? fromLocalInput(endVal) : null

    if (endIso && new Date(endIso) <= new Date(startIso)) {
      setErr('End time must be after start time')
      return
    }

    setSaving(true)
    try {
      await updateSessionTimes(sessionId, startIso, endIso)
      onSave(startIso, endIso)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-md bg-surface border border-edge rounded-2xl p-5 flex flex-col gap-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">Edit workout time</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-disabled hover:text-ink active:opacity-70">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-secondary uppercase tracking-wide">Started</span>
            <input
              type="datetime-local"
              value={startVal}
              onChange={e => setStartVal(e.target.value)}
              className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-secondary uppercase tracking-wide">Finished</span>
            <input
              type="datetime-local"
              value={endVal}
              onChange={e => setEndVal(e.target.value)}
              className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
            />
          </label>
        </div>

        {err && <p className="text-xs text-negative">{err}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 bg-elevated border border-edge text-ink-secondary font-medium rounded-xl py-3 text-sm active:opacity-70"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !startVal}
            className="flex-1 bg-accent text-on-accent font-semibold rounded-xl py-3 text-sm active:opacity-80 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
