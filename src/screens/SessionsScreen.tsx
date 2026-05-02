import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveProgram, getAllSessionsWithTemplate, discardSession, type SessionRow } from '../lib/db'



function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatDuration(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`
}

function SessionCard({
  session,
  onDelete,
  onNavigate,
}: {
  session: SessionRow
  onDelete: (id: string) => void
  onNavigate: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const duration = formatDuration(session.started_at, session.completed_at)
  const isSeed = session.started_at < '2026-04-15'

  async function handleDelete() {
    setDeleting(true)
    await onDelete(session.id)
  }

  return (
    <div className="bg-surface/80 border border-edge rounded-2xl px-4 py-3 flex items-center gap-3">
      {/* Tappable main area → session detail */}
      <button
        onClick={() => !confirming && onNavigate(session.id)}
        className="flex-1 min-w-0 text-left active:opacity-70"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink truncate">{session.template_name}</span>
          {!session.completed_at && (
            <span className="text-xs font-medium text-caution bg-caution/10 border border-caution/20 rounded px-1.5 py-0.5 shrink-0">
              In progress
            </span>
          )}
          {isSeed && (
            <span className="text-xs font-medium text-ink-disabled bg-elevated border border-edge rounded px-1.5 py-0.5 shrink-0">
              Seed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-ink-secondary">{formatDate(session.started_at)}</span>
          {duration && (
            <span className="text-xs text-ink-disabled">· {duration}</span>
          )}
        </div>
      </button>

      {confirming ? (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setConfirming(false)}
            className="text-xs text-ink-secondary px-2 py-1.5 rounded-lg bg-elevated border border-edge active:opacity-70"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs font-semibold text-white px-2 py-1.5 rounded-lg bg-negative/80 active:opacity-70 disabled:opacity-50"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-ink-disabled hover:text-negative active:opacity-70 transition-colors"
          aria-label="Delete session"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function SessionsScreen() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const program = await getActiveProgram()
      if (!program) { setError('No active program.'); return }
      const data = await getAllSessionsWithTemplate(program.id)
      setSessions(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    await discardSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-5">

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-ink">Session History</h1>
            <p className="text-xs text-ink-secondary mt-0.5">{sessions.length} sessions</p>
          </div>
        </div>

        {error && <p className="text-negative text-sm">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-surface/60 border border-edge rounded-2xl p-6 text-center">
            <p className="text-ink-secondary text-sm">No sessions yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                onDelete={handleDelete}
                onNavigate={id => navigate(`/sessions/${id}`)}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
