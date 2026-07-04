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
): number {
  if (percentage === 0) return 45 // empty bar, always
  const raw = topSetWeight * percentage
  return Math.round(raw / roundingIncrement) * roundingIncrement
}

export function calcDumbbellWarmup(
  workingWeight: number,
  dbPercentage: number = 0.325,
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
 *   weight by this multiplier (0 < factor ≤ 1).
 */
export function initializeSession(
  exerciseTemplates: ExerciseTemplate[],
  lastSetLogs: SetLog[],
  comebackFactor?: number,
): NewSetLog[] {
  const result: NewSetLog[] = []
  const sorted = [...exerciseTemplates].sort((a, b) => a.position - b.position)

  for (const ex of sorted) {
    let setIndex = 0
    const workingWeight = getSuggestedWeight(ex, lastSetLogs, comebackFactor)

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
