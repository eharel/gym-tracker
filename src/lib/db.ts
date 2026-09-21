import { supabase } from './supabase'
import { requireProfileId } from '../store/profile'
import { movementKey, type HistoryLog } from './calculations'
import type {
  ExerciseNote,
  ExerciseTemplate,
  NewSetLog,
  Program,
  Session,
  SetLog,
  UserSettings,
  WorkoutTemplate,
} from '../types'

// User-owned root tables (programs, sessions, user_settings) are scoped to
// the current profile via requireProfileId(). Child tables (templates,
// exercises, set_logs, notes) inherit scope through their parent's id.

// ─── Programs ───────────────────────────────────────────────────────────────

export async function getActiveProgram(): Promise<Program | null> {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('profile_id', requireProfileId())
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Every program belonging to the current profile, oldest first. */
export async function getPrograms(): Promise<Program[]> {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('profile_id', requireProfileId())
    .order('created_at')
  if (error) throw error
  return data ?? []
}

/** Makes one program active and every other program of the profile inactive. */
export async function setActiveProgram(programId: string): Promise<void> {
  const profileId = requireProfileId()
  const { error: offErr } = await supabase
    .from('programs')
    .update({ is_active: false })
    .eq('profile_id', profileId)
    .neq('id', programId)
  if (offErr) throw offErr
  const { error } = await supabase
    .from('programs')
    .update({ is_active: true })
    .eq('id', programId)
    .eq('profile_id', profileId)
  if (error) throw error
}

/** Creates a program with two empty workout templates — the first-run path
 *  for a new profile. */
export async function createStarterProgram(name: string): Promise<Program> {
  const { data: program, error } = await supabase
    .from('programs')
    .insert({ name, is_active: true, profile_id: requireProfileId() })
    .select()
    .single()
  if (error) throw error

  const { error: tErr } = await supabase.from('workout_templates').insert([
    { program_id: program.id, name: 'Workout A', order_in_program: 0 },
    { program_id: program.id, name: 'Workout B', order_in_program: 1 },
  ])
  if (tErr) throw tErr
  return program
}

// ─── Workout templates ───────────────────────────────────────────────────────

export async function getWorkoutTemplates(programId: string): Promise<WorkoutTemplate[]> {
  const { data, error } = await supabase
    .from('workout_templates')
    .select('*')
    .eq('program_id', programId)
    .order('order_in_program')
  if (error) throw error
  return data
}

/** One workout by id, whichever program it belongs to — sessions must bind to
 *  their own workout even when a different program is active. */
export async function getWorkoutTemplate(id: string): Promise<WorkoutTemplate | null> {
  const { data, error } = await supabase
    .from('workout_templates')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

// ─── Exercise templates ──────────────────────────────────────────────────────

export async function getExerciseTemplates(workoutTemplateId: string): Promise<ExerciseTemplate[]> {
  const { data, error } = await supabase
    .from('exercise_templates')
    .select('*')
    .eq('workout_template_id', workoutTemplateId)
    .order('position')
  if (error) throw error
  return data
}

export async function getExerciseTemplate(id: string): Promise<ExerciseTemplate | null> {
  const { data, error } = await supabase
    .from('exercise_templates')
    .select('*')
    .eq('id', id)
    .single()
  if (error) { if (error.code === 'PGRST116') return null; throw error }
  return data
}

// ─── Movements ───────────────────────────────────────────────────────────────

/**
 * Every exercise row sharing a movement with the given ones, across all
 * programs. `movementOf` maps any of those row ids to its movement key.
 */
async function resolveMovements(
  exercises: Pick<ExerciseTemplate, 'id' | 'movement_id'>[],
): Promise<{ siblingIds: string[]; movementOf: (id: string) => string }> {
  const keys = [...new Set(exercises.map(movementKey))]
  if (keys.length === 0) return { siblingIds: [], movementOf: id => id }
  const list = keys.join(',')
  const { data, error } = await supabase
    .from('exercise_templates')
    .select('id, movement_id')
    .or(`id.in.(${list}),movement_id.in.(${list})`)
  if (error) throw error
  const movementById = new Map<string, string>(
    (data ?? []).map(r => [r.id as string, (r.movement_id as string | null) ?? (r.id as string)]),
  )
  return {
    siblingIds: [...movementById.keys()],
    movementOf: id => movementById.get(id) ?? id,
  }
}

/**
 * Working-set logs (warmups excluded — they're template-driven) from
 * completed sessions, for every copy of the given exercises' movements.
 * Feeds planFromHistory. Paginates past PostgREST's 1000-row page size.
 */
export async function getMovementHistory(
  exercises: ExerciseTemplate[],
  opts: { excludeSessionId?: string; sinceDays?: number } = {},
): Promise<{ logs: HistoryLog[]; movementOf: (id: string) => string }> {
  const { siblingIds, movementOf } = await resolveMovements(exercises)
  if (siblingIds.length === 0) return { logs: [], movementOf }

  const since = new Date(Date.now() - (opts.sinceDays ?? 180) * 86_400_000).toISOString()
  const PAGE = 1000
  const logs: HistoryLog[] = []
  type Row = SetLog & { sessions: { started_at: string; completed_at: string } }

  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('set_logs')
      .select('*, sessions!inner(started_at, completed_at)')
      .in('exercise_template_id', siblingIds)
      .neq('set_type', 'warmup')
      .not('sessions.completed_at', 'is', null)
      .gte('sessions.completed_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (opts.excludeSessionId) q = q.neq('session_id', opts.excludeSessionId)
    const { data, error } = await q
    if (error) throw error
    for (const row of (data ?? []) as unknown as Row[]) {
      const { sessions, ...log } = row
      logs.push({
        ...log,
        session_started_at: sessions.started_at,
        session_completed_at: sessions.completed_at,
      })
    }
    if (!data || data.length < PAGE) break
  }
  return { logs, movementOf }
}

export async function getProgramExercises(programId: string): Promise<ExerciseTemplate[]> {
  const { data, error } = await supabase
    .from('exercise_templates')
    .select('*, workout_templates!inner(program_id)')
    .eq('workout_templates.program_id', programId)
    .order('name')
  if (error) throw error
  return data as unknown as ExerciseTemplate[]
}

/** A completed top/working set log with its session's completion date attached. */
export type ProgressLog = SetLog & { session_completed_at: string }

/**
 * All completed top/working set logs for the given exercises' movements,
 * from completed sessions — remapped onto the given rows so a program's
 * progress includes history logged under other programs' copies.
 */
export async function getProgressLogs(exercises: ExerciseTemplate[]): Promise<ProgressLog[]> {
  if (exercises.length === 0) return []
  const { siblingIds, movementOf } = await resolveMovements(exercises)
  const exerciseByMovement = new Map<string, string>()
  for (const ex of exercises) {
    const key = movementKey(ex)
    if (!exerciseByMovement.has(key)) exerciseByMovement.set(key, ex.id)
  }
  const { data, error } = await supabase
    .from('set_logs')
    .select('*, sessions!inner(completed_at)')
    .in('exercise_template_id', siblingIds)
    .in('set_type', ['top', 'working'])
    .eq('completed', true)
    .not('sessions.completed_at', 'is', null)
  if (error) throw error
  type Row = SetLog & { sessions: { completed_at: string } }
  return (data as unknown as Row[]).map(({ sessions, ...log }) => ({
    ...log,
    exercise_template_id: exerciseByMovement.get(movementOf(log.exercise_template_id)) ?? log.exercise_template_id,
    session_completed_at: sessions.completed_at,
  }))
}

export async function upsertExerciseTemplate(
  template: Omit<ExerciseTemplate, 'id' | 'created_at'> & { id?: string },
): Promise<ExerciseTemplate> {
  const { data, error } = await supabase
    .from('exercise_templates')
    .upsert(template)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteExerciseTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('exercise_templates').delete().eq('id', id)
  if (error) throw error
}

export async function reorderExerciseTemplates(
  updates: { id: string; position: number }[],
): Promise<void> {
  const { error } = await supabase.from('exercise_templates').upsert(updates)
  if (error) throw error
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/** Every completed session of the current profile, across programs, newest-first. */
export async function getProfileCompletedSessions(): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('profile_id', requireProfileId())
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Returns the current profile's in-progress session, if any. */
export async function getInProgressSession(): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('profile_id', requireProfileId())
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createSession(workoutTemplateId: string): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ workout_template_id: workoutTemplateId, profile_id: requireProfileId() })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function completeSession(
  sessionId: string,
  notes?: string,
): Promise<Session> {
  // Leave existing notes untouched unless new ones are passed — matters when
  // re-completing a reopened session
  const patch: Record<string, string> = { completed_at: new Date().toISOString() }
  if (notes !== undefined) patch.notes = notes
  const { data, error } = await supabase
    .from('sessions')
    .update(patch)
    .eq('id', sessionId)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Moves a completed session back to in-progress so it can be edited live. */
export async function reopenSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ completed_at: null })
    .eq('id', sessionId)
  if (error) throw error
}

