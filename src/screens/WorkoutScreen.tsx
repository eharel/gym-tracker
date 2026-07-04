import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useUnit } from '../lib/units'
import {
  createSession,
  createSetLogs,
  getExerciseNotes,
  getExerciseTemplate,
  getExerciseTemplates,
  getRecentCompletedSessionsForTemplate,
  getSetLogsForExercise,
  getSetLogsForSession,
  getWorkoutTemplates,
  saveExerciseNote,
  updateSetLog,
} from '../lib/db'
import { barWeightForType, calcBackoffWeight, calcStaleness, calcWarmupWeight, calcDumbbellWarmup, detectComeback, initializeSession } from '../lib/calculations'
import type { ComebackInfo } from '../lib/calculations'
import type { ExerciseTemplate, Session, SetLog, WorkoutTemplate } from '../types'
import RestTimer from '../components/RestTimer'

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkoutData {
  session: Session
  template: WorkoutTemplate
  exercises: ExerciseTemplate[]
  setLogs: SetLog[]
  lastSetLogs: SetLog[]           // most recent completed session (display comparison)
  stalenessMap: Record<string, number>
  comeback: ComebackInfo | null
  // Maps primary exercise ID → its alternate ExerciseTemplate (preloaded)
  altExercises: Map<string, ExerciseTemplate>
}

interface NoteEntry {
  id?: string
  text: string
}

