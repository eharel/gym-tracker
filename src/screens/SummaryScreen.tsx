import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getExerciseTemplates,
  getSetLogsForSession,
  getWorkoutTemplates,
  getActiveProgram,
  completeSession,
} from '../lib/db'
import { hasEarnedProgression } from '../lib/calculations'
import type { ExerciseTemplate, Session, SetLog, WorkoutTemplate } from '../types'
import { supabase } from '../lib/supabase'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function calcTotalVolume(setLogs: SetLog[]): number {
  return setLogs
    .filter(l => (l.set_type === 'top' || l.set_type === 'working' || l.set_type === 'backoff') && l.completed)
    .reduce((sum, l) => sum + (l.actual_weight ?? 0) * (l.actual_reps ?? 0), 0)
}

interface ProgressionResult {
  exercise: ExerciseTemplate
  newWeight: number
}

function getProgressionEarned(
  exercises: ExerciseTemplate[],
  setLogs: SetLog[],
): ProgressionResult[] {
  const results: ProgressionResult[] = []
  for (const ex of exercises) {
    const topSet = setLogs.find(
      l => l.exercise_template_id === ex.id && l.set_type === 'top' && l.completed,
    )
    if (!topSet || topSet.actual_reps === null || !ex.working_rep_target) continue
    if (hasEarnedProgression(ex.working_rep_target, topSet.actual_reps)) {
      results.push({
        exercise: ex,
        newWeight: (topSet.actual_weight ?? 0) + ex.weight_increment,
      })
    }
  }
  return results
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SummaryData {
  session: Session
  template: WorkoutTemplate
  exercises: ExerciseTemplate[]
  setLogs: SetLog[]
  lastSetLogs: SetLog[]   // previous completed session for this template
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function SummaryScreen() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<SummaryData | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    load(sessionId)
  }, [sessionId])

  async function load(id: string) {
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single()
      if (sessionError) throw sessionError

      const session = sessionData as Session

      // If session not yet completed (navigated here before completeSession), complete it now
      if (!session.completed_at) {
        await completeSession(id)
        session.completed_at = new Date().toISOString()
      }

      const program = await getActiveProgram()
      const templates = await getWorkoutTemplates(program?.id ?? '')
      const template = templates.find(t => t.id === session.workout_template_id) ?? templates[0]
      const exercises = await getExerciseTemplates(template.id)
      const setLogs = await getSetLogsForSession(id)

      // Load previous session for comparison (exclude the current one)
      const { data: prevSessRow } = await supabase
        .from('sessions')
        .select('id')
        .eq('workout_template_id', session.workout_template_id)
        .not('completed_at', 'is', null)
        .neq('id', id)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastSetLogs = prevSessRow ? await getSetLogsForSession(prevSessRow.id) : []

      setNote(session.notes ?? '')
      setData({ session, template, exercises, setLogs, lastSetLogs })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load summary')
    }
  }

  async function handleDone() {
    if (!sessionId) return
    setSaving(true)
    try {
      if (note.trim() !== (data?.session.notes ?? '')) {
        await supabase
          .from('sessions')
          .update({ notes: note.trim() || null })
          .eq('id', sessionId)
      }
      navigate('/', { replace: true })
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-negative text-sm text-center">{error}</p>
        <button onClick={() => navigate('/')} className="text-sm text-ink-secondary underline">
          Back to home
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const { session, template, exercises, setLogs, lastSetLogs } = data
  const duration = session.completed_at
    ? formatDuration(session.started_at, session.completed_at)
    : null
  const totalVolume = calcTotalVolume(setLogs)
  const progressions = getProgressionEarned(exercises, setLogs)

  // Per-exercise comparison vs. previous session
  interface CompRow {
    name: string
    currWeight: number
    currReps: number | null
    currSets: number          // number of working sets completed
    prevWeight: number | null
    prevReps: number | null
    prevSets: number
    weightDelta: number | null
  }
  const compRows: CompRow[] = exercises.flatMap(ex => {
    const curr = setLogs.filter(
      l => l.exercise_template_id === ex.id &&
           (l.set_type === 'top' || l.set_type === 'working' || l.set_type === 'amrap') &&
           l.completed && l.actual_weight,
    )
    if (!curr.length) return []
    const prev = lastSetLogs.filter(
      l => l.exercise_template_id === ex.id &&
           (l.set_type === 'top' || l.set_type === 'working' || l.set_type === 'amrap') &&
           l.actual_weight,
    )
    const currW = curr[0].actual_weight!
    const prevW = prev[0]?.actual_weight ?? null
    return [{
      name: ex.name,
      currWeight: currW,
      currReps: curr[0].actual_reps,
      currSets: curr.length,
      prevWeight: prevW,
      prevReps: prev[0]?.actual_reps ?? null,
      prevSets: prev.length,
      weightDelta: prevW !== null ? currW - prevW : null,
    }]
  })

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-10 sm:py-16 flex flex-col gap-5">

        {/* Header */}
        <div className="text-center flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-full bg-positive/15 border border-positive/30 flex items-center justify-center mb-1">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-positive">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink">Session complete</h1>
          <p className="text-sm text-ink-secondary">{template.name}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface/80 border border-edge rounded-xl p-4 flex flex-col items-center gap-1 text-center">
            <span className="text-2xl font-bold text-ink">{duration ?? '—'}</span>
            <span className="text-xs text-ink-secondary">Duration</span>
          </div>
          <div className="bg-surface/80 border border-edge rounded-xl p-4 flex flex-col items-center gap-1 text-center">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-ink tabular-nums">
                {totalVolume >= 1000
                  ? `${(totalVolume / 1000).toFixed(1)}k`
                  : totalVolume.toLocaleString()}
              </span>
              <span className="text-xs text-ink-secondary">lbs</span>
            </div>
            <span className="text-xs text-ink-secondary">Total volume</span>
          </div>
        </div>

        {/* vs. last session comparison */}
        {compRows.length > 0 && lastSetLogs.length > 0 && (
          <div className="bg-surface/80 border border-edge rounded-2xl p-4 flex flex-col gap-3">
            <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest">
              vs. last session
            </p>
            <div className="flex flex-col gap-2">
              {compRows.map(row => {
                const setsStr = (w: number, r: number | null, n: number) =>
                  n > 1 ? `${n}×${w}${r ? `×${r}` : ''}` : `${w}${r ? `×${r}` : ''}`
                const deltaColor =
                  row.weightDelta === null ? 'text-ink-disabled'
                  : row.weightDelta > 0  ? 'text-positive'
                  : row.weightDelta < 0  ? 'text-negative'
                  : 'text-ink-disabled'
                const deltaLabel =
                  row.weightDelta === null ? 'new'
                  : row.weightDelta > 0   ? `+${row.weightDelta}`
                  : row.weightDelta < 0   ? `${row.weightDelta}`
                  : '='
                return (
                  <div key={row.name} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 text-sm text-ink truncate">{row.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm tabular-nums text-ink-secondary">
                        {setsStr(row.currWeight, row.currReps, row.currSets)}
                      </span>
                      {row.prevWeight !== null && (
                        <span className="text-xs text-ink-disabled tabular-nums">
                          ← {setsStr(row.prevWeight, row.prevReps, row.prevSets)}
                        </span>
                      )}
                      <span className={`text-xs font-bold tabular-nums min-w-[2rem] text-right ${deltaColor}`}>
                        {deltaLabel}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Progression earned — automatically applied next session */}
        {progressions.length > 0 && (
          <div className="bg-positive/10 border border-positive/25 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-positive shrink-0">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              <p className="text-sm font-semibold text-positive">Progression applied</p>
            </div>
            <div className="flex flex-col gap-2">
              {progressions.map(({ exercise, newWeight }) => (
                <div key={exercise.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink">{exercise.name}</span>
                  <span className="text-sm font-semibold text-positive tabular-nums">
                    → {newWeight} lbs
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-disabled">Weight will be pre-loaded next session.</p>
          </div>
        )}

        {/* Session note */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-ink-secondary uppercase tracking-wider px-1">
            Session note
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="How did it go? Any form cues, injuries, energy level…"
            rows={3}
            className="w-full bg-surface border border-edge rounded-xl px-4 py-3 text-sm text-ink placeholder:text-ink-disabled resize-none outline-none focus:border-edge-strong transition-colors"
          />
        </div>

        {/* Done */}
        <div className="pt-2 pb-8">
          <button
            onClick={handleDone}
            disabled={saving}
            className="w-full bg-accent text-white font-bold rounded-2xl py-4 min-h-touch text-base active:opacity-80 transition-opacity disabled:opacity-50 shadow-card"
          >
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>

      </div>
    </div>
  )
}
