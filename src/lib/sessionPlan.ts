import { getExerciseTemplates, getMovementHistory, getProfileCompletedSessions } from './db'
import { detectLayoff, planFromHistory, type ComebackInfo } from './calculations'
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
 * Comebacks come from a layoff in the person's whole training history.
 *
 * @param excludeSessionId  leave out a session in progress (resuming it)
 * @param now               reference time for layoff detection; pass the
 *                          session's start when resuming so the state matches
 *                          what it was initialized with
 */
export async function planSession(
  workoutTemplateId: string,
  opts: { excludeSessionId?: string; now?: Date } = {},
): Promise<SessionPlan> {
  const allExercises = await getExerciseTemplates(workoutTemplateId)
  const exercises = allExercises.filter(e => !e.is_alternate_only)
  const [{ logs, movementOf }, sessions] = await Promise.all([
    getMovementHistory(allExercises, { excludeSessionId: opts.excludeSessionId }),
    getProfileCompletedSessions(),
  ])
  const layoff = detectLayoff(
    sessions.filter(s => s.id !== opts.excludeSessionId),
    opts.now,
  )
  const { refLogs, lastLogs, comebacks } = planFromHistory(allExercises, logs, movementOf, layoff)
  const factors = Object.fromEntries(
    Object.entries(comebacks).map(([id, c]) => [id, c.factor]),
  )
  return { allExercises, exercises, refLogs, lastLogs, comebacks, factors }
}

export interface ComebackSummary {
  /** Length of the break being recovered from. */
  gapDays: number
  /** The lifts still ramping, with the percentage each is at. */
  lifts: { name: string; percent: number }[]
}

/** Banner summary for the given exercises; null when none is in a comeback. */
export function summarizeComebacks(
  comebacks: Record<string, ComebackInfo>,
  exercises: ExerciseTemplate[],
): ComebackSummary | null {
  const lifts = exercises
    .filter(e => comebacks[e.id])
    .map(e => ({ name: e.name, percent: Math.round(comebacks[e.id].factor * 100) }))
  if (lifts.length === 0) return null
  return {
    gapDays: Math.max(...exercises.filter(e => comebacks[e.id]).map(e => comebacks[e.id].gapDays)),
    lifts,
  }
}

/** "Squat 75%, Bench 75%, RDL 75% +2 more" — names the lifts, briefly. */
export function describeComebackLifts(summary: ComebackSummary): string {
  const shown = summary.lifts.slice(0, 3).map(l => `${l.name} ${l.percent}%`).join(', ')
  const more = summary.lifts.length - 3
  return more > 0 ? `${shown} +${more} more` : shown
}