type ExerciseGroup =
  | ExerciseTemplate
  | { superset: string; items: ExerciseTemplate[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatWeight(w: number | null): string {
  if (w === null) return ''
  return w === 0 ? '0' : String(w)
}

/**
 * Returns the plate configuration for one side of a standard barbell (45 lb bar).
 * e.g. plateBreakdown(230) → "45 + 45 + 2.5 / side"
 */
function plateBreakdown(totalWeight: number, barWeight = 45): string | null {
  const available = [45, 35, 25, 10, 5, 2.5]
  const perSide = (totalWeight - barWeight) / 2
  if (perSide < 0) return null
  if (perSide === 0) return 'bar only'
  let rem = Math.round(perSide * 100) / 100
  const plates: number[] = []
  for (const p of available) {
    while (rem >= p - 0.01) {
      plates.push(p)
      rem = Math.round((rem - p) * 100) / 100
    }
  }
  if (rem > 0.1) return null // can't make this weight with standard plates
  return plates.join(' + ') + ' / side'
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
    case 'warmup':  return { text: 'Warm',  className: 'text-ink-disabled' }
    case 'top':     return { text: 'Top',   className: 'text-accent' }
    case 'backoff': return { text: 'Back',  className: 'text-ink-secondary' }
    case 'working': return { text: 'Work',  className: 'text-ink-secondary' }
    case 'amrap':   return { text: 'AMRAP', className: 'text-positive' }
  }
}

// ─── Stepper button ───────────────────────────────────────────────────────────

function StepBtn({ label, icon, onClick }: { label: string; icon: 'minus' | 'plus'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-6 h-6 rounded-md bg-elevated border border-edge flex items-center justify-center text-ink-secondary active:opacity-60 shrink-0"
      aria-label={label}
    >
      {icon === 'minus' ? (
        <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
          <rect width="10" height="2" rx="1" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <rect x="4" width="2" height="10" rx="1" />
          <rect y="4" width="10" height="2" rx="1" />
        </svg>
      )}
    </button>
  )
}

// ─── Set row ─────────────────────────────────────────────────────────────────

function SetRow({
  log,
  prevLog,
  weightStep,
  barWeight,
  topSetWeight,
  onWeightChange,
  onRepsChange,
  onToggleComplete,
}: {
  log: SetLog
  prevLog: SetLog | null
  weightStep: number
  barWeight: number | null
  topSetWeight: number | null
  onWeightChange: (id: string, value: string) => void
  onRepsChange: (id: string, value: string) => void
  onToggleComplete: (id: string) => void
}) {
  const { text, className } = setTypeLabel(log.set_type)
  const isWarmup = log.set_type === 'warmup'
  const completed = log.completed
  const weightInputRef = useRef<HTMLInputElement>(null)


  // Local display state so clearing the field doesn't snap back to target_weight
  const [weightDisplay, setWeightDisplay] = useState(() =>
    formatWeight(log.actual_weight ?? log.target_weight),
  )

  // Sync from props when target recalculates (e.g. top-set weight changed),
  // but only when the input isn't currently focused
  useEffect(() => {
    if (document.activeElement !== weightInputRef.current) {
      setWeightDisplay(formatWeight(log.actual_weight ?? log.target_weight))
    }
  }, [log.actual_weight, log.target_weight])

  function handleWeightInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setWeightDisplay(v)
    onWeightChange(log.id, v)
  }

  function stepWeight(delta: number) {
    const current = parseFloat(weightDisplay) || 0
    const next = Math.max(0, Math.round((current + delta) * 100) / 100)
    const v = String(next)
    setWeightDisplay(v)
    onWeightChange(log.id, v)
  }

  function stepReps(delta: number) {
    const current = log.actual_reps ?? 0
    const next = Math.max(0, current + delta)
    setIsPrefilled(false)
    onRepsChange(log.id, String(next))
  }

  const numericWeight =
    weightDisplay === '' || isNaN(parseFloat(weightDisplay)) ? null : parseFloat(weightDisplay)

  const isBelowTarget =
    isWarmup &&
    log.target_weight !== null &&
    numericWeight !== null &&
    numericWeight < log.target_weight

  // Reps are pre-filled (working sets: from last session; warmups: from the
  // template prescription). Track whether the user has touched the field yet:
  // prefilled = muted + show target range; edited = normal + show delta.
  const [isPrefilled, setIsPrefilled] = useState(
    () =>
      !log.completed &&
      log.actual_reps !== null &&
      (isWarmup
        ? String(log.actual_reps) === log.target_reps
        : prevLog !== null && log.actual_reps === prevLog.actual_reps),
  )

  const isBar = barWeight !== null && isWarmup && log.target_weight === barWeight
  // Per-set plate breakdown — skip the "Bar" row (no plates needed) and blank weights
  const plateStr = barWeight !== null && !isBar && numericWeight ? plateBreakdown(numericWeight, barWeight) : null
  // Percentage of the top-set weight, shown for warmup and backoff sets
  const pctOfTop =
    (isWarmup || log.set_type === 'backoff') && barWeight !== null && topSetWeight && numericWeight
      ? Math.round((numericWeight / topSetWeight) * 100)
      : null

  // Sub-label content — computed here so we can skip the info row when empty
  const weightSubLabel = !isWarmup ? (
    <>
      <DeltaBadge current={numericWeight} previous={prevLog ? (prevLog.actual_weight ?? prevLog.target_weight) : null} />
      {(plateStr || pctOfTop !== null) && (
        <span className="text-xs text-ink-disabled tabular-nums leading-tight text-center">
          {[plateStr, pctOfTop !== null ? `${pctOfTop}%` : null].filter(Boolean).join(' · ')}
        </span>
      )}
    </>
  ) : isBelowTarget ? (
    <span className="text-xs text-caution tabular-nums">target {log.target_weight}</span>
  ) : (plateStr || pctOfTop !== null) ? (
    <span className="text-xs text-ink-disabled tabular-nums leading-tight text-center">
      {[plateStr, pctOfTop !== null ? `${pctOfTop}%` : null].filter(Boolean).join(' · ')}
    </span>
  ) : null

  const repsSubLabel = completed
    ? (!isWarmup ? <DeltaBadge current={log.actual_reps} previous={prevLog?.actual_reps ?? null} /> : null)
    : (isPrefilled || log.actual_reps === null)
      ? (log.target_reps ? <span className="text-xs text-ink-disabled tabular-nums">{log.target_reps}</span> : null)
      : (!isWarmup ? <DeltaBadge current={log.actual_reps} previous={prevLog?.actual_reps ?? null} /> : null)

  const hasSubLabels = weightSubLabel !== null || repsSubLabel !== null

  return (
    <div className={`py-2 px-3 rounded-lg transition-colors ${completed ? 'bg-positive/5' : 'bg-transparent'}`}>

      {/* ── Input row: always fixed height, never pushed by sub-labels ── */}
      <div className="flex items-center gap-2">
        {/* Set type label */}
        <div className="w-12 shrink-0 text-center">
          <span className={`text-xs font-semibold ${className} ${completed ? 'opacity-50' : ''}`}>
            {text}
          </span>
        </div>

        {/* Weight input */}
        <div className="flex-[2] min-w-0 flex items-center gap-1">
          {isBar ? (
            <>
              {!completed && <div className="w-6 h-6 shrink-0" />}
              <span className={`flex-1 block text-center text-sm font-medium rounded-lg py-2 border
                ${completed
                  ? 'bg-transparent border-transparent text-ink-disabled'
                  : 'bg-elevated border-edge text-ink-secondary'
                }`}>
                Bar
              </span>
              {!completed && <div className="w-6 h-6 shrink-0" />}
            </>
          ) : (
            <>
              {!completed && (
                <StepBtn label={`−${weightStep}`} icon="minus" onClick={() => stepWeight(-weightStep)} />
              )}
              <input
                ref={weightInputRef}
                type="number"
                inputMode="decimal"
                step={weightStep}
                value={weightDisplay}
                onChange={handleWeightInput}
                disabled={completed}
                className={`flex-1 min-w-0 text-center text-sm font-medium rounded-lg py-2 bg-elevated border transition-colors outline-none
                  ${completed
                    ? 'border-transparent text-ink-disabled bg-transparent'
                    : isBelowTarget
                      ? 'border-caution/60 text-caution focus:border-caution'
                      : isWarmup
                        ? 'border-edge text-ink-secondary focus:border-edge-strong'
                        : 'border-edge text-ink focus:border-accent'
                  }`}
              />
              {!completed && (
                <StepBtn label={`+${weightStep}`} icon="plus" onClick={() => stepWeight(weightStep)} />
              )}
            </>
          )}
        </div>

        <div className="w-px self-stretch bg-edge shrink-0" />

        {/* Reps input */}
        <div className="flex-[2] min-w-0 flex items-center gap-1">
          {!completed && (
            <StepBtn label="−1 rep" icon="minus" onClick={() => stepReps(-1)} />
          )}
          <input
            type="number"
            inputMode="numeric"
            step={1}
            value={log.actual_reps ?? ''}
            onFocus={() => setIsPrefilled(false)}
            onChange={e => { setIsPrefilled(false); onRepsChange(log.id, e.target.value) }}
            disabled={completed}
            className={`flex-1 min-w-0 text-center text-sm font-medium rounded-lg py-2 bg-elevated border transition-colors outline-none
              ${completed
                ? 'border-transparent text-ink-disabled bg-transparent'
                : isPrefilled
                  ? 'border-edge/50 text-ink-disabled'
                  : isWarmup
                    ? 'border-edge text-ink-secondary focus:border-edge-strong'
                    : 'border-edge text-ink focus:border-accent'
              }`}
          />
          {!completed && (
            <StepBtn label="+1 rep" icon="plus" onClick={() => stepReps(1)} />
          )}
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

      {/* ── Info row: below inputs, never affects their alignment ── */}
      {hasSubLabels && (
        <div className="flex gap-2 mt-0.5">
          <div className="w-12 shrink-0" />
          <div className="flex-[2] flex flex-col items-center">{weightSubLabel}</div>
          <div className="w-px shrink-0" />
          <div className="flex-[2] flex items-center justify-center">{repsSubLabel}</div>
          <div className="w-8 shrink-0" />
        </div>
      )}

    </div>
  )
}

