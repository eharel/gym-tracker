import type { ExerciseTemplate, NewSetLog, Session, SetLog, WorkoutTemplate } from '../types'

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
 * If the previous session earned progression (hit the top of the rep range for all
 * required sets), the weight is automatically bumped by the exercise's increment.
 */
function getSuggestedWeight(ex: ExerciseTemplate, lastSetLogs: SetLog[]): number | null {
  if (ex.working_set_type === 'top_set') {
    const topSet = lastSetLogs.find(
      l => l.exercise_template_id === ex.id && l.set_type === 'top' && l.completed,
    )
    if (!topSet?.actual_weight) return null
    if (
      topSet.actual_reps !== null &&
      ex.working_rep_target &&
      hasEarnedProgression(ex.working_rep_target, topSet.actual_reps)
    ) {
      return topSet.actual_weight + ex.weight_increment
    }
    return topSet.actual_weight
  }

  // straight_sets or amrap
  const workingSets = lastSetLogs.filter(
    l =>
      l.exercise_template_id === ex.id &&
      (l.set_type === 'working' || l.set_type === 'amrap') &&
      l.completed &&
      l.actual_weight !== null,
  )
  if (workingSets.length === 0) return null
  const lastWeight = workingSets[0].actual_weight!

  if (
    ex.working_set_type === 'straight_sets' &&
    ex.working_rep_target &&
    workingSets.length >= ex.working_set_count &&
    workingSets.every(
      l => l.actual_reps !== null && hasEarnedProgression(ex.working_rep_target!, l.actual_reps!),
    )
  ) {
    return lastWeight + ex.weight_increment
  }

  return lastWeight
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
 * - lastSetLogs: set_logs from the most recent completed session of the same
 *   workout template. Pass [] for the first-ever session of a given workout —
 *   target weights will be null and the UI should prompt the user to confirm
 *   starting weights.
 */
export function initializeSession(
  exerciseTemplates: ExerciseTemplate[],
  lastSetLogs: SetLog[],
): NewSetLog[] {
  const result: NewSetLog[] = []
  const sorted = [...exerciseTemplates].sort((a, b) => a.position - b.position)

  for (const ex of sorted) {
    let setIndex = 0
    const workingWeight = getSuggestedWeight(ex, lastSetLogs)

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
            actual_reps: getPrevRepsForSet(ex.id, 'warmup', idx, lastSetLogs),
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
          actual_reps: getPrevRepsForSet(ex.id, 'warmup', idx, lastSetLogs),
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
          actual_reps: getPrevRepsForSet(ex.id, 'warmup', idx, lastSetLogs),
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
