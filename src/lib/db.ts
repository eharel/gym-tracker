import { supabase } from './supabase'
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

// ─── Programs ───────────────────────────────────────────────────────────────

export async function getActiveProgram(): Promise<Program | null> {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('is_active', true)
    .single()
  if (error) { if (error.code === 'PGRST116') return null; throw error }
  return data
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

export async function getProgramExercises(programId: string): Promise<ExerciseTemplate[]> {
  const { data, error } = await supabase
    .from('exercise_templates')
    .select('*, workout_templates!inner(program_id)')
    .eq('workout_templates.program_id', programId)
    .order('name')
  if (error) throw error
  return data as unknown as ExerciseTemplate[]
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

/** Returns all completed sessions for a program, newest-first. */
export async function getCompletedSessions(programId: string): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, workout_templates!inner(program_id)')
    .eq('workout_templates.program_id', programId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
  if (error) throw error
  return data
}

/** Returns the most recent N completed sessions for a template, newest-first. */
export async function getRecentCompletedSessionsForTemplate(
  workoutTemplateId: string,
  limit = 10,
): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('workout_template_id', workoutTemplateId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/** Returns the most recent completed session for a specific workout template. */
export async function getLastSessionForTemplate(
  workoutTemplateId: string,
): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('workout_template_id', workoutTemplateId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()
  if (error) { if (error.code === 'PGRST116') return null; throw error }
  return data
}

/** Returns the in-progress session (completed_at is null), if any. */
export async function getInProgressSession(): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()
  if (error) { if (error.code === 'PGRST116') return null; throw error }
  return data
}

export async function createSession(workoutTemplateId: string): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ workout_template_id: workoutTemplateId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function completeSession(
  sessionId: string,
  notes?: string,
): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .update({ completed_at: new Date().toISOString(), notes: notes ?? null })
    .eq('id', sessionId)
    .select()
    .single()
  if (error) throw error
  return data
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
export async function getSetLogsForExercise(
  exerciseTemplateId: string,
  limit = 20,
): Promise<SetLog[]> {
  const { data, error } = await supabase
    .from('set_logs')
    .select('*')
    .eq('exercise_template_id', exerciseTemplateId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
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
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function upsertUserSettings(
  patch: Partial<Pick<UserSettings, 'unit_system'>>,
): Promise<UserSettings> {
  // Always update the single existing row; updated_at is bumped manually
  // so we don't need a DB trigger.
  const { data, error } = await supabase
    .from('user_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .not('id', 'is', null) // match all rows (there is only one)
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
  programId: string,
  highlightExerciseId: string | null,
): Promise<HomeStats> {
  const sessionsRes = await supabase
    .from('sessions')
    .select('id, completed_at, workout_templates!inner(program_id)', { count: 'exact' })
    .eq('workout_templates.program_id', programId)
    .not('completed_at', 'is', null)
  if (sessionsRes.error) throw sessionsRes.error

  let highlightPR: number | null = null
  let highlightExerciseName = ''

  if (highlightExerciseId) {
    const [nameRes, prRes] = await Promise.all([
      supabase.from('exercise_templates').select('name').eq('id', highlightExerciseId).single(),
      supabase.from('set_logs').select('actual_weight')
        .eq('exercise_template_id', highlightExerciseId)
        .eq('set_type', 'top')
        .not('actual_weight', 'is', null)
        .order('actual_weight', { ascending: false })
        .limit(1),
    ])
    if (!nameRes.error && nameRes.data) highlightExerciseName = nameRes.data.name
    highlightPR = prRes.data?.[0]?.actual_weight ?? null
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
