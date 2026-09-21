import type { BarType, ExerciseTemplate, NewSetLog, Session, SetLog, WorkoutTemplate } from '../types'

// ─── Bar type ────────────────────────────────────────────────────────────────

/** Standard bar weights in lbs. Returns null for exercises that use no bar. */
export function barWeightForType(barType: BarType): number | null {
  switch (barType) {
    case 'barbell':          return 45
    case 'ez_bar':           return 25
    case 'hex_bar':          return 45
    case 'safety_squat_bar': return 65
    case 'none':             return null
  }
}

// ─── Comeback detection ─────────────────────────────────────────────────────

export interface ComebackInfo {
  /** The session whose weights are the recovery target. */
  benchmarkSessionId: string
  /** Days between the benchmark session and the first session after the gap. */
  gapDays: number
  /** How many comeback sessions have already been completed (0 = first one). */
  comebackSessionsDone: number
  /** Total comeback sessions prescribed before returning to full weight. */
  comebackSessionsTotal: number
  /** Weight multiplier to apply this session (0.65 – 1.0). */
  factor: number
  /** Convenience: sessionsTotal − sessionsDone. */
  sessionsRemaining: number
}

function daysBetween(earlier: string | Date, later: string | Date): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 86_400_000
}

/** Returns total comeback sessions and starting weight factor for a given gap. */
function comebackParams(gapDays: number): { total: number; startFactor: number } {
  if (gapDays < 21) return { total: 2, startFactor: 0.85 }
  if (gapDays < 42) return { total: 3, startFactor: 0.75 }
  if (gapDays < 84) return { total: 4, startFactor: 0.65 }
  return                    { total: 4, startFactor: 0.60 }
}

/**
 * Linearly interpolates from startFactor → 1.0 over `total` sessions,
 * so the final comeback session always lands at full benchmark weight.
 */
function comebackFactor(gapDays: number, sessionsDone: number): number {
  const { total, startFactor } = comebackParams(gapDays)
  if (sessionsDone >= total) return 1
  // total−1 steps from startFactor to 1.0; last step = 1.0
  const t = total === 1 ? 1 : sessionsDone / (total - 1)
  return startFactor + (1 - startFactor) * t
}

/**
 * Scans recent *completed* sessions (newest-first) to determine whether the
 * next session should be a comeback session.
 *
 * @param sessions  Completed sessions for this workout template, newest-first.
 * @param now       Treated as "start of the new session" (injectable for tests).
 */
export function detectComeback(
  sessions: Session[],
  now: Date = new Date(),
): ComebackInfo | null {
  if (sessions.length === 0) return null

  const GAP_THRESHOLD = 14 // days

  // ── Case 1: gap is between the last session and right now ──────────────────
  const daysSinceLast = daysBetween(sessions[0].completed_at!, now)
  if (daysSinceLast >= GAP_THRESHOLD) {
    const { total, startFactor } = comebackParams(daysSinceLast)
    return {
      benchmarkSessionId:    sessions[0].id,
      gapDays:               Math.round(daysSinceLast),
      comebackSessionsDone:  0,
      comebackSessionsTotal: total,
      factor:                startFactor,
      sessionsRemaining:     total,
    }
  }

  // ── Case 2: we're in the middle of a comeback ──────────────────────────────
  // sessions[i-1] is a post-gap session; sessions[i] is the benchmark.
  for (let i = 1; i < sessions.length; i++) {
    const gap = daysBetween(sessions[i].completed_at!, sessions[i - 1].started_at)
    if (gap >= GAP_THRESHOLD) {
      const done = i // i sessions completed since the gap
      const { total } = comebackParams(gap)
      if (done >= total) return null // comeback already complete
      const factor = comebackFactor(gap, done)
      return {
        benchmarkSessionId:    sessions[i].id,
        gapDays:               Math.round(gap),
        comebackSessionsDone:  done,
        comebackSessionsTotal: total,
        factor,
        sessionsRemaining:     total - done,
      }
    }
  }

  return null
}

// ─── Weight calculations ────────────────────────────────────────────────────

export function calcWarmupWeight(
  topSetWeight: number,
  percentage: number,
  roundingIncrement: number = 5,
  barWeight: number = 45,
): number {
  // 0% means "the empty bar" — which is 25 on an EZ bar, 65 on an SSB, etc.
  if (percentage === 0) return barWeight
  const raw = topSetWeight * percentage
  return Math.round(raw / roundingIncrement) * roundingIncrement
}

