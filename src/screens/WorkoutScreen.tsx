import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  createSession,
  createSetLogs,
  getExerciseTemplates,
  getLastSessionForTemplate,
  getSetLogsForSession,
  getWorkoutTemplates,
  updateSetLog,
} from '../lib/db'
import { calcBackoffWeight, calcWarmupWeight, calcDumbbellWarmup, initializeSession } from '../lib/calculations'
import type { ExerciseTemplate, Session, SetLog, WorkoutTemplate } from '../types'
import RestTimer from '../components/RestTimer'

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkoutData {
  session: Session
  template: WorkoutTemplate
  exercises: ExerciseTemplate[]
  setLogs: SetLog[]
  lastSetLogs: SetLog[]  // previous session's logs for delta comparison
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatWeight(w: number | null): string {
  if (w === null) return ''
  return w === 0 ? '0' : String(w)
}

function DeltaBadge({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return null
  const delta = current - previous
  if (delta === 0) return null
  const positive = delta > 0
  return (
    <span className={`text-xs font-bold tabular-nums ${positive ? 'text-positive' : 'text-negative'}`}>
      {positive ? '+' : ''}{delta}
    </span>
  )
}

function setTypeLabel(type: SetLog['set_type']): { text: string; className: string } {
  switch (type) {
    case 'warmup':  return { text: 'Warm',   className: 'text-ink-disabled' }
    case 'top':     return { text: 'Top',    className: 'text-accent' }
    case 'backoff': return { text: 'Back',   className: 'text-ink-secondary' }
    case 'working': return { text: 'Work',   className: 'text-ink-secondary' }
    case 'amrap':   return { text: 'AMRAP',  className: 'text-positive' }
  }
}

// ─── Set row ─────────────────────────────────────────────────────────────────

function SetRow({
  log,
  prevLog,
  weightStep,
  onWeightChange,
  onRepsChange,
  onToggleComplete,
}: {
  log: SetLog
  prevLog: SetLog | null
  weightStep: number
  onWeightChange: (id: string, value: string) => void
  onRepsChange: (id: string, value: string) => void
  onToggleComplete: (id: string) => void
}) {
  const { text, className } = setTypeLabel(log.set_type)
  const isWarmup = log.set_type === 'warmup'
  const completed = log.completed
  const currentWeight = log.actual_weight ?? log.target_weight
  const currentReps = log.actual_reps

  return (
    <div
      className={`flex items-center gap-2 py-2 px-3 rounded-lg transition-colors ${
        completed ? 'bg-positive/5' : 'bg-transparent'
      }`}
    >
      {/* Set type label */}
      <div className="w-12 shrink-0 text-center">
        <span className={`text-xs font-semibold ${className} ${completed ? 'opacity-50' : ''}`}>
          {text}
        </span>
      </div>

      {/* Weight + delta */}
      <div className="flex-1 flex flex-col items-center gap-0.5">
        {log.set_type === 'warmup' && log.target_weight === 45 ? (
          <span className={`text-sm ${completed ? 'text-ink-disabled' : 'text-ink-secondary'}`}>
            Bar
          </span>
        ) : (
          <input
            type="number"
            inputMode="decimal"
            step={weightStep}
            value={formatWeight(currentWeight)}
            onChange={e => onWeightChange(log.id, e.target.value)}
            disabled={completed}
            className={`w-full text-center text-sm font-medium rounded-lg py-2 bg-elevated border transition-colors outline-none
              ${completed
                ? 'border-transparent text-ink-disabled bg-transparent'
                : isWarmup
                  ? 'border-edge text-ink-secondary focus:border-edge-strong'
                  : 'border-edge text-ink focus:border-accent'
              }`}
          />
        )}
        {/* Always render sub-label row to keep height consistent with reps column */}
        <div className="h-4 flex items-center justify-center">
          {!isWarmup && (
            <DeltaBadge current={currentWeight} previous={prevLog?.actual_weight ?? null} />
          )}
        </div>
      </div>

      {/* Reps + target label + delta */}
      <div className="flex-1 flex flex-col items-center gap-0.5">
        <input
          type="number"
          inputMode="numeric"
          step={1}
          value={log.actual_reps ?? ''}
          onChange={e => onRepsChange(log.id, e.target.value)}
          disabled={completed}
          className={`w-full text-center text-sm font-medium rounded-lg py-2 bg-elevated border transition-colors outline-none
            ${completed
              ? 'border-transparent text-ink-disabled bg-transparent'
              : isWarmup
                ? 'border-edge text-ink-secondary focus:border-edge-strong'
                : 'border-edge text-ink focus:border-accent'
            }`}
        />
        {/* Always render sub-label row — shows target range, then delta once reps entered */}
        <div className="h-4 flex items-center justify-center">
          {!isWarmup && currentReps !== null
            ? <DeltaBadge current={currentReps} previous={prevLog?.actual_reps ?? null} />
            : log.target_reps && !completed
              ? <span className="text-xs text-ink-disabled tabular-nums">{log.target_reps}</span>
              : null
          }
        </div>
      </div>

      {/* Done checkbox */}
      <button
        onClick={() => onToggleComplete(log.id)}
        className={`w-8 h-8 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors active:scale-95
          ${completed
            ? 'bg-positive border-positive'
            : 'border-edge-strong bg-transparent'
          }`}
        aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
      >
        {completed && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
    </div>
  )
}

// ─── Exercise card ────────────────────────────────────────────────────────────

function ExerciseCard({
  exercise,
  sets,
  prevSets,
  onWeightChange,
  onRepsChange,
  onToggleComplete,
  onSkip,
  skipped,
}: {
  exercise: ExerciseTemplate
  sets: SetLog[]
  prevSets: SetLog[]
  onWeightChange: (id: string, value: string) => void
  onRepsChange: (id: string, value: string) => void
  onToggleComplete: (id: string) => void
  onSkip: (id: string, skipped: boolean) => void
  skipped: boolean
}) {
  const workingSets = sets.filter(s => s.set_type !== 'warmup')
  const allDone = workingSets.length > 0 && workingSets.every(s => s.completed)
  const completedCount = workingSets.filter(s => s.completed).length

  const [collapsed, setCollapsed] = useState(false)

  // Auto-collapse when all working sets are marked done
  useEffect(() => {
    if (allDone) setCollapsed(true)
  }, [allDone])

  const topSet = sets.find(s => s.set_type === 'top')
  const workingSet = sets.find(s => s.set_type === 'working')
  const displayWeight = (topSet ?? workingSet)?.actual_weight ?? (topSet ?? workingSet)?.target_weight

  return (
    <div className={`bg-surface/80 border rounded-2xl overflow-hidden transition-opacity ${
      skipped ? 'opacity-40 border-edge' : allDone ? 'border-positive/30' : 'border-edge shadow-card'
    }`}>
      {/* Card header — always visible, tap to collapse/expand */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 pt-4 pb-3 flex items-center gap-3 text-left active:opacity-70"
      >
        {/* Done indicator */}
        <div className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
          allDone ? 'bg-positive border-positive' : skipped ? 'border-edge' : 'border-edge-strong'
        }`}>
          {(allDone || skipped) && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className={`font-bold text-base leading-tight ${allDone ? 'text-ink-secondary' : 'text-ink'}`}>
            {exercise.name}
          </h3>
          {collapsed ? (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-ink-disabled">
                {skipped ? 'Skipped' : `${completedCount}/${workingSets.length} sets`}
                {displayWeight != null && !skipped ? ` · ${displayWeight} lbs` : ''}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-0.5">
              {exercise.rpe_target && (
                <span className="text-xs text-ink-secondary">RPE {exercise.rpe_target}</span>
              )}
              {exercise.notes && (
                <span className="text-xs text-ink-disabled truncate">{exercise.notes}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {exercise.is_optional && !collapsed && (
            <span
              onClick={e => { e.stopPropagation(); onSkip(exercise.id, !skipped) }}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                skipped
                  ? 'border-edge text-ink-disabled bg-transparent'
                  : 'border-caution/40 text-caution bg-caution/10'
              }`}
            >
              {skipped ? 'Skipped' : 'Skip'}
            </span>
          )}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`text-ink-disabled transition-transform ${collapsed ? '' : 'rotate-180'}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Expandable content */}
      {!collapsed && !skipped && (
        <>
          {/* Column headers */}
          {sets.length > 0 && (
            <div className="flex items-center gap-2 px-3 pb-1">
              <div className="w-12 shrink-0 text-center">
                <span className="text-xs text-ink-disabled">Type</span>
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs text-ink-disabled">Weight</span>
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs text-ink-disabled">Reps</span>
              </div>
              <div className="w-8 shrink-0" />
            </div>
          )}

          {/* Set rows */}
          <div className="px-1 pb-3 flex flex-col gap-0.5">
            {sets.map(log => (
              <SetRow
                key={log.id}
                log={log}
                prevLog={prevSets.find(p => p.set_index === log.set_index && p.set_type === log.set_type) ?? null}
                weightStep={exercise.rounding_increment}
                onWeightChange={onWeightChange}
                onRepsChange={onRepsChange}
                onToggleComplete={onToggleComplete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Collapsible text block ───────────────────────────────────────────────────

function CollapsibleBlock({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-surface/60 border border-edge rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-ink-secondary">{title}</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-ink-disabled transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-sm text-ink-secondary leading-relaxed">{text}</p>
        </div>
      )}
    </div>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function WorkoutScreen() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [data, setData] = useState<WorkoutData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [completing, setCompleting] = useState(false)
  const pendingUpdates = useRef<Map<string, Partial<SetLog>>>(new Map())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function load() {
    try {
      let session: Session
      let template: WorkoutTemplate
      let setLogs: SetLog[]

      if (sessionId === 'new') {
        // Start a brand-new session
        const templateId = searchParams.get('template')
        if (!templateId) throw new Error('No template specified')

        const templates = await getWorkoutTemplates(
          // fetch by templateId to get program_id
          (await import('../lib/db').then(m => m.getActiveProgram()))?.id ?? '',
        )
        template = templates.find(t => t.id === templateId) ?? templates[0]

        const exercises = await getExerciseTemplates(templateId)
        const lastSession = await getLastSessionForTemplate(templateId)
        const lastLogs = lastSession
          ? await getSetLogsForSession(lastSession.id)
          : []

        session = await createSession(templateId)
        const newLogs = initializeSession(exercises, lastLogs)
        setLogs = await createSetLogs(session.id, newLogs)

        // Replace /workout/new URL with the real session ID so reload works
        navigate(`/workout/${session.id}`, { replace: true })

        const exercises2 = await getExerciseTemplates(templateId)
        setData({ session, template, exercises: exercises2, setLogs, lastSetLogs: lastLogs })
      } else {
        // Resume existing session
        if (!sessionId) throw new Error('No session ID')
        const { getInProgressSession } = await import('../lib/db')
        session = (await getInProgressSession()) ?? { id: sessionId } as Session

        const { getActiveProgram } = await import('../lib/db')
        const program = await getActiveProgram()
        const templates = await getWorkoutTemplates(program?.id ?? '')
        template = templates.find(t => t.id === session.workout_template_id) ?? templates[0]

        const exercises = await getExerciseTemplates(template.id)
        setLogs = await getSetLogsForSession(sessionId)

        const lastSession = await getLastSessionForTemplate(template.id)
        const lastLogs = lastSession && lastSession.id !== sessionId
          ? await getSetLogsForSession(lastSession.id)
          : []

        setData({ session, template, exercises, setLogs, lastSetLogs: lastLogs })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workout')
    }
  }

  useEffect(() => { load() }, [sessionId])

  // Debounced flush — batches rapid input changes into fewer DB writes
  function scheduleFlush(logId: string, updates: Partial<SetLog>) {
    pendingUpdates.current.set(logId, {
      ...(pendingUpdates.current.get(logId) ?? {}),
      ...updates,
    })
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flushPending, 800)
  }

  async function flushPending() {
    const batch = new Map(pendingUpdates.current)
    pendingUpdates.current.clear()
    await Promise.all(
      Array.from(batch.entries()).map(([id, updates]) => updateSetLog(id, updates)),
    )
  }

  function updateLog(logId: string, patch: Partial<SetLog>) {
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        setLogs: prev.setLogs.map(l => l.id === logId ? { ...l, ...patch } : l),
      }
    })
    scheduleFlush(logId, patch)
  }

  function handleWeightChange(logId: string, value: string) {
    const log = data?.setLogs.find(l => l.id === logId)
    if (!log) return

    const weight = value === '' ? null : parseFloat(value)
    const isOverride = weight !== log.target_weight
    updateLog(logId, { actual_weight: weight, is_weight_override: isOverride })

    // If this is a top set, recalculate warmup and backoff targets for this exercise
    if (log.set_type === 'top' && weight !== null && data) {
      const exercise = data.exercises.find(e => e.id === log.exercise_template_id)
      if (!exercise) return

      setData(prev => {
        if (!prev) return prev
        const updatedLogs = prev.setLogs.map(l => {
          if (l.exercise_template_id !== exercise.id) return l
          if (l.completed) return l
          if (l.set_type === 'warmup' && exercise.warmup_rule === 'percentage_of_top_set' && exercise.warmup_percentages) {
            const pct = exercise.warmup_percentages[l.set_index]
            if (pct === undefined) return l
            return { ...l, target_weight: calcWarmupWeight(weight, pct, exercise.rounding_increment) }
          }
          if (l.set_type === 'warmup' && exercise.warmup_rule === 'dumbbell_percentage') {
            return { ...l, target_weight: calcDumbbellWarmup(weight, exercise.warmup_db_percentage ?? 0.325, exercise.rounding_increment) }
          }
          if (l.set_type === 'backoff' && exercise.backoff_percentage) {
            return { ...l, target_weight: calcBackoffWeight(weight, exercise.backoff_percentage, exercise.rounding_increment) }
          }
          return l
        })
        return { ...prev, setLogs: updatedLogs }
      })
    }
  }

  function handleRepsChange(logId: string, value: string) {
    const reps = value === '' ? null : parseInt(value, 10)
    updateLog(logId, { actual_reps: isNaN(reps as number) ? null : reps })
  }

  async function handleToggleComplete(logId: string) {
    const log = data?.setLogs.find(l => l.id === logId)
    if (!log) return
    const newCompleted = !log.completed
    updateLog(logId, { completed: newCompleted })
    // Flush immediately on complete/uncomplete — don't wait for debounce
    if (flushTimer.current) clearTimeout(flushTimer.current)
    await updateSetLog(logId, { completed: newCompleted })
  }

  async function handleCompleteSession() {
    if (!data) return
    setCompleting(true)
    // Flush any pending input updates first
    if (flushTimer.current) clearTimeout(flushTimer.current)
    await flushPending()
    const { completeSession } = await import('../lib/db')
    await completeSession(data.session.id)
    navigate(`/summary/${data.session.id}`, { replace: true })
  }

  function handleSkip(exerciseId: string, skip: boolean) {
    setSkipped(prev => {
      const next = new Set(prev)
      skip ? next.add(exerciseId) : next.delete(exerciseId)
      return next
    })
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

  const { template, exercises, setLogs } = data

  // Group exercises by superset_group for labeling
  const supersetGroups = new Map<string, string[]>()
  exercises.forEach(e => {
    if (e.superset_group) {
      const g = supersetGroups.get(e.superset_group) ?? []
      g.push(e.id)
      supersetGroups.set(e.superset_group, g)
    }
  })

  const allWorkingSetsComplete = setLogs
    .filter(l => !skipped.has(l.exercise_template_id) && (l.set_type === 'top' || l.set_type === 'working' || l.set_type === 'backoff'))
    .every(l => l.completed)

  return (
    <div className="min-h-screen">
      <RestTimer />
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
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
            <h1 className="text-xl font-bold text-ink">{template.name}</h1>
            <p className="text-xs text-ink-secondary">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Warmup */}
        {template.warmup_text && (
          <CollapsibleBlock title="Warmup" text={template.warmup_text} />
        )}

        {/* Exercise cards */}
        {exercises.map((exercise, idx) => {
          const exerciseSets = setLogs
            .filter(l => l.exercise_template_id === exercise.id)
            .sort((a, b) => a.set_index - b.set_index)

          const prevExerciseSets = data.lastSetLogs
            .filter(l => l.exercise_template_id === exercise.id)
            .sort((a, b) => a.set_index - b.set_index)

          // Superset label: show before the first exercise in a group
          const prevExercise = exercises[idx - 1]
          const showSupersetLabel =
            exercise.superset_group &&
            exercise.superset_group !== prevExercise?.superset_group

          return (
            <div key={exercise.id}>
              {showSupersetLabel && (
                <div className="flex items-center gap-2 px-1">
                  <div className="flex-1 h-px bg-edge" />
                  <span className="text-xs text-ink-disabled font-medium">Superset</span>
                  <div className="flex-1 h-px bg-edge" />
                </div>
              )}
              <ExerciseCard
                exercise={exercise}
                sets={exerciseSets}
                prevSets={prevExerciseSets}
                onWeightChange={handleWeightChange}
                onRepsChange={handleRepsChange}
                onToggleComplete={handleToggleComplete}
                onSkip={handleSkip}
                skipped={skipped.has(exercise.id)}
              />
            </div>
          )
        })}

        {/* Cooldown */}
        {template.cooldown_text && (
          <CollapsibleBlock title="Cooldown" text={template.cooldown_text} />
        )}

        {/* Complete session */}
        <div className="pt-2 pb-8">
          <button
            onClick={handleCompleteSession}
            disabled={completing}
            className={`w-full font-bold rounded-2xl py-4 min-h-touch text-base transition-all
              ${allWorkingSetsComplete
                ? 'bg-positive text-gray-900 active:opacity-80 shadow-elevated'
                : 'bg-surface border border-edge text-ink-secondary'
              }
              ${completing ? 'opacity-50' : ''}
            `}
          >
            {completing ? 'Saving…' : allWorkingSetsComplete ? 'Complete Session' : 'Complete Session (sets remaining)'}
          </button>
        </div>

      </div>
    </div>
  )
}