// ─── Exercise card ────────────────────────────────────────────────────────────

function ExerciseCard({
  exercise,
  sets,
  prevSets,
  note,
  staleness,
  skipped,
  altName,
  isSwapped,
  onSwap,
  swapping,
  onWeightChange,
  onRepsChange,
  onToggleComplete,
  onSkip,
  onNoteChange,
}: {
  exercise: ExerciseTemplate
  sets: SetLog[]
  prevSets: SetLog[]
  note: NoteEntry
  staleness: number
  skipped: boolean
  altName: string | null
  isSwapped: boolean
  onSwap?: () => void
  swapping?: boolean
  onWeightChange: (id: string, value: string) => void
  onRepsChange: (id: string, value: string) => void
  onToggleComplete: (id: string) => void
  onSkip: (id: string, skipped: boolean) => void
  onNoteChange: (exerciseId: string, text: string) => void
}) {
  const unit = useUnit()
  const workingSets = sets.filter(s => s.set_type !== 'warmup')
  const allDone = workingSets.length > 0 && workingSets.every(s => s.completed)
  const completedCount = workingSets.filter(s => s.completed).length
  // Auto-collapse when all sets are done; manual expand overrides until allDone resets
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  const collapsed = allDone && !manuallyExpanded

  const barWeight = barWeightForType(exercise.bar_type)

  // Current working weight for the collapsed summary line
  const topSet = sets.find(s => s.set_type === 'top') ?? sets.find(s => s.set_type === 'working')
  const workingWeight = topSet?.actual_weight ?? topSet?.target_weight ?? null

  return (
    <div className={`bg-surface/80 border rounded-2xl overflow-hidden transition-opacity ${
      skipped ? 'opacity-40 border-edge' : allDone ? 'border-positive/30' : 'border-edge shadow-card'
    }`}>
      {/* Header — tap to collapse/expand */}
      <button
        onClick={() => setManuallyExpanded(e => !e)}
        className="w-full px-4 pt-4 pb-3 flex items-center gap-3 text-left active:opacity-70"
      >
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
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className={`font-bold text-base leading-tight ${allDone ? 'text-ink-secondary' : 'text-ink'}`}>
              {exercise.name}
            </h3>
            {staleness >= 3 && (
              <span className="text-caution text-xs" title={`No progress in ${staleness} sessions`}>●</span>
            )}
            {staleness >= 1 && staleness < 3 && (
              <span className="text-ink-disabled text-xs" title={`No progress in ${staleness} session${staleness > 1 ? 's' : ''}`}>●</span>
            )}
            {onSwap && altName && (
              <button
                onClick={e => { e.stopPropagation(); onSwap() }}
                disabled={swapping}
                className={`text-xs px-2 py-0.5 rounded-lg border flex items-center gap-1 shrink-0 transition-colors active:opacity-70 ${
                  isSwapped
                    ? 'border-accent/40 text-accent bg-accent/10'
                    : 'border-edge text-ink-disabled bg-elevated'
                } ${swapping ? 'opacity-50' : ''}`}
              >
                {swapping ? (
                  <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 16V4m0 0L3 8m4-4 4 4" />
                    <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
                  </svg>
                )}
                {altName}
              </button>
            )}
          </div>
          {collapsed ? (
            <span className="text-xs text-ink-disabled">
              {skipped ? 'Skipped' : `${completedCount}/${workingSets.length} sets`}
              {workingWeight != null && !skipped ? ` · ${workingWeight} ${unit.label}` : ''}
            </span>
          ) : (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {exercise.rpe_target && (
                <span className="text-xs text-ink-secondary">RPE {exercise.rpe_target}</span>
              )}
              {exercise.notes && (
                <span className="text-xs text-ink-disabled leading-snug">{exercise.notes}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!collapsed && (
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
                barWeight={barWeight}
                topSetWeight={workingWeight}
                onWeightChange={onWeightChange}
                onRepsChange={onRepsChange}
                onToggleComplete={onToggleComplete}
              />
            ))}
          </div>

          {/* Per-exercise notes */}
          <div className="px-3 pb-3">
            <textarea
              value={note.text}
              onChange={e => onNoteChange(exercise.id, e.target.value)}
              placeholder="Notes for this exercise…"
              rows={2}
              className="w-full text-sm text-ink-secondary bg-elevated/60 border border-edge rounded-xl px-3 py-2 placeholder:text-ink-disabled resize-none outline-none focus:border-edge-strong transition-colors"
            />
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

// ─── Comeback banner ──────────────────────────────────────────────────────────

function ComebackBanner({ info, onDismiss }: { info: ComebackInfo; onDismiss: () => void }) {
  const session = info.comebackSessionsDone + 1
  const total   = info.comebackSessionsTotal
  const pct     = Math.round(info.factor * 100)
  const last    = info.sessionsRemaining === 1

  return (
    <div className="bg-caution/10 border border-caution/30 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-caution">
            Coming back · {info.gapDays} days off
          </p>
          <p className="text-xs text-ink-secondary mt-0.5">
            Session {session} of {total} · weights at {pct}%
            {last ? ' · back to full next session' : ''}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="w-6 h-6 flex items-center justify-center text-ink-disabled active:opacity-60 shrink-0"
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Progress pips */}
      <div className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < session ? 'bg-caution' : 'bg-edge'
            }`}
          />
        ))}
      </div>
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
  const [notes, setNotes] = useState<Record<string, NoteEntry>>({})
  const [restSignal, setRestSignal] = useState(0)
  const [comebackDismissed, setComebackDismissed] = useState(false)
  // primary exercise ID → currently showing alternate
  const [swappedToAlt, setSwappedToAlt] = useState<Set<string>>(new Set())
  const [swapping, setSwapping] = useState<string | null>(null)

  const pendingUpdates = useRef<Map<string, Partial<SetLog>>>(new Map())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteFlushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Keep a ref so note flush closures always see the latest state
  const notesRef = useRef<Record<string, NoteEntry>>({})
  useEffect(() => { notesRef.current = notes }, [notes])

  async function buildStalenessMap(exercises: ExerciseTemplate[]): Promise<Record<string, number>> {
    const entries = await Promise.all(
      exercises.map(async ex => {
        const logs = await getSetLogsForExercise(ex.id, 20)
        return [ex.id, calcStaleness(ex.id, logs)] as const
      }),
    )
    return Object.fromEntries(entries)
  }

  async function loadAltExercises(exercises: ExerciseTemplate[]): Promise<Map<string, ExerciseTemplate>> {
    const alts = new Map<string, ExerciseTemplate>()
    const toFetch = exercises.filter(e => e.alternate_exercise_id)
    if (toFetch.length === 0) return alts
    await Promise.all(toFetch.map(async e => {
      const alt = await getExerciseTemplate(e.alternate_exercise_id!)
      if (alt) alts.set(e.id, alt)
    }))
    return alts
  }

  async function load() {
    try {
      let session: Session
      let template: WorkoutTemplate
      let setLogs: SetLog[]

      if (sessionId === 'new') {
        const templateId = searchParams.get('template')
        if (!templateId) throw new Error('No template specified')

        const templates = await getWorkoutTemplates(
          (await import('../lib/db').then(m => m.getActiveProgram()))?.id ?? '',
        )
        template = templates.find(t => t.id === templateId) ?? templates[0]

        const exercises = await getExerciseTemplates(templateId)

        // ── Comeback detection ─────────────────────────────────────────────
        const recentSessions = await getRecentCompletedSessionsForTemplate(templateId, 10)
        const comeback = detectComeback(recentSessions)

        // Display comparison ("prev" / delta badges) always uses the most
        // recent completed session; weight calculation uses the benchmark
        // session (pre-gap peak) during a comeback.
        const prevLogs = recentSessions[0] ? await getSetLogsForSession(recentSessions[0].id) : []
        let benchmarkLogs = prevLogs
        if (comeback && comeback.benchmarkSessionId !== recentSessions[0]?.id) {
          benchmarkLogs = await getSetLogsForSession(comeback.benchmarkSessionId)
        }

        session = await createSession(templateId)
        const newLogs = initializeSession(exercises, benchmarkLogs, comeback?.factor)
        setLogs = await createSetLogs(session.id, newLogs)

        navigate(`/workout/${session.id}`, { replace: true })

        const exercises2 = await getExerciseTemplates(templateId)
        const [stalenessMap, altExercises] = await Promise.all([
          buildStalenessMap(exercises2),
          loadAltExercises(exercises2),
        ])
        setData({ session, template, exercises: exercises2, setLogs, lastSetLogs: prevLogs, stalenessMap, comeback, altExercises })
        setNotes({})
      } else {
        if (!sessionId) throw new Error('No session ID')
        const { getInProgressSession } = await import('../lib/db')
        session = (await getInProgressSession()) ?? { id: sessionId } as Session

        const { getActiveProgram } = await import('../lib/db')
        const program = await getActiveProgram()
        const templates = await getWorkoutTemplates(program?.id ?? '')
        template = templates.find(t => t.id === session.workout_template_id) ?? templates[0]

        const exercises = await getExerciseTemplates(template.id)
        setLogs = await getSetLogsForSession(sessionId)

        // ── Comeback detection (resume path) ──────────────────────────────
        const recentSessions = await getRecentCompletedSessionsForTemplate(template.id, 10)
        const comeback = detectComeback(recentSessions)

        // Resume path only needs logs for display comparison — always the
        // most recent completed session (weights were already initialized).
        const firstRecent = recentSessions.find(s => s.id !== sessionId)
        const lastLogs = firstRecent ? await getSetLogsForSession(firstRecent.id) : []

        const [existingNotes, stalenessMap, altExercises] = await Promise.all([
          getExerciseNotes(sessionId),
          buildStalenessMap(exercises),
          loadAltExercises(exercises),
        ])
        const notesMap: Record<string, NoteEntry> = {}
        existingNotes.forEach(n => {
          notesMap[n.exercise_template_id] = { id: n.id, text: n.note }
        })

        setData({ session, template, exercises, setLogs, lastSetLogs: lastLogs, stalenessMap, comeback, altExercises })
        setNotes(notesMap)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workout')
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [sessionId])

  // ── Set log writes (debounced) ──────────────────────────────────────────────

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

    const parsed = value === '' ? null : parseFloat(value)
    const weight = parsed === null || isNaN(parsed) ? null : parsed
    const isOverride = weight !== log.target_weight
    updateLog(logId, { actual_weight: weight, is_weight_override: isOverride })

    // When top set weight changes, recalculate warmup + backoff targets for this exercise
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
    if (flushTimer.current) clearTimeout(flushTimer.current)
    await updateSetLog(logId, { completed: newCompleted })
    // Kick off rest timer when any non-warmup set is marked complete
    if (newCompleted && log.set_type !== 'warmup') {
      setRestSignal(s => s + 1)
    }
  }

  // ── Note writes (debounced 1.5 s) ──────────────────────────────────────────

  function handleNoteChange(exerciseId: string, text: string) {
    setNotes(prev => ({
      ...prev,
      [exerciseId]: { ...(prev[exerciseId] ?? {}), text },
    }))

    const existing = noteFlushTimers.current.get(exerciseId)
    if (existing) clearTimeout(existing)

    // Capture session ID and existing note ID now; text is fresh in the closure
    const sid = data?.session.id
    const existingId = notesRef.current[exerciseId]?.id

    const timer = setTimeout(async () => {
      if (!sid) return
      const saved = await saveExerciseNote(sid, exerciseId, text, existingId)
      if (saved) {
        setNotes(prev => ({ ...prev, [exerciseId]: { id: saved.id, text: saved.note } }))
      } else if (!text.trim()) {
        setNotes(prev => { const next = { ...prev }; delete next[exerciseId]; return next })
      }
    }, 1500)

    noteFlushTimers.current.set(exerciseId, timer)
  }

  async function handleCompleteSession() {
    if (!data) return
    setCompleting(true)

    // Flush debounced set-log writes
    if (flushTimer.current) clearTimeout(flushTimer.current)
    await flushPending()

    // Flush any pending note saves (save all non-empty notes)
    noteFlushTimers.current.forEach(t => clearTimeout(t))
    noteFlushTimers.current.clear()
    const latestNotes = notesRef.current
    await Promise.all(
      Object.entries(latestNotes)
        .filter(([, v]) => v.text.trim())
        .map(([exerciseId, v]) =>
          saveExerciseNote(data.session.id, exerciseId, v.text, v.id),
        ),
    )

    const { completeSession } = await import('../lib/db')
    await completeSession(data.session.id)
    navigate(`/summary/${data.session.id}`, { replace: true })
  }

  function handleSkip(exerciseId: string, skip: boolean) {
    setSkipped(prev => {
      const next = new Set(prev)
      if (skip) next.add(exerciseId)
      else next.delete(exerciseId)
      return next
    })
  }

  async function handleSwap(primaryExerciseId: string) {
    if (!data || swapping) return

    if (swappedToAlt.has(primaryExerciseId)) {
      setSwappedToAlt(prev => { const next = new Set(prev); next.delete(primaryExerciseId); return next })
      return
    }

    const altExercise = data.altExercises.get(primaryExerciseId)
    if (!altExercise) return

    setSwapping(primaryExerciseId)
    try {
      // Only create set logs for the alternate once per session
      const altLogsExist = data.setLogs.some(l => l.exercise_template_id === altExercise.id)
      if (!altLogsExist) {
        const altPrevLogs = await getSetLogsForExercise(altExercise.id, 20)
        const newLogs = initializeSession([altExercise], altPrevLogs, data.comeback?.factor)
        const created = await createSetLogs(data.session.id, newLogs)
        setData(prev => prev ? { ...prev, setLogs: [...prev.setLogs, ...created] } : prev)
      }
      setSwappedToAlt(prev => new Set(prev).add(primaryExerciseId))
    } finally {
      setSwapping(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

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

  const allWorkingSetsComplete = setLogs
    .filter(l => !skipped.has(l.exercise_template_id) && (l.set_type === 'top' || l.set_type === 'working' || l.set_type === 'backoff'))
    .every(l => l.completed)

  // Group consecutive superset exercises so they can be rendered together
  const exerciseGroups: ExerciseGroup[] = []
  let i = 0
  while (i < exercises.length) {
    const e = exercises[i]
    if (e.superset_group) {
      const group: ExerciseTemplate[] = [e]
      while (i + 1 < exercises.length && exercises[i + 1].superset_group === e.superset_group) {
        i++
        group.push(exercises[i])
      }
      // Only render as a grouped block if ≥2 exercises share the tag
      exerciseGroups.push(group.length > 1 ? { superset: e.superset_group, items: group } : e)
    } else {
      exerciseGroups.push(e)
    }
    i++
  }

  function renderCard(primaryExercise: ExerciseTemplate) {
    const isSwapped = swappedToAlt.has(primaryExercise.id)
    const altExercise = data!.altExercises?.get(primaryExercise.id)
    const activeExercise = isSwapped && altExercise ? altExercise : primaryExercise

    const exerciseSets = setLogs
      .filter(l => l.exercise_template_id === activeExercise.id)
      .sort((a, b) => a.set_index - b.set_index)
    const prevExerciseSets = data!.lastSetLogs
      .filter(l => l.exercise_template_id === activeExercise.id)
      .sort((a, b) => a.set_index - b.set_index)

    // The label shown on the swap button is always the OTHER option
    const altName = isSwapped ? primaryExercise.name : (altExercise?.name ?? null)

    return (
      <ExerciseCard
        key={primaryExercise.id}
        exercise={activeExercise}
        sets={exerciseSets}
        prevSets={prevExerciseSets}
        note={notes[activeExercise.id] ?? { text: '' }}
        staleness={data!.stalenessMap[activeExercise.id] ?? 0}
        skipped={skipped.has(primaryExercise.id)}
        altName={altName}
        isSwapped={isSwapped}
        onSwap={altExercise ? () => handleSwap(primaryExercise.id) : undefined}
        swapping={swapping === primaryExercise.id}
        onWeightChange={handleWeightChange}
        onRepsChange={handleRepsChange}
        onToggleComplete={handleToggleComplete}
        onSkip={(_, s) => handleSkip(primaryExercise.id, s)}
        onNoteChange={handleNoteChange}
      />
    )
  }

  return (
    <div className="min-h-screen">
      <RestTimer startSignal={restSignal} />
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70"
            aria-label="Back to home"
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

        {/* Comeback banner */}
        {data.comeback && !comebackDismissed && (
          <ComebackBanner
            info={data.comeback}
            onDismiss={() => setComebackDismissed(true)}
          />
        )}

        {/* Warmup */}
        {template.warmup_text && (
          <CollapsibleBlock title="Warmup" text={template.warmup_text} />
        )}

        {/* Exercise cards — supersets get a visual left-bar connector */}
        {exerciseGroups.map(group => {
          if ('superset' in group) {
            return (
              <div key={group.superset} className="flex gap-2.5">
                {/* Vertical accent line connecting the group */}
                <div className="flex flex-col items-center pt-6 pb-1 shrink-0">
                  <div className="w-0.5 flex-1 bg-accent/25 rounded-full" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <p className="text-xs text-accent/70 font-semibold uppercase tracking-widest px-1">
                    Superset
                  </p>
                  {group.items.map(renderCard)}
                </div>
              </div>
            )
          }
          return renderCard(group as ExerciseTemplate)
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