/**
 * Single primer set for dumbbell work. The default is a much higher fraction
 * of the working weight than a barbell warmup uses: dumbbell loads are small
 * in absolute terms, so a barbell-style low percentage lands on a weight too
 * light to prime anything (32.5% of a 40 lb dumbbell is 13 lb).
 */
export function calcDumbbellWarmup(
  workingWeight: number,
  dbPercentage: number = 0.6,
  roundingIncrement: number = 5,
): number {
  const raw = workingWeight * dbPercentage
  return Math.round(raw / roundingIncrement) * roundingIncrement
}

export function calcBackoffWeight(
  topSetWeight: number,
  backoffPercentage: number,
  roundingIncrement: number = 5,
): number {
  const raw = topSetWeight * backoffPercentage
  return Math.round(raw / roundingIncrement) * roundingIncrement
}

// ─── Rep range parsing ──────────────────────────────────────────────────────

/** '2-4' → 4 | 'AMRAP' → null | '8' → 8 */
export function parseRepRangeMax(repTarget: string): number | null {
  if (repTarget.toUpperCase() === 'AMRAP') return null
  const parts = repTarget.split('-')
  const parsed = parseInt(parts[parts.length - 1], 10)
  return isNaN(parsed) ? null : parsed
}

// ─── Progression ────────────────────────────────────────────────────────────

export function hasEarnedProgression(repTarget: string, actualReps: number): boolean {
  const max = parseRepRangeMax(repTarget)
  if (max === null) return false // AMRAP never auto-triggers
  return actualReps >= max
}

// ─── Staleness ──────────────────────────────────────────────────────────────

/**
 * Counts consecutive prior sessions where the top set weight did not increase
 * compared to the most recent session. Stops as soon as a lower weight is found
 * (meaning a progression happened at that point).
 *
 * Expects setLogs for a single exercise, ordered newest-first.
 * Returns 0 if fewer than two top-set data points exist.
 */
export function calcStaleness(exerciseTemplateId: string, setLogs: SetLog[]): number {
  const topSets = setLogs.filter(
    l => l.exercise_template_id === exerciseTemplateId &&
         l.set_type === 'top' &&
         l.actual_weight !== null,
  )

  if (topSets.length < 2) return 0

  const currentWeight = topSets[0].actual_weight!
  let count = 0

  for (let i = 1; i < topSets.length; i++) {
    const w = topSets[i].actual_weight!
    if (w < currentWeight) break // weight was lower in the past → progression happened, stop
    count++ // weight was the same (or somehow higher) → another stale session
  }

  return count
}

// ─── Next workout ───────────────────────────────────────────────────────────

/**
 * Returns the next WorkoutTemplate to run based on the most recently completed
 * session. Sessions must be ordered newest-first. Templates must belong to the
 * same program and be sorted by order_in_program.
 */
export function getNextWorkoutTemplate(
  sessions: Session[],
  templates: WorkoutTemplate[],
): WorkoutTemplate {
  if (sessions.length === 0) return templates[0]

  const lastTemplateId = sessions[0].workout_template_id
  const lastTemplate = templates.find(t => t.id === lastTemplateId)

  if (!lastTemplate) return templates[0]

  const nextOrder = (lastTemplate.order_in_program + 1) % templates.length
  return templates.find(t => t.order_in_program === nextOrder) ?? templates[0]
}

// ─── Weekly schedule ─────────────────────────────────────────────────────────

/** A program is "weekly" as soon as any of its workouts is pinned to days. */
export function isWeeklyProgram(templates: WorkoutTemplate[]): boolean {
  return templates.some(t => (t.scheduled_days?.length ?? 0) > 0)
}

/** Mon = 0 … Sun = 6 — the training week runs Monday through Sunday. */
function mondayIndex(jsWeekday: number): number {
  return (jsWeekday + 6) % 7
}

/** Monday 00:00 local time of the week containing `now`. */
export function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - mondayIndex(d.getDay()))
  return d
}

export type WeekSlotStatus = 'done' | 'today' | 'upcoming' | 'missed' | 'skipped'

export interface WeekSlot {
  template: WorkoutTemplate
  /** Monday-first indices of the days this workout belongs to. */
  days: number[]
  status: WeekSlotStatus
}

/**
 * This week's plan: one slot per scheduled workout, in weekday order, with
 * its status. A workout spanning several days (e.g. Fri/Sat) is done once
 * any session of it completes this week. Unfinished optional workouts whose
 * days have passed read as "skipped", required ones as "missed".
 */
