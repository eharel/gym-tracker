export interface Program {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
}

export interface WorkoutTemplate {
  id: string
  program_id: string
  name: string
  order_in_program: number
  warmup_text: string | null
  cooldown_text: string | null
  created_at: string
}

export type WarmupRule = 'percentage_of_top_set' | 'dumbbell_percentage' | 'fixed_weight' | 'none'
export type WorkingSetType = 'top_set' | 'straight_sets' | 'amrap'
export type SetType = 'warmup' | 'top' | 'backoff' | 'working' | 'amrap'

export interface ExerciseTemplate {
  id: string
  workout_template_id: string
  name: string
  position: number
  rpe_target: string | null
  notes: string | null
  superset_group: string | null
  is_optional: boolean

  warmup_rule: WarmupRule
  warmup_percentages: number[] | null
  warmup_reps: number[] | null
  warmup_db_percentage: number | null
  warmup_db_reps: number | null
  warmup_fixed_weight: number | null
  warmup_fixed_reps: number | null

  working_set_count: number
  working_set_type: WorkingSetType
  working_rep_target: string | null

  backoff_set_count: number
  backoff_percentage: number | null
  backoff_rep_target: string | null

  weight_increment: number
  rounding_increment: number

  created_at: string
}

export interface Session {
  id: string
  workout_template_id: string
  started_at: string
  completed_at: string | null
  notes: string | null
}

export interface SetLog {
  id: string
  session_id: string
  exercise_template_id: string
  set_index: number
  set_type: SetType
  target_weight: number | null
  actual_weight: number | null
  target_reps: string | null
  actual_reps: number | null
  is_weight_override: boolean
  completed: boolean
  created_at: string
}

export interface ExerciseNote {
  id: string
  session_id: string
  exercise_template_id: string
  note: string
  created_at: string
}

/** SetLog without DB-assigned fields — used when building sets before saving. */
export type NewSetLog = Omit<SetLog, 'id' | 'session_id' | 'created_at'>