export async function discardSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
  if (error) throw error
}

export async function updateSessionTimes(
  sessionId: string,
  startedAt: string,
  completedAt: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ started_at: startedAt, completed_at: completedAt })
    .eq('id', sessionId)
  if (error) throw error
}

export interface SessionRow {
  id: string
  workout_template_id: string
  template_name: string
  started_at: string
  completed_at: string | null
  notes: string | null
}

interface RawSessionWithTemplate {
  id: string
  workout_template_id: string
  started_at: string
  completed_at: string | null
  notes: string | null
  workout_templates: { name: string; program_id: string }
}

/** Returns all sessions for a program (complete + in-progress), newest-first, with template name. */
export async function getAllSessionsWithTemplate(programId: string): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, workout_template_id, started_at, completed_at, notes, workout_templates!inner(name, program_id)')
    .eq('workout_templates.program_id', programId)
    .order('started_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as RawSessionWithTemplate[]).map(row => ({
    id: row.id,
    workout_template_id: row.workout_template_id,
    template_name: row.workout_templates.name,
    started_at: row.started_at,
    completed_at: row.completed_at,
    notes: row.notes,
  }))
}

// ─── Set logs ────────────────────────────────────────────────────────────────

export async function getSetLogsForSession(sessionId: string): Promise<SetLog[]> {
  const { data, error } = await supabase
    .from('set_logs')
    .select('*')
    .eq('session_id', sessionId)
    .order('set_index')
  if (error) throw error
  return data
}

