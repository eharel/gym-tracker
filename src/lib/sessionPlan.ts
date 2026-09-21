import { getExerciseTemplates, getMovementHistory } from './db'
import { planFromHistory, type ComebackInfo } from './calculations'
import type { ExerciseTemplate, SetLog } from '../types'

export interface SessionPlan {
  /** Every exercise in the workout, alternate-only ones included. */
  allExercises: ExerciseTemplate[]
  /** What renders as cards (alternate-only exercises excluded). */
  exercises: ExerciseTemplate[]
  /** See ExercisePlan.refLogs — what each exercise's weights derive from. */
  refLogs: SetLog[]
  /** See ExercisePlan.lastLogs — each exercise's last performance. */
  lastLogs: SetLog[]
  /** Comeback state per exercise id, alternates included. */
  comebacks: Record<string, ComebackInfo>
  /** The comeback factors keyed by exercise id, as initializeSession takes them. */
  factors: Record<string, number>
}

/**
 * Everything a workout needs to set itself up, built from each exercise's
 * movement history rather than the workout's own past sessions — so moving
 * a lift to another day or program keeps its weights, deltas and comeback.
 *
 * @param excludeSessionId  leave out a session in progress (resuming it)
 * @param now               reference time for comeback detection; pass the
 *                          session's start when resuming so the state matches
 *                          what it was initialized with
 */
export async function planSession(
  workoutTemplateId: string,
  opts: { excludeSessionId?: string; now?: Date } = {},
): Promise<SessionPlan> {
  const allExercises = await getExerciseTemplates(workoutTemplateId)
  const exercises = allExercises.filter(e => !e.is_alternate_only)
  const { logs, movementOf } = await getMovementHistory(allExercises, {
    excludeSessionId: opts.excludeSessionId,
  })
  const { refLogs, lastLogs, comebacks } = planFromHistory(allExercises, logs, movementOf, opts.now)
  const factors = Object.fromEntries(
    Object.entries(comebacks).map(([id, c]) => [id, c.factor]),
  )
  return { allExercises, exercises, refLogs, lastLogs, comebacks, factors }
}

export interface ComebackSummary {
  /** Longest layoff among the exercises that are ramping back up. */
  gapDays: number
  /** How many of them are. */
  count: number
}

/** Banner summary for the given exercises; null when none is in a comeback. */
export function summarizeComebacks(
  comebacks: Record<string, ComebackInfo>,
  exerciseIds: string[],
): ComebackSummary | null {
  const active = exerciseIds.map(id => comebacks[id]).filter((c): c is ComebackInfo => c != null)
  if (active.length === 0) return null
  return {
    gapDays: Math.max(...active.map(c => c.gapDays)),
    count: active.length,
  }
}