export function buildWeekPlan(
  templates: WorkoutTemplate[],
  completedSessions: Session[],
  now: Date = new Date(),
): WeekSlot[] {
  const weekStart = startOfWeek(now).getTime()
  const today = mondayIndex(now.getDay())
  const doneThisWeek = new Set(
    completedSessions
      .filter(s => s.completed_at && new Date(s.completed_at).getTime() >= weekStart)
      .map(s => s.workout_template_id),
  )

  return templates
    .filter(t => (t.scheduled_days?.length ?? 0) > 0)
    .map(t => {
      const days = t.scheduled_days!.map(mondayIndex).sort((a, b) => a - b)
      let status: WeekSlotStatus
      if (doneThisWeek.has(t.id)) status = 'done'
      else if (days.includes(today)) status = 'today'
      else if (days[days.length - 1] < today) status = t.is_optional ? 'skipped' : 'missed'
      else status = 'upcoming'
      return { template: t, days, status }
    })
    .sort((a, b) => a.days[0] - b.days[0])
}

/**
 * The workout to feature on the home screen: today's if it isn't done, else
 * the next required one this week, else a missed one to catch up on.
 */
export function pickFeaturedSlot(plan: WeekSlot[]): WeekSlot | null {
  return plan.find(s => s.status === 'today')
    ?? plan.find(s => s.status === 'upcoming' && !s.template.is_optional)
    ?? plan.find(s => s.status === 'missed')
    ?? plan.find(s => s.status === 'upcoming')
    ?? null
}

// ─── Movement history ────────────────────────────────────────────────────────

/** Identity shared by every copy of a lift across programs. */
export function movementKey(ex: Pick<ExerciseTemplate, 'id' | 'movement_id'>): string {
  return ex.movement_id ?? ex.id
}

/** A set log from a completed session, carrying that session's timestamps. */
export type HistoryLog = SetLog & {
  session_started_at: string
  session_completed_at: string
}

export interface ExercisePlan {
  /** Logs each exercise's weights derive from, remapped onto its own id:
   *  its last performance, or its pre-gap benchmark during a comeback. */
  refLogs: SetLog[]
  /** Each exercise's last performance, remapped — the "previous" that
   *  deltas and the post-workout comparison measure against. */
  lastLogs: SetLog[]
  /** Comeback state keyed by exercise id; absent = not in a comeback. */
  comebacks: Record<string, ComebackInfo>
}

const PERFORMED_SET_TYPES = new Set<SetLog['set_type']>(['top', 'working', 'amrap'])

/** The weight a session's main set was done at: the top set, else the first working set. */
function mainSetWeight(logs: SetLog[]): number | null {
  const main =
    logs.find(l => l.set_type === 'top' && l.completed) ??
    logs.find(l => (l.set_type === 'working' || l.set_type === 'amrap') && l.completed)
  return main ? (main.actual_weight ?? main.target_weight) : null
}

/**
 * Resolves what each exercise's session should build from, using the whole
 * history of its movement rather than the workout it happens to sit in.
 *
 * Per exercise: the last session that actually *performed* the movement
 * (skips don't count) supplies the weights; a 14+ day gap in that
 * movement's own history triggers a comeback ramp for that exercise alone.
 * Logs are remapped onto the exercise's own id so initializeSession and the
 * set rows can match them directly.
 *
 * @param movementOf  maps a log's exercise_template_id to its movement key
 */