/** Returns set_logs for a given exercise across all sessions, newest-first.
 *  Used by calcStaleness and session initialization. */
/**
 * Recent logs for an exercise's whole movement (every program's copy),
 * newest-first, remapped onto the requested id so callers can filter by it.
 */
export async function getSetLogsForExercise(
  exerciseTemplateId: string,
  limit = 20,
): Promise<SetLog[]> {
  const { data: ex, error: exErr } = await supabase
    .from('exercise_templates')
    .select('id, movement_id')
    .eq('id', exerciseTemplateId)
    .maybeSingle()
  if (exErr) throw exErr
  const { siblingIds } = await resolveMovements(ex ? [ex] : [{ id: exerciseTemplateId, movement_id: null }])
  const { data, error } = await supabase
    .from('set_logs')
    .select('*')
    .in('exercise_template_id', siblingIds.length ? siblingIds : [exerciseTemplateId])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(l => ({ ...l, exercise_template_id: exerciseTemplateId }))
}

/** Bulk-inserts the pre-populated set_logs generated by initializeSession. */
export async function createSetLogs(
  sessionId: string,
  newSetLogs: NewSetLog[],
): Promise<SetLog[]> {
  const rows = newSetLogs.map(s => ({ ...s, session_id: sessionId }))
  const { data, error } = await supabase.from('set_logs').insert(rows).select()
  if (error) throw error
  return data
}

/** Removes a single set log — used to undo an ad-hoc extra set. */
export async function deleteSetLog(id: string): Promise<void> {
  const { error } = await supabase.from('set_logs').delete().eq('id', id)
  if (error) throw error
}

