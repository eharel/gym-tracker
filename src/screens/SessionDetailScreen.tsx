import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUnit } from '../lib/units'
import { buildGCalUrl } from '../lib/gcal'
import { getExerciseTemplates, getSetLogsForSession, reopenSession } from '../lib/db'
import EditTimesModal from '../components/EditTimesModal'
import type { ExerciseTemplate, SetLog } from '../types'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionMeta {
  id: string
  workout_template_id: string
  started_at: string
  completed_at: string | null
  notes: string | null
  template_name: string
}

interface ExerciseLog {
  exercise: ExerciseTemplate
  sets: SetLog[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatDuration(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
}

function setTypePill(type: SetLog['set_type']) {
  switch (type) {
    case 'warmup':  return { label: 'W',    cls: 'bg-elevated text-ink-disabled border-edge' }
    case 'top':     return { label: 'Top',  cls: 'bg-accent/15 text-accent border-accent/30' }
    case 'working': return { label: 'W',    cls: 'bg-elevated text-ink-secondary border-edge' }
    case 'backoff': return { label: 'B',    cls: 'bg-elevated text-ink-secondary border-edge' }
    case 'amrap':   return { label: 'A',    cls: 'bg-positive/15 text-positive border-positive/30' }
  }
}

function calcVolume(sets: SetLog[]): number {
  return sets
    .filter(s => s.completed && (s.set_type === 'working' || s.set_type === 'top' || s.set_type === 'backoff' || s.set_type === 'amrap'))
    .reduce((sum, s) => sum + (s.actual_weight ?? 0) * (s.actual_reps ?? 0), 0)
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SessionDetailScreen() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const unit = useUnit()
  const [meta, setMeta] = useState<SessionMeta | null>(null)
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingTime, setEditingTime] = useState(false)
  const [reopening, setReopening] = useState(false)

  // Clears completed_at and drops back into the live workout screen —
  // completing it again (with the original notes intact) closes it back up
  async function handleReopen() {
    if (!sessionId || reopening) return
    setReopening(true)
    try {
      await reopenSession(sessionId)
      navigate(`/workout/${sessionId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reopen session')
      setReopening(false)
    }
  }

  async function load(id: string) {
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*, workout_templates(name)')
        .eq('id', id)
        .single()
      if (sessionError) throw sessionError

      interface RawSession {
        id: string; workout_template_id: string; started_at: string
        completed_at: string | null; notes: string | null
        workout_templates: { name: string } | null
      }
      const raw = sessionData as RawSession
      const session: SessionMeta = {
        id: raw.id,
        workout_template_id: raw.workout_template_id,
        started_at: raw.started_at,
        completed_at: raw.completed_at,
        notes: raw.notes,
        template_name: raw.workout_templates?.name ?? 'Unknown',
      }
      setMeta(session)

      const [setLogs, exercises] = await Promise.all([
        getSetLogsForSession(id),
        getExerciseTemplates(session.workout_template_id),
      ])

      const grouped: ExerciseLog[] = []
      for (const ex of exercises) {
        const sets = setLogs
          .filter(l => l.exercise_template_id === ex.id)
          .sort((a, b) => a.set_index - b.set_index)
        if (sets.length > 0) {
          grouped.push({ exercise: ex, sets })
        }
      }
      setExerciseLogs(grouped)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
    }
  }

  useEffect(() => {
    if (!sessionId) return
    load(sessionId)
  }, [sessionId])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm">{error}</p>
    </div>
  )

  if (!meta) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const duration = formatDuration(meta.started_at, meta.completed_at)
  const totalVolume = calcVolume(exerciseLogs.flatMap(e => e.sets))

  return (
    <div className="min-h-screen">
      {editingTime && (
        <EditTimesModal
          sessionId={meta.id}
          startedAt={meta.started_at}
          completedAt={meta.completed_at}
          onSave={(startedAt, completedAt) => {
            setMeta(prev => prev ? { ...prev, started_at: startedAt, completed_at: completedAt } : prev)
            setEditingTime(false)
          }}
          onClose={() => setEditingTime(false)}
        />
      )}

      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate('/sessions')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70 shrink-0"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{meta.template_name}</h1>
            <button
              onClick={() => setEditingTime(true)}
              className="flex items-center gap-1 mt-0.5 text-left active:opacity-70 group"
            >
              <p className="text-xs text-ink-secondary group-hover:text-ink">{formatDate(meta.started_at)}</p>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-disabled shrink-0">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setEditingTime(true)}
            className="bg-surface/80 border border-edge rounded-xl p-3 flex flex-col items-center gap-0.5 text-center active:opacity-70"
          >
            <span className="text-xl font-bold text-ink">{duration ?? '—'}</span>
            <span className="text-xs text-ink-secondary flex items-center gap-1">
              Duration
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-disabled">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </span>
          </button>
          <div className="bg-surface/80 border border-edge rounded-xl p-3 flex flex-col items-center gap-0.5 text-center">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold text-ink tabular-nums">
                {totalVolume >= 1000
                  ? `${(totalVolume / 1000).toFixed(1)}k`
                  : totalVolume.toLocaleString()}
              </span>
              <span className="text-xs text-ink-secondary">{unit.label}</span>
            </div>
            <span className="text-xs text-ink-secondary">Volume</span>
          </div>
        </div>

        {/* Exercise logs */}
        {exerciseLogs.map(({ exercise, sets }) => {
          const workingSets = sets.filter(s => s.set_type !== 'warmup')
          const completedCount = workingSets.filter(s => s.completed).length
          const allDone = workingSets.length > 0 && completedCount === workingSets.length

          return (
            <div
              key={exercise.id}
              className={`bg-surface/80 border rounded-2xl overflow-hidden ${
                allDone ? 'border-positive/25' : 'border-edge'
              }`}
            >
              <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
                <span className="font-bold text-sm text-ink">{exercise.name}</span>
                <span className="text-xs text-ink-disabled tabular-nums">
                  {completedCount}/{workingSets.length} sets
                </span>
              </div>

              <div className="px-3 pb-3 flex flex-col gap-0.5">
                {sets.map(set => {
                  const { label, cls } = setTypePill(set.set_type)
                  return (
                    <div
                      key={set.id}
                      className={`flex items-center gap-3 py-1.5 px-2 rounded-lg text-sm ${
                        set.completed ? '' : 'opacity-40'
                      }`}
                    >
                      <span className={`text-xs font-semibold border rounded px-1.5 py-0.5 shrink-0 ${cls}`}>
                        {label}
                      </span>
                      <span className="flex-1 tabular-nums text-ink font-medium">
                        {set.actual_weight != null
                          ? `${set.actual_weight} ${unit.label}`
                          : set.target_weight != null
                            ? `${set.target_weight} ${unit.label}`
                            : '—'}
                      </span>
                      <span className="tabular-nums text-ink-secondary">
                        {set.actual_reps != null
                          ? `${set.actual_reps} reps`
                          : set.target_reps
                            ? `${set.target_reps} reps`
                            : '—'}
                      </span>
                      <div className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center ${
                        set.completed ? 'bg-positive' : 'bg-elevated border border-edge'
                      }`}>
                        {set.completed && (
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Session note */}
        {meta.notes && (
          <div className="bg-surface/60 border border-edge rounded-2xl p-4">
            <p className="text-xs font-semibold text-ink-disabled uppercase tracking-wide mb-2">Session note</p>
            <p className="text-sm text-ink-secondary leading-relaxed">{meta.notes}</p>
          </div>
        )}

        {/* Add to Google Calendar */}
        {meta.completed_at && (
          <a
            href={buildGCalUrl({
              title: meta.template_name,
              startedAt: meta.started_at,
              completedAt: meta.completed_at,
              exercises: exerciseLogs.map(({ exercise, sets }) => ({ name: exercise.name, sets })),
              unitLabel: unit.label,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full border border-edge rounded-2xl py-3.5 text-sm font-medium text-ink-secondary hover:text-ink hover:border-edge-strong active:opacity-70 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Add to Google Calendar
          </a>
        )}

        {/* Reopen — move back to in-progress and continue editing live */}
        {meta.completed_at && (
          <button
            onClick={handleReopen}
            disabled={reopening}
            className="flex items-center justify-center gap-2 w-full border border-edge rounded-2xl py-3.5 text-sm font-medium text-ink-secondary hover:text-ink hover:border-edge-strong active:opacity-70 transition-colors disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            {reopening ? 'Reopening…' : 'Reopen workout'}
          </button>
        )}

      </div>
    </div>
  )
}