export function planFromHistory(
  exercises: ExerciseTemplate[],
  logs: HistoryLog[],
  movementOf: (exerciseTemplateId: string) => string,
  now: Date = new Date(),
): ExercisePlan {
  const refLogs: SetLog[] = []
  const lastLogs: SetLog[] = []
  const comebacks: Record<string, ComebackInfo> = {}

  for (const ex of exercises) {
    const key = movementKey(ex)
    const bySession = new Map<string, HistoryLog[]>()
    for (const l of logs) {
      if (movementOf(l.exercise_template_id) !== key) continue
      const list = bySession.get(l.session_id) ?? []
      list.push(l)
      bySession.set(l.session_id, list)
    }

    const sessions = [...bySession.entries()]
      .map(([id, ls]) => ({
        id,
        logs: ls,
        startedAt: ls[0].session_started_at,
        completedAt: ls[0].session_completed_at,
        performed: ls.some(l => PERFORMED_SET_TYPES.has(l.set_type) && l.completed),
      }))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    const performed = sessions.filter(s => s.performed)

    const remap = (ls: HistoryLog[]): SetLog[] =>
      ls.map(l => ({ ...l, exercise_template_id: ex.id }))

    // Never performed → newest logs anyway, so rep prefill still has a source
    const last = performed[0] ?? sessions[0]
    if (last) lastLogs.push(...remap(last.logs))

    const comeback = detectComeback(
      performed.map(s => ({
        id: s.id,
        profile_id: '',
        workout_template_id: '',
        started_at: s.startedAt,
        completed_at: s.completedAt,
        notes: null,
      })),
      now,
    )
    // A comeback exists to protect against lost strength. Once a session
    // since the layoff has matched the pre-gap weight, the ramp is moot —
    // otherwise someone who returns at full strength gets held back anyway.
    let active = comeback
    if (comeback) {
      const benchIdx = performed.findIndex(s => s.id === comeback.benchmarkSessionId)
      const benchWeight = benchIdx >= 0 ? mainSetWeight(performed[benchIdx].logs) : null
      const recovered = benchWeight !== null && performed
        .slice(0, benchIdx)   // sessions since the gap, newest-first
        .some(s => (mainSetWeight(s.logs) ?? -Infinity) >= benchWeight)
      if (recovered) active = null
    }

    if (active) {
      comebacks[ex.id] = active
      const benchmark = performed.find(s => s.id === active.benchmarkSessionId)
      if (benchmark) refLogs.push(...remap(benchmark.logs))
    } else if (last) {
      refLogs.push(...remap(last.logs))
    }
  }

  return { refLogs, lastLogs, comebacks }
}

// ─── Session initialization ─────────────────────────────────────────────────

/**
 * Returns the suggested starting weight for the next session of a given exercise.
 *
 * Normal mode  – checks whether progression was earned and bumps the weight.
 * Comeback mode – applies `factor` to the benchmark weight; skips progression.
 */
function getSuggestedWeight(
  ex: ExerciseTemplate,
  lastSetLogs: SetLog[],
  factor?: number,       // when set, we're in comeback mode
): number | null {
  // ── Get raw benchmark weight (no progression) ──────────────────────────────
  let base: number

  if (ex.working_set_type === 'top_set') {
    const topSet = lastSetLogs.find(
      l => l.exercise_template_id === ex.id && l.set_type === 'top' && l.completed,
    )
    const topWeight = topSet?.actual_weight ?? topSet?.target_weight ?? null
    if (!topWeight) return null
    base = topWeight

    // Normal mode: check progression
    if (factor === undefined &&
        topSet?.actual_reps != null &&
        ex.working_rep_target &&
        hasEarnedProgression(ex.working_rep_target, topSet.actual_reps)) {
      base = base + ex.weight_increment
    }
  } else {
    // straight_sets or amrap
    const workingSets = lastSetLogs.filter(
      l =>
        l.exercise_template_id === ex.id &&
        (l.set_type === 'working' || l.set_type === 'amrap') &&
        l.completed &&
        (l.actual_weight !== null || l.target_weight !== null),
    )
    if (workingSets.length === 0) return null
    base = workingSets[0].actual_weight ?? workingSets[0].target_weight!

    // Normal mode: check progression for straight sets
    if (
      factor === undefined &&
      ex.working_set_type === 'straight_sets' &&
      ex.working_rep_target &&
      workingSets.length >= ex.working_set_count &&
      workingSets.every(
        l => l.actual_reps !== null && hasEarnedProgression(ex.working_rep_target!, l.actual_reps!),
      )
    ) {
      base = base + ex.weight_increment
    }
  }

  // ── Comeback mode: scale and round ─────────────────────────────────────────
  if (factor !== undefined) {
    return Math.round((base * factor) / ex.rounding_increment) * ex.rounding_increment
  }

  return base
}

/** Returns the actual_reps logged for a specific set in the previous session, or null if none. */
function getPrevRepsForSet(
  exerciseTemplateId: string,
  setType: NewSetLog['set_type'],
  setIndex: number,
  lastSetLogs: SetLog[],
): number | null {
  return lastSetLogs.find(
    l =>
      l.exercise_template_id === exerciseTemplateId &&
      l.set_type === setType &&
      l.set_index === setIndex,
  )?.actual_reps ?? null
}

/**
 * Generates pre-populated NewSetLog rows for a new session.
 *
 * - exerciseTemplates: all exercises for the workout, sorted by position
 * - lastSetLogs: set_logs from the reference session (most recent in normal
 *   mode; benchmark session in comeback mode). Pass [] for first-ever session.
 * - comebackFactor: when provided, skips progression and scales the benchmark
 *   weight by this multiplier (0 < factor ≤ 1). Either one factor for every
 *   exercise, or a map keyed by exercise id (exercises absent from it are
 *   not in a comeback).
 */
