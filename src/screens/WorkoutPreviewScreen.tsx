import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  getExerciseTemplates,
  getRecentCompletedSessionsForTemplate,
  getSetLogsForSession,
  getWorkoutTemplates,
} from '../lib/db'
import { detectComeback, initializeSession } from '../lib/calculations'
import type { ComebackInfo } from '../lib/calculations'
import type { ExerciseTemplate, NewSetLog, SetLog, WorkoutTemplate } from '../types'
import { getActiveProgram } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreviewData {
  template:    WorkoutTemplate
  exercises:   ExerciseTemplate[]
  sets:        NewSetLog[]       // computed, NOT written to DB
  lastSetLogs: SetLog[]          // benchmark or most-recent, for prev display
  comeback:    ComebackInfo | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function plateBreakdown(totalWeight: number, barWeight = 45): string | null {
  const perSide = (totalWeight - barWeight) / 2
  if (perSide < 0) return null
  if (perSide === 0) return 'bar only'
  const available = [45, 35, 25, 10, 5, 2.5]
  let rem = Math.round(perSide * 100) / 100
  const plates: number[] = []
  for (const p of available) {
    while (rem >= p - 0.01) { plates.push(p); rem = Math.round((rem - p) * 100) / 100 }
  }
  if (rem > 0.1) return null
  return plates.join('+') + '/side'
}

type SetTypeMeta = { label: string; cls: string }
function setTypeMeta(type: NewSetLog['set_type']): SetTypeMeta {
  switch (type) {
    case 'warmup':  return { label: 'Warm',  cls: 'text-ink-disabled' }
    case 'top':     return { label: 'Top',   cls: 'text-accent' }
    case 'backoff': return { label: 'Back',  cls: 'text-ink-secondary' }
    case 'working': return { label: 'Work',  cls: 'text-ink-secondary' }
    case 'amrap':   return { label: 'AMRAP', cls: 'text-positive' }
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ComebackBadge({ info }: { info: ComebackInfo }) {
  return (
    <div className="bg-caution/10 border border-caution/30 rounded-2xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-caution">
          Comeback · {info.gapDays} days off
        </p>
        <p className="text-xs text-ink-secondary mt-0.5">
          Session {info.comebackSessionsDone + 1} of {info.comebackSessionsTotal} ·{' '}
          weights at {Math.round(info.factor * 100)}%
          {info.sessionsRemaining === 1 ? ' · back to full next session' : ''}
        </p>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: info.comebackSessionsTotal }, (_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${
            i < info.comebackSessionsDone + 1 ? 'bg-caution' : 'bg-edge'
          }`} />
        ))}
      </div>
    </div>
  )
}

function CollapsibleBlock({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-surface/60 border border-edge rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-ink-secondary">{title}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-ink-disabled transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4"><p className="text-sm text-ink-secondary leading-relaxed">{text}</p></div>}
    </div>
  )
}

function PreviewSetRow({
  set,
  isBarbell,
  workingWeight,
}: {
  set: NewSetLog
  isBarbell: boolean
  workingWeight: number | null
}) {
  const { label, cls } = setTypeMeta(set.set_type)
  const isBar     = set.set_type === 'warmup' && set.target_weight === 45
  const plates    = isBarbell && !isBar && set.target_weight ? plateBreakdown(set.target_weight) : null
  const warmupPct = set.set_type === 'warmup' && isBarbell && workingWeight && set.target_weight
    ? Math.round((set.target_weight / workingWeight) * 100)
    : null

  return (
    <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg">
      {/* Type */}
      <div className="w-12 shrink-0 text-center">
        <span className={`text-xs font-semibold ${cls}`}>{label}</span>
      </div>

      {/* Weight */}
      <div className="flex-[2] flex flex-col items-center">
        <span className="text-sm font-medium text-ink tabular-nums">
          {isBar ? 'Bar' : set.target_weight != null ? `${set.target_weight}` : '—'}
        </span>
        {(plates || warmupPct !== null) && (
          <span className="text-xs text-ink-disabled tabular-nums leading-tight">
            {[plates, warmupPct !== null ? `${warmupPct}%` : null].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {/* Reps */}
      <div className="flex-[3] text-center">
        <span className="text-sm text-ink-secondary tabular-nums">
          {set.target_reps ?? '—'}
        </span>
      </div>
    </div>
  )
}

function PreviewExerciseCard({
  exercise,
  sets,
  lastSetLogs,
}: {
  exercise:    ExerciseTemplate
  sets:        NewSetLog[]
  lastSetLogs: SetLog[]
}) {
  const isBarbell  = exercise.warmup_rule === 'percentage_of_top_set'
  const workingSet = sets.find(s => s.set_type === 'top' || s.set_type === 'working')
  const workingW   = workingSet?.target_weight ?? null

  const prevSet    = lastSetLogs.find(l =>
    l.exercise_template_id === exercise.id &&
    (l.set_type === 'top' || l.set_type === 'working'),
  )
  const prevWeight = prevSet?.actual_weight ?? null
  const plates     = isBarbell && workingW ? plateBreakdown(workingW) : null

  return (
    <div className="bg-surface/80 border border-edge rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base text-ink truncate">{exercise.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {exercise.rpe_target && (
              <span className="text-xs text-ink-secondary">RPE {exercise.rpe_target}</span>
            )}
            {prevWeight !== null && (
              <span className="text-xs text-ink-disabled">prev {prevWeight} lbs</span>
            )}
            {plates && (
              <span className="text-xs text-ink-disabled font-mono">{plates}</span>
            )}
          </div>
        </div>
        {workingW !== null && (
          <span className="text-lg font-bold text-ink tabular-nums shrink-0">
            {workingW}
            <span className="text-xs font-normal text-ink-secondary ml-0.5">lbs</span>
          </span>
        )}
      </div>

      {/* Column headers */}
      {sets.length > 0 && (
        <div className="flex items-center gap-2 px-3 pb-1">
          <div className="w-12 shrink-0 text-center">
            <span className="text-xs text-ink-disabled">Type</span>
          </div>
          <div className="flex-[2] text-center">
            <span className="text-xs text-ink-disabled">Weight</span>
          </div>
          <div className="flex-[3] text-center">
            <span className="text-xs text-ink-disabled">Reps</span>
          </div>
        </div>
      )}

      {/* Set rows */}
      <div className="px-1 pb-3 flex flex-col gap-0.5">
        {sets.map((set, i) => (
          <PreviewSetRow
            key={i}
            set={set}
            isBarbell={isBarbell}
            workingWeight={workingW}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WorkoutPreviewScreen() {
  const [searchParams] = useSearchParams()
  const templateId     = searchParams.get('template') ?? ''
  const navigate       = useNavigate()

  const [data, setData]   = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(id: string) {
    try {
      const program   = await getActiveProgram()
      const templates = await getWorkoutTemplates(program?.id ?? '')
      const template  = templates.find(t => t.id === id) ?? templates[0]
      const exercises = await getExerciseTemplates(id)

      const recentSessions = await getRecentCompletedSessionsForTemplate(id, 10)
      const comeback        = detectComeback(recentSessions)

      let lastSetLogs: SetLog[]
      if (comeback) {
        lastSetLogs = await getSetLogsForSession(comeback.benchmarkSessionId)
      } else {
        lastSetLogs = recentSessions[0]
          ? await getSetLogsForSession(recentSessions[0].id)
          : []
      }

      // Compute what the session would look like — no DB write
      const sets = initializeSession(exercises, lastSetLogs, comeback?.factor)

      setData({ template, exercises, sets, lastSetLogs, comeback })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load preview')
    }
  }

  useEffect(() => {
    if (templateId) load(templateId)
  }, [templateId])

  function handleStart() {
    navigate(`/workout/new?template=${templateId}`)
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm">{error}</p>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const { template, exercises, sets, lastSetLogs, comeback } = data

  // Group sets by exercise in exercise order
  const exerciseGroups = exercises.map(ex => ({
    exercise: ex,
    sets: sets
      .filter(s => s.exercise_template_id === ex.id)
      .sort((a, b) => a.set_index - b.set_index),
  })).filter(g => g.sets.length > 0)

  // Superset grouping (consecutive exercises with same superset_group)
  type Group =
    | { kind: 'single'; exercise: ExerciseTemplate; sets: NewSetLog[] }
    | { kind: 'superset'; label: string; items: { exercise: ExerciseTemplate; sets: NewSetLog[] }[] }

  const groups: Group[] = []
  let i = 0
  while (i < exerciseGroups.length) {
    const g = exerciseGroups[i]
    if (g.exercise.superset_group) {
      const members = [g]
      while (
        i + 1 < exerciseGroups.length &&
        exerciseGroups[i + 1].exercise.superset_group === g.exercise.superset_group
      ) { i++; members.push(exerciseGroups[i]) }
      if (members.length > 1) {
        groups.push({ kind: 'superset', label: g.exercise.superset_group, items: members })
      } else {
        groups.push({ kind: 'single', ...g })
      }
    } else {
      groups.push({ kind: 'single', ...g })
    }
    i++
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70 shrink-0"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-ink truncate">{template.name}</h1>
              <span className="text-xs font-medium text-ink-disabled bg-elevated border border-edge rounded-lg px-2 py-0.5 shrink-0">
                Preview
              </span>
            </div>
            <p className="text-xs text-ink-secondary mt-0.5">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Comeback banner */}
        {comeback && <ComebackBadge info={comeback} />}

        {/* Warmup notes */}
        {template.warmup_text && (
          <CollapsibleBlock title="Warmup" text={template.warmup_text} />
        )}

        {/* Exercise cards */}
        {groups.map((group, gi) => {
          if (group.kind === 'single') {
            return (
              <PreviewExerciseCard
                key={group.exercise.id}
                exercise={group.exercise}
                sets={group.sets}
                lastSetLogs={lastSetLogs}
              />
            )
          }
          return (
            <div key={gi} className="flex gap-2.5">
              <div className="flex flex-col items-center pt-6 pb-1 shrink-0">
                <div className="w-0.5 flex-1 bg-accent/25 rounded-full" />
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <p className="text-xs text-accent/70 font-semibold uppercase tracking-widest px-1">
                  Superset
                </p>
                {group.items.map(item => (
                  <PreviewExerciseCard
                    key={item.exercise.id}
                    exercise={item.exercise}
                    sets={item.sets}
                    lastSetLogs={lastSetLogs}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {/* Cooldown notes */}
        {template.cooldown_text && (
          <CollapsibleBlock title="Cooldown" text={template.cooldown_text} />
        )}

        {/* bottom padding so content doesn't hide behind the sticky button */}
        <div className="h-24" />

      </div>

      {/* Sticky Start button */}
      <div className="fixed bottom-0 inset-x-0 px-4 pb-8 pt-3 bg-gradient-to-t from-base via-base/90 to-transparent pointer-events-none">
        <button
          onClick={handleStart}
          className="w-full max-w-md mx-auto block bg-accent text-white font-bold rounded-2xl py-4 text-base active:opacity-80 transition-opacity shadow-card pointer-events-auto"
        >
          Start Workout
        </button>
      </div>
    </div>
  )
}