export async function updateSetLog(
  id: string,
  updates: Partial<Pick<SetLog, 'actual_weight' | 'actual_reps' | 'is_weight_override' | 'completed'>>,
): Promise<SetLog> {
  const { data, error } = await supabase
    .from('set_logs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Updates target_weight for all incomplete sets of a given exercise in a session.
 *  Called when the user changes the top set weight mid-session. */
export async function recalcTargetWeights(
  sessionId: string,
  exerciseTemplateId: string,
  setUpdates: { id: string; target_weight: number }[],
): Promise<void> {
  await Promise.all(
    setUpdates.map(({ id, target_weight }) =>
      supabase
        .from('set_logs')
        .update({ target_weight })
        .eq('id', id)
        .eq('session_id', sessionId)
        .eq('exercise_template_id', exerciseTemplateId)
        .eq('completed', false),
    ),
  )
}

// ─── Exercise notes ──────────────────────────────────────────────────────────

export async function getExerciseNotes(sessionId: string): Promise<ExerciseNote[]> {
  const { data, error } = await supabase
    .from('exercise_notes')
    .select('*')
    .eq('session_id', sessionId)
  if (error) throw error
  return data
}

/**
 * Upsert a note for an exercise within a session.
 * Pass `existingId` if a record already exists to update it.
 * Returns null if the note is blank (record deleted or nothing to create).
 */
export async function saveExerciseNote(
  sessionId: string,
  exerciseTemplateId: string,
  note: string,
  existingId?: string,
): Promise<ExerciseNote | null> {
  if (!note.trim()) {
    if (existingId) {
      await supabase.from('exercise_notes').delete().eq('id', existingId)
    }
    return null
  }
  if (existingId) {
    const { data, error } = await supabase
      .from('exercise_notes')
      .update({ note })
      .eq('id', existingId)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('exercise_notes')
    .insert({ session_id: sessionId, exercise_template_id: exerciseTemplateId, note })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── User settings ───────────────────────────────────────────────────────────

export async function getUserSettings(): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('profile_id', requireProfileId())
    .maybeSingle()
  if (error) throw error
  return data
}

export async function upsertUserSettings(
  patch: Partial<Pick<UserSettings, 'unit_system' | 'theme'>>,
): Promise<UserSettings> {
  // One row per profile (unique index on profile_id); creates it on first
  // write for a new profile. updated_at is bumped manually — no DB trigger.
  const { data, error } = await supabase
    .from('user_settings')
    .upsert(
      { profile_id: requireProfileId(), ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'profile_id' },
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Stats (Home screen) ─────────────────────────────────────────────────────

export interface HomeStats {
  totalSessions: number
  sessionsThisMonth: number
  highlightPR: number | null
  highlightExerciseName: string
}

export async function getHomeStats(
  highlightExerciseId: string | null,
): Promise<HomeStats> {
  // Counts are per person, not per program — switching programs doesn't
  // reset your training history
  const sessionsRes = await supabase
    .from('sessions')
    .select('id, completed_at', { count: 'exact' })
    .eq('profile_id', requireProfileId())
    .not('completed_at', 'is', null)
  if (sessionsRes.error) throw sessionsRes.error

  let highlightPR: number | null = null
  let highlightExerciseName = ''

  if (highlightExerciseId) {
    const { data: ex, error: exErr } = await supabase
      .from('exercise_templates')
      .select('id, name, movement_id')
      .eq('id', highlightExerciseId)
      .maybeSingle()
    if (!exErr && ex) {
      highlightExerciseName = ex.name
      // PR across every program's copy of the lift
      const { siblingIds } = await resolveMovements([ex])
      const { data: pr } = await supabase
        .from('set_logs')
        .select('actual_weight')
        .in('exercise_template_id', siblingIds)
        .eq('set_type', 'top')
        .not('actual_weight', 'is', null)
        .order('actual_weight', { ascending: false })
        .limit(1)
      highlightPR = pr?.[0]?.actual_weight ?? null
    }
  }

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const sessionsThisMonth = (sessionsRes.data ?? []).filter(
    s => s.completed_at && s.completed_at >= startOfMonth,
  ).length

  return {
    totalSessions: sessionsRes.count ?? 0,
    sessionsThisMonth,
    highlightPR,
    highlightExerciseName,
  }
}