export function initializeSession(
  exerciseTemplates: ExerciseTemplate[],
  lastSetLogs: SetLog[],
  comebackFactor?: number | Record<string, number>,
): NewSetLog[] {
  const result: NewSetLog[] = []
  const sorted = [...exerciseTemplates].sort((a, b) => a.position - b.position)

  for (const ex of sorted) {
    let setIndex = 0
    const factor = typeof comebackFactor === 'number' ? comebackFactor : comebackFactor?.[ex.id]
    const workingWeight = getSuggestedWeight(ex, lastSetLogs, factor)

    // Warmup sets
    if (ex.warmup_rule !== 'none' && workingWeight !== null) {
      if (
        ex.warmup_rule === 'percentage_of_top_set' &&
        ex.warmup_percentages &&
        ex.warmup_reps
      ) {
        for (let i = 0; i < ex.warmup_percentages.length; i++) {
          const idx = setIndex++
          result.push({
            exercise_template_id: ex.id,
            set_index: idx,
            set_type: 'warmup',
            target_weight: calcWarmupWeight(
              workingWeight,
              ex.warmup_percentages[i],
              ex.rounding_increment,
              barWeightForType(ex.bar_type) ?? 45,
            ),
            actual_weight: null,
            target_reps: String(ex.warmup_reps[i]),
            // Warmup reps pre-fill from the prescription itself (not history):
            // one checkbox tap logs the set, no typing
            actual_reps: ex.warmup_reps[i],
            is_weight_override: false,
            completed: false,
          })
        }
      } else if (ex.warmup_rule === 'dumbbell_percentage') {
        const idx = setIndex++
        result.push({
          exercise_template_id: ex.id,
          set_index: idx,
          set_type: 'warmup',
          target_weight: calcDumbbellWarmup(
            workingWeight,
            ex.warmup_db_percentage ?? 0.325,
            ex.rounding_increment,
          ),
          actual_weight: null,
          target_reps: String(ex.warmup_db_reps ?? 10),
          actual_reps: ex.warmup_db_reps ?? 10,
          is_weight_override: false,
          completed: false,
        })
      } else if (ex.warmup_rule === 'fixed_weight') {
        const idx = setIndex++
        result.push({
          exercise_template_id: ex.id,
          set_index: idx,
          set_type: 'warmup',
          target_weight: ex.warmup_fixed_weight ?? 0,
          actual_weight: null,
          target_reps: String(ex.warmup_fixed_reps ?? 10),
          actual_reps: ex.warmup_fixed_reps ?? 10,
          is_weight_override: false,
          completed: false,
        })
      }
    }

    // Working sets
    if (ex.working_set_type === 'top_set') {
      const idx = setIndex++
      result.push({
        exercise_template_id: ex.id,
        set_index: idx,
        set_type: 'top',
        target_weight: workingWeight,
        actual_weight: null,
        target_reps: ex.working_rep_target,
        actual_reps: getPrevRepsForSet(ex.id, 'top', idx, lastSetLogs),
        is_weight_override: false,
        completed: false,
      })

      // Backoff sets
      if (ex.backoff_set_count > 0 && workingWeight !== null && ex.backoff_percentage) {
        const backoffWeight = calcBackoffWeight(
          workingWeight,
          ex.backoff_percentage,
          ex.rounding_increment,
        )
        for (let i = 0; i < ex.backoff_set_count; i++) {
          const idx = setIndex++
          result.push({
            exercise_template_id: ex.id,
            set_index: idx,
            set_type: 'backoff',
            target_weight: backoffWeight,
            actual_weight: null,
            target_reps: ex.backoff_rep_target,
            actual_reps: getPrevRepsForSet(ex.id, 'backoff', idx, lastSetLogs),
            is_weight_override: false,
            completed: false,
          })
        }
      }
    } else {
      const setType = ex.working_set_type === 'amrap' ? 'amrap' : 'working'
      for (let i = 0; i < ex.working_set_count; i++) {
        const idx = setIndex++
        result.push({
          exercise_template_id: ex.id,
          set_index: idx,
          set_type: setType,
          target_weight: workingWeight,
          actual_weight: null,
          target_reps: ex.working_rep_target,
          actual_reps: getPrevRepsForSet(ex.id, setType, idx, lastSetLogs),
          is_weight_override: false,
          completed: false,
        })
      }
    }
  }

  return result
}
