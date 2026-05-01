import { supabase } from './supabase'
import type {
  ExerciseNote,
  ExerciseTemplate,
  NewSetLog,
  Program,
  Session,
  SetLog,
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

export async function addExerciseNote(
  sessionId: string,
  exerciseTemplateId: string,
  note: string,
): Promise<ExerciseNote> {
  const { data, error } = await supabase
    .from('exercise_notes')
    .insert({ session_id: sessionId, exercise_template_id: exerciseTemplateId, note })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Stats (Home screen) ─────────────────────────────────────────────────────

export interface HomeStats {
  totalSessions: number
  sessionsThisMonth: number
  squatPR: number | null
}

export async function getHomeStats(programId: string): Promise<HomeStats> {
  const SQUAT_ID = 'c0000000-0000-0000-0000-000000000001'

  const [sessionsRes, squatRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, completed_at, workout_templates!inner(program_id)', { count: 'exact' })
      .eq('workout_templates.program_id', programId)
      .not('completed_at', 'is', null),
    supabase
      .from('set_logs')
      .select('actual_weight')
      .eq('exercise_template_id', SQUAT_ID)
      .eq('set_type', 'top')
      .not('actual_weight', 'is', null)
      .order('actual_weight', { ascending: false })
      .limit(1),
  ])

  if (sessionsRes.error) throw sessionsRes.error
  if (squatRes.error) throw squatRes.error

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const sessionsThisMonth = (sessionsRes.data ?? []).filter(
    s => s.completed_at && s.completed_at >= startOfMonth,
  ).length

  return {
    totalSessions: sessionsRes.count ?? 0,
    sessionsThisMonth,
    squatPR: squatRes.data?.[0]?.actual_weight ?? null,
  }
}
