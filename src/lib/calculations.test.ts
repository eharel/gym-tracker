import { describe, expect, it } from 'vitest'
import {
  calcBackoffWeight,
  calcDumbbellWarmup,
  calcStaleness,
  calcWarmupWeight,
  getNextWorkoutTemplate,
  hasEarnedProgression,
  initializeSession,
  parseRepRangeMax,
} from './calculations'
import type { ExerciseTemplate, Session, SetLog, WorkoutTemplate } from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSetLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'test-id',
    session_id: 'session-id',
    exercise_template_id: 'ex-id',
    set_index: 0,
    set_type: 'top',
    target_weight: 100,
    actual_weight: 100,
    target_reps: '3-5',
    actual_reps: 4,
    is_weight_override: false,
    completed: true,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-id',
    workout_template_id: 'template-id',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    notes: null,
    ...overrides,
  }
}

function makeTemplate(overrides: Partial<WorkoutTemplate> = {}): WorkoutTemplate {
  return {
    id: 'template-id',
    program_id: 'program-id',
    name: 'Full Body A',
    order_in_program: 0,
    warmup_text: null,
    cooldown_text: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeExerciseTemplate(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return {
    id: 'ex-id',
    workout_template_id: 'template-id',
    name: 'Squat',
    position: 0,
    rpe_target: '8-9',
    notes: null,
    superset_group: null,
    is_optional: false,
    warmup_rule: 'percentage_of_top_set',
    warmup_percentages: [0, 0.45, 0.65, 0.85],
    warmup_reps: [10, 5, 3, 1],
    warmup_db_percentage: null,
    warmup_db_reps: null,
    warmup_fixed_weight: null,
    warmup_fixed_reps: null,
    working_set_count: 1,
    working_set_type: 'top_set',
    working_rep_target: '2-4',
    backoff_set_count: 1,
    backoff_percentage: 0.81,
    backoff_rep_target: '8-10',
    weight_increment: 5,
    rounding_increment: 5,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─── calcWarmupWeight ───────────────────────────────────────────────────────

describe('calcWarmupWeight', () => {
  it('returns 45 for percentage 0 (empty bar), regardless of top set weight', () => {
    expect(calcWarmupWeight(290, 0)).toBe(45)
    expect(calcWarmupWeight(500, 0)).toBe(45)
  })

  // Squat 290 lbs warmup series from spec seed data
  it('290 × 0.45 = 130.5 → rounds to 130', () => {
    expect(calcWarmupWeight(290, 0.45)).toBe(130)
  })

  it('290 × 0.65 = 188.5 → rounds to 190', () => {
    expect(calcWarmupWeight(290, 0.65)).toBe(190)
  })

  it('290 × 0.85 = 246.5 → rounds to 245', () => {
    expect(calcWarmupWeight(290, 0.85)).toBe(245)
  })

  // Bench 230 lbs warmup series from spec seed data
  it('230 × 0.45 = 103.5 → rounds to 105', () => {
    expect(calcWarmupWeight(230, 0.45)).toBe(105)
  })

  it('230 × 0.65 = 149.5 → rounds to 150', () => {
    expect(calcWarmupWeight(230, 0.65)).toBe(150)
  })

  it('230 × 0.85 = 195.5 → rounds to 195', () => {
    expect(calcWarmupWeight(230, 0.85)).toBe(195)
  })

  it('rounds to custom increment', () => {
    expect(calcWarmupWeight(100, 0.33, 2.5)).toBe(32.5)
  })

  it('rounds down when exactly halfway', () => {
    // 200 × 0.625 = 125.0 → exactly on boundary → 125
    expect(calcWarmupWeight(200, 0.625)).toBe(125)
  })
})

// ─── calcDumbbellWarmup ─────────────────────────────────────────────────────

describe('calcDumbbellWarmup', () => {
  // RDL 190 lbs → 190 × 0.325 = 61.75 → rounds to 60
  it('RDL 190 lbs → 60 lbs DB', () => {
    expect(calcDumbbellWarmup(190)).toBe(60)
  })

  // Pendlay Row 155 lbs → 155 × 0.325 = 50.375 → rounds to 50
  it('Pendlay Row 155 lbs → 50 lbs DB', () => {
    expect(calcDumbbellWarmup(155)).toBe(50)
  })

  it('uses custom dbPercentage', () => {
    expect(calcDumbbellWarmup(200, 0.5)).toBe(100)
  })

  it('rounds to custom increment', () => {
    expect(calcDumbbellWarmup(100, 0.325, 2.5)).toBe(32.5)
  })
})

// ─── calcBackoffWeight ──────────────────────────────────────────────────────

describe('calcBackoffWeight', () => {
  // From spec back-off table
  it('Squat 290 × 0.81 = 234.9 → 235', () => {
    expect(calcBackoffWeight(290, 0.81)).toBe(235)
  })

  it('Bench 230 × 0.85 = 195.5 → 195', () => {
    expect(calcBackoffWeight(230, 0.85)).toBe(195)
  })

  it('Incline 175 × 0.83 = 145.25 → 145', () => {
    expect(calcBackoffWeight(175, 0.83)).toBe(145)
  })

  it('OHP 95 × 0.78 = 74.1 → 75', () => {
    expect(calcBackoffWeight(95, 0.78)).toBe(75)
  })

  it('rounds to custom increment', () => {
    expect(calcBackoffWeight(100, 0.81, 2.5)).toBe(80)
  })
})

// ─── parseRepRangeMax ───────────────────────────────────────────────────────

describe('parseRepRangeMax', () => {
  it('parses range — returns upper bound', () => {
    expect(parseRepRangeMax('2-4')).toBe(4)
    expect(parseRepRangeMax('6-8')).toBe(8)
    expect(parseRepRangeMax('10-12')).toBe(12)
  })

  it('parses single number', () => {
    expect(parseRepRangeMax('8')).toBe(8)
  })

  it('returns null for AMRAP', () => {
    expect(parseRepRangeMax('AMRAP')).toBeNull()
    expect(parseRepRangeMax('amrap')).toBeNull()
  })
})

// ─── hasEarnedProgression ───────────────────────────────────────────────────

describe('hasEarnedProgression', () => {
  it('returns true when reps equal the upper bound', () => {
    expect(hasEarnedProgression('2-4', 4)).toBe(true)
  })

  it('returns true when reps exceed the upper bound', () => {
    expect(hasEarnedProgression('2-4', 5)).toBe(true)
  })

  it('returns false when reps are below the upper bound', () => {
    expect(hasEarnedProgression('2-4', 3)).toBe(false)
    expect(hasEarnedProgression('2-4', 2)).toBe(false)
  })

  it('always returns false for AMRAP', () => {
    expect(hasEarnedProgression('AMRAP', 20)).toBe(false)
    expect(hasEarnedProgression('AMRAP', 1)).toBe(false)
  })

  it('works with single-number rep targets', () => {
    expect(hasEarnedProgression('5', 5)).toBe(true)
    expect(hasEarnedProgression('5', 4)).toBe(false)
  })
})

// ─── calcStaleness ──────────────────────────────────────────────────────────

describe('calcStaleness', () => {
  const EX = 'ex-1'

  it('returns 0 with no set logs', () => {
    expect(calcStaleness(EX, [])).toBe(0)
  })

  it('returns 0 with only one top set', () => {
    const logs = [makeSetLog({ exercise_template_id: EX, actual_weight: 290 })]
    expect(calcStaleness(EX, logs)).toBe(0)
  })

  it('returns 0 when weight increased last session (not stale)', () => {
    // newest-first: [295, 290] — weight went up
    const logs = [
      makeSetLog({ exercise_template_id: EX, actual_weight: 295 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
    ]
    expect(calcStaleness(EX, logs)).toBe(0)
  })

  it('returns 1 when weight was the same for two sessions', () => {
    const logs = [
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
    ]
    expect(calcStaleness(EX, logs)).toBe(1)
  })

  it('returns 2 when weight was the same for three sessions', () => {
    const logs = [
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
    ]
    expect(calcStaleness(EX, logs)).toBe(2)
  })

  it('stops counting when a lower (pre-progression) weight is found', () => {
    // newest-first: [290, 290, 285] — stuck at 290 for 2 sessions, then weight was lower
    const logs = [
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 285 }),
    ]
    expect(calcStaleness(EX, logs)).toBe(1)
  })

  it('ignores logs for other exercises', () => {
    const logs = [
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
      makeSetLog({ exercise_template_id: 'other-ex', actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
    ]
    expect(calcStaleness(EX, logs)).toBe(1)
  })

  it('ignores non-top set types', () => {
    const logs = [
      makeSetLog({ exercise_template_id: EX, set_type: 'top', actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, set_type: 'backoff', actual_weight: 235 }),
      makeSetLog({ exercise_template_id: EX, set_type: 'top', actual_weight: 290 }),
    ]
    expect(calcStaleness(EX, logs)).toBe(1)
  })

  it('ignores logs with null actual_weight', () => {
    const logs = [
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
      makeSetLog({ exercise_template_id: EX, actual_weight: null }),
      makeSetLog({ exercise_template_id: EX, actual_weight: 290 }),
    ]
    expect(calcStaleness(EX, logs)).toBe(1)
  })
})

// ─── getNextWorkoutTemplate ─────────────────────────────────────────────────

describe('getNextWorkoutTemplate', () => {
  const templateA = makeTemplate({ id: 'a', order_in_program: 0, name: 'Full Body A' })
  const templateB = makeTemplate({ id: 'b', order_in_program: 1, name: 'Full Body B' })
  const templates = [templateA, templateB]

  it('returns the first template when there are no sessions', () => {
    expect(getNextWorkoutTemplate([], templates)).toBe(templateA)
  })

  it('returns template B after a template A session', () => {
    const sessions = [makeSession({ workout_template_id: 'a' })]
    expect(getNextWorkoutTemplate(sessions, templates)).toBe(templateB)
  })

  it('returns template A after a template B session (wraps around)', () => {
    const sessions = [makeSession({ workout_template_id: 'b' })]
    expect(getNextWorkoutTemplate(sessions, templates)).toBe(templateA)
  })

  it('uses the most recent session (index 0) when multiple sessions exist', () => {
    const sessions = [
      makeSession({ workout_template_id: 'b' }), // most recent
      makeSession({ workout_template_id: 'a' }),
    ]
    expect(getNextWorkoutTemplate(sessions, templates)).toBe(templateA)
  })

  it('returns the first template when last session references unknown template', () => {
    const sessions = [makeSession({ workout_template_id: 'unknown' })]
    expect(getNextWorkoutTemplate(sessions, templates)).toBe(templateA)
  })
})

// ─── initializeSession ──────────────────────────────────────────────────────

describe('initializeSession', () => {
  it('generates correct warmup + top + backoff sets for a percentage_of_top_set exercise', () => {
    const squat = makeExerciseTemplate() // Squat, top set 290, backoff 81%
    const lastSetLogs = [
      makeSetLog({ exercise_template_id: 'ex-id', set_type: 'top', actual_weight: 290 }),
    ]

    const sets = initializeSession([squat], lastSetLogs)

    // 4 warmup + 1 top + 1 backoff = 6 sets
    expect(sets).toHaveLength(6)

    const warmups = sets.filter(s => s.set_type === 'warmup')
    expect(warmups).toHaveLength(4)
    expect(warmups.map(s => s.target_weight)).toEqual([45, 130, 190, 245])
    expect(warmups.map(s => s.target_reps)).toEqual(['10', '5', '3', '1'])

    const top = sets.find(s => s.set_type === 'top')
    expect(top?.target_weight).toBe(290)
    expect(top?.target_reps).toBe('2-4')

    const backoff = sets.find(s => s.set_type === 'backoff')
    expect(backoff?.target_weight).toBe(235) // 290 × 0.81 → 235
    expect(backoff?.target_reps).toBe('8-10')
  })

  it('generates correct warmup for a dumbbell_percentage exercise', () => {
    const rdl = makeExerciseTemplate({
      id: 'rdl',
      name: 'Barbell RDL',
      warmup_rule: 'dumbbell_percentage',
      warmup_percentages: null,
      warmup_reps: null,
      warmup_db_percentage: 0.325,
      warmup_db_reps: 10,
      working_set_count: 3,
      working_set_type: 'straight_sets',
      working_rep_target: '8-10',
      backoff_set_count: 0,
      backoff_percentage: null,
      backoff_rep_target: null,
    })
    const lastSetLogs = [
      makeSetLog({ exercise_template_id: 'rdl', set_type: 'working', actual_weight: 190 }),
    ]

    const sets = initializeSession([rdl], lastSetLogs)

    // 1 warmup + 3 working = 4 sets
    expect(sets).toHaveLength(4)

    const warmup = sets.find(s => s.set_type === 'warmup')
    expect(warmup?.target_weight).toBe(60) // 190 × 0.325 → 61.75 → 60
    expect(warmup?.target_reps).toBe('10')

    const workingSets = sets.filter(s => s.set_type === 'working')
    expect(workingSets).toHaveLength(3)
    workingSets.forEach(s => expect(s.target_weight).toBe(190))
  })

  it('generates correct warmup for a fixed_weight exercise', () => {
    const bss = makeExerciseTemplate({
      id: 'bss',
      name: 'Bulgarian Split Squat',
      warmup_rule: 'fixed_weight',
      warmup_percentages: null,
      warmup_reps: null,
      warmup_fixed_weight: 0,
      warmup_fixed_reps: 10,
      working_set_count: 3,
      working_set_type: 'straight_sets',
      working_rep_target: '8-10',
      backoff_set_count: 0,
      backoff_percentage: null,
      backoff_rep_target: null,
    })
    const lastSetLogs = [
      makeSetLog({ exercise_template_id: 'bss', set_type: 'working', actual_weight: 45 }),
    ]

    const sets = initializeSession([bss], lastSetLogs)

    expect(sets).toHaveLength(4) // 1 warmup + 3 working
    expect(sets[0].set_type).toBe('warmup')
    expect(sets[0].target_weight).toBe(0) // bodyweight
  })

  it('generates no warmup sets for a "none" warmup rule exercise', () => {
    const pullups = makeExerciseTemplate({
      id: 'pullups',
      name: 'Pull-ups',
      warmup_rule: 'none',
      warmup_percentages: null,
      warmup_reps: null,
      working_set_count: 3,
      working_set_type: 'straight_sets',
      working_rep_target: 'AMRAP',
      backoff_set_count: 0,
      backoff_percentage: null,
      backoff_rep_target: null,
    })
    const lastSetLogs = [
      makeSetLog({ exercise_template_id: 'pullups', set_type: 'working', actual_weight: 0 }),
    ]

    const sets = initializeSession([pullups], lastSetLogs)

    expect(sets).toHaveLength(3)
    sets.forEach(s => expect(s.set_type).toBe('working'))
  })

  it('sets null target_weight when there is no prior session data', () => {
    const squat = makeExerciseTemplate()
    const sets = initializeSession([squat], [])

    // No working weight → no warmup sets generated, top set has null weight
    const top = sets.find(s => s.set_type === 'top')
    expect(top?.target_weight).toBeNull()
  })

  it('sets completed: false and actual_weight: null on all generated sets', () => {
    const squat = makeExerciseTemplate()
    const lastSetLogs = [
      makeSetLog({ exercise_template_id: 'ex-id', set_type: 'top', actual_weight: 290 }),
    ]
    const sets = initializeSession([squat], lastSetLogs)

    sets.forEach(s => {
      expect(s.completed).toBe(false)
      expect(s.actual_weight).toBeNull()
      expect(s.actual_reps).toBeNull()
      expect(s.is_weight_override).toBe(false)
    })
  })

  it('sorts exercises by position before generating sets', () => {
    const exA = makeExerciseTemplate({ id: 'a', position: 1, name: 'Bench', warmup_rule: 'none', working_set_count: 1, working_set_type: 'top_set', backoff_set_count: 0 })
    const exB = makeExerciseTemplate({ id: 'b', position: 0, name: 'Squat', warmup_rule: 'none', working_set_count: 1, working_set_type: 'top_set', backoff_set_count: 0 })
    const logs = [
      makeSetLog({ exercise_template_id: 'a', set_type: 'top', actual_weight: 200 }),
      makeSetLog({ exercise_template_id: 'b', set_type: 'top', actual_weight: 300 }),
    ]

    const sets = initializeSession([exA, exB], logs)

    // Squat (position 0) should come first
    expect(sets[0].exercise_template_id).toBe('b')
    expect(sets[1].exercise_template_id).toBe('a')
  })
})
