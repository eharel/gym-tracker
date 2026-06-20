import { describe, expect, it } from 'vitest'
import {
  calcBackoffWeight,
  calcDumbbellWarmup,
  calcStaleness,
  calcWarmupWeight,
  detectComeback,
  getNextWorkoutTemplate,
  hasEarnedProgression,
  initializeSession,
  parseRepRangeMax,
} from '../calculations'
import type { ExerciseTemplate, Session, SetLog, WorkoutTemplate } from '../../types'

// ─── Factories ────────────────────────────────────────────────────────────────

function makeEx(overrides?: Partial<ExerciseTemplate>): ExerciseTemplate {
  return {
    id: 'ex1',
    workout_template_id: 'wt1',
    name: 'Exercise',
    position: 0,
    rpe_target: null,
    notes: null,
    superset_group: null,
    is_optional: false,
    warmup_rule: 'none',
    warmup_percentages: null,
    warmup_reps: null,
    warmup_db_percentage: null,
    warmup_db_reps: null,
    warmup_fixed_weight: null,
    warmup_fixed_reps: null,
    working_set_count: 1,
    working_set_type: 'top_set',
    working_rep_target: '3-5',
    backoff_set_count: 0,
    backoff_percentage: null,
    backoff_rep_target: null,
    weight_increment: 5,
    rounding_increment: 5,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTemplate(overrides?: Partial<WorkoutTemplate>): WorkoutTemplate {
  return {
    id: 'wt1',
    program_id: 'p1',
    name: 'Workout A',
    order_in_program: 0,
    warmup_text: null,
    cooldown_text: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 's1',
    workout_template_id: 'wt1',
    started_at: '2026-01-01T10:00:00Z',
    completed_at: '2026-01-01T11:30:00Z',
    notes: null,
    ...overrides,
  }
}

function makeSetLog(overrides?: Partial<SetLog>): SetLog {
  return {
    id: 'sl1',
    session_id: 's1',
    exercise_template_id: 'ex1',
    set_index: 0,
    set_type: 'top',
    target_weight: 100,
    actual_weight: 100,
    target_reps: '3-5',
    actual_reps: 4,
    is_weight_override: false,
    completed: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Returns an ISO timestamp N days before the reference point. */
function daysAgo(n: number, from: Date): string {
  return new Date(from.getTime() - n * 86_400_000).toISOString()
}

// ─── parseRepRangeMax ─────────────────────────────────────────────────────────

describe('parseRepRangeMax', () => {
  it('parses a single number', () => { expect(parseRepRangeMax('8')).toBe(8) })
  it('parses the upper bound of a range', () => { expect(parseRepRangeMax('3-5')).toBe(5) })
  it('returns null for AMRAP uppercase', () => { expect(parseRepRangeMax('AMRAP')).toBeNull() })
  it('returns null for amrap lowercase', () => { expect(parseRepRangeMax('amrap')).toBeNull() })
  it('returns null for empty string', () => { expect(parseRepRangeMax('')).toBeNull() })
})

// ─── hasEarnedProgression ────────────────────────────────────────────────────

describe('hasEarnedProgression', () => {
  it('returns false for AMRAP rep target', () => {
    expect(hasEarnedProgression('AMRAP', 12)).toBe(false)
  })
  it('returns true when reps hit the upper bound', () => {
    expect(hasEarnedProgression('3-5', 5)).toBe(true)
  })
  it('returns true when reps exceed the upper bound', () => {
    expect(hasEarnedProgression('3-5', 6)).toBe(true)
  })
  it('returns false when reps are below the upper bound', () => {
    expect(hasEarnedProgression('3-5', 4)).toBe(false)
  })
  it('works for a single-number target', () => {
    expect(hasEarnedProgression('5', 5)).toBe(true)
    expect(hasEarnedProgression('5', 4)).toBe(false)
  })
})

// ─── calcWarmupWeight ─────────────────────────────────────────────────────────

describe('calcWarmupWeight', () => {
  it('returns the bar (45 lbs) for 0%', () => {
    expect(calcWarmupWeight(200, 0)).toBe(45)
  })
  it('calculates exactly when divisible', () => {
    expect(calcWarmupWeight(200, 0.5)).toBe(100)
  })
  it('rounds to nearest 5 when fractional', () => {
    // 185 * 0.5 = 92.5 → 95
    expect(calcWarmupWeight(185, 0.5)).toBe(95)
  })
  it('respects a custom rounding increment', () => {
    // 175 * 0.5 = 87.5 → 90 (nearest 10)
    expect(calcWarmupWeight(175, 0.5, 10)).toBe(90)
  })
  it('rounds down when closer to the lower multiple', () => {
    // 200 * 0.32 = 64 → 65 (nearest 5)
    expect(calcWarmupWeight(200, 0.32)).toBe(65)
  })
})

// ─── calcDumbbellWarmup ──────────────────────────────────────────────────────

describe('calcDumbbellWarmup', () => {
  it('applies the default percentage (32.5%) and rounds to 5', () => {
    // 100 * 0.325 = 32.5 → 35
    expect(calcDumbbellWarmup(100)).toBe(35)
  })
  it('applies a custom percentage', () => {
    // 60 * 0.3 = 18 → 20
    expect(calcDumbbellWarmup(60, 0.3, 5)).toBe(20)
  })
})

// ─── calcBackoffWeight ───────────────────────────────────────────────────────

describe('calcBackoffWeight', () => {
  it('calculates backoff from the top set weight', () => {
    expect(calcBackoffWeight(200, 0.8)).toBe(160)
  })
  it('rounds fractional results to the nearest 5', () => {
    // 225 * 0.75 = 168.75 → 170
    expect(calcBackoffWeight(225, 0.75)).toBe(170)
  })
  it('respects a custom rounding increment', () => {
    expect(calcBackoffWeight(200, 0.8, 10)).toBe(160)
  })
})

// ─── calcStaleness ───────────────────────────────────────────────────────────

describe('calcStaleness', () => {
  const EX_ID = 'ex1'
  const topLog = (weight: number) =>
    makeSetLog({ exercise_template_id: EX_ID, set_type: 'top', actual_weight: weight })

  it('returns 0 with no logs', () => {
    expect(calcStaleness(EX_ID, [])).toBe(0)
  })
  it('returns 0 with only one top set', () => {
    expect(calcStaleness(EX_ID, [topLog(200)])).toBe(0)
  })
  it('counts stale sessions when weight is unchanged', () => {
    // 3 sessions at the same weight → 2 stale prior sessions
    expect(calcStaleness(EX_ID, [topLog(200), topLog(200), topLog(200)])).toBe(2)
  })
  it('stops counting when a prior session had a lower weight (progression point)', () => {
    // [200, 200, 185]: stale at index 1, stops at index 2 (185 < 200)
    expect(calcStaleness(EX_ID, [topLog(200), topLog(200), topLog(185)])).toBe(1)
  })
  it('returns 0 when the immediately prior session had lower weight', () => {
    // [200, 185, ...]: progression happened last time, 0 stale sessions
    expect(calcStaleness(EX_ID, [topLog(200), topLog(185), topLog(185)])).toBe(0)
  })
  it('ignores non-top-set logs', () => {
    const working = makeSetLog({ exercise_template_id: EX_ID, set_type: 'working', actual_weight: 200 })
    expect(calcStaleness(EX_ID, [topLog(200), working, working])).toBe(0)
  })
  it('ignores logs for a different exercise', () => {
    const other = makeSetLog({ exercise_template_id: 'other', set_type: 'top', actual_weight: 200 })
    expect(calcStaleness(EX_ID, [topLog(200), other, other])).toBe(0)
  })
})

// ─── getNextWorkoutTemplate ──────────────────────────────────────────────────

describe('getNextWorkoutTemplate', () => {
  const templates = [
    makeTemplate({ id: 'a', order_in_program: 0 }),
    makeTemplate({ id: 'b', order_in_program: 1 }),
    makeTemplate({ id: 'c', order_in_program: 2 }),
  ]

  it('returns the first template when there are no sessions', () => {
    expect(getNextWorkoutTemplate([], templates).id).toBe('a')
  })
  it('returns the next template after the last completed one', () => {
    const sessions = [makeSession({ workout_template_id: 'a' })]
    expect(getNextWorkoutTemplate(sessions, templates).id).toBe('b')
  })
  it('wraps around from the last template to the first', () => {
    const sessions = [makeSession({ workout_template_id: 'c' })]
    expect(getNextWorkoutTemplate(sessions, templates).id).toBe('a')
  })
  it('falls back to the first template when the last template id is unknown', () => {
    const sessions = [makeSession({ workout_template_id: 'unknown-id' })]
    expect(getNextWorkoutTemplate(sessions, templates).id).toBe('a')
  })
})

// ─── detectComeback ──────────────────────────────────────────────────────────

describe('detectComeback', () => {
  const NOW = new Date('2026-06-01T12:00:00Z')

  it('returns null with no sessions', () => {
    expect(detectComeback([], NOW)).toBeNull()
  })

  it('returns null when last session was recent (under 14 days)', () => {
    const sessions = [makeSession({ completed_at: daysAgo(5, NOW) })]
    expect(detectComeback(sessions, NOW)).toBeNull()
  })

  it('detects a gap right at the 14-day threshold', () => {
    const sessions = [makeSession({ id: 'bench', completed_at: daysAgo(14, NOW) })]
    expect(detectComeback(sessions, NOW)).not.toBeNull()
  })

  it('returns correct info for a 20-day gap (total=2, 85% start)', () => {
    const sessions = [makeSession({ id: 'bench', completed_at: daysAgo(20, NOW) })]
    const result = detectComeback(sessions, NOW)!
    expect(result.benchmarkSessionId).toBe('bench')
    expect(result.comebackSessionsDone).toBe(0)
    expect(result.comebackSessionsTotal).toBe(2)
    expect(result.factor).toBeCloseTo(0.85)
    expect(result.sessionsRemaining).toBe(2)
  })

  it('returns correct info for a 35-day gap (total=3, 75% start)', () => {
    // 35 days is in the [21, 42) band → total=3, startFactor=0.75
    const sessions = [makeSession({ id: 'bench', completed_at: daysAgo(35, NOW) })]
    const result = detectComeback(sessions, NOW)!
    expect(result.comebackSessionsTotal).toBe(3)
    expect(result.factor).toBeCloseTo(0.75)
  })

  it('returns correct info for a 45-day gap (total=4, 65% start)', () => {
    // 45 days is in the [42, 84) band → total=4, startFactor=0.65
    const sessions = [makeSession({ id: 'bench', completed_at: daysAgo(45, NOW) })]
    const result = detectComeback(sessions, NOW)!
    expect(result.comebackSessionsTotal).toBe(4)
    expect(result.factor).toBeCloseTo(0.65)
  })

  it('returns correct info for a 90-day gap (total=4, 60% start)', () => {
    // 90 days is in the [84, ∞) band → total=4, startFactor=0.60
    const sessions = [makeSession({ id: 'bench', completed_at: daysAgo(90, NOW) })]
    const result = detectComeback(sessions, NOW)!
    expect(result.comebackSessionsTotal).toBe(4)
    expect(result.factor).toBeCloseTo(0.60)
  })

  it('detects an in-progress comeback (1 of 2 done → factor = 1.0)', () => {
    // sessions[0] started 5 days ago; sessions[1] completed 25 days ago → 20-day gap
    // comebackParams(20) → total=2, startFactor=0.85
    // comebackFactor(20, done=1) → 0.85 + 0.15*(1/1) = 1.0
    const sessions = [
      makeSession({ id: 'post', started_at: daysAgo(5, NOW), completed_at: daysAgo(5, NOW) }),
      makeSession({ id: 'bench', started_at: daysAgo(25, NOW), completed_at: daysAgo(25, NOW) }),
    ]
    const result = detectComeback(sessions, NOW)!
    expect(result).not.toBeNull()
    expect(result.benchmarkSessionId).toBe('bench')
    expect(result.comebackSessionsDone).toBe(1)
    expect(result.comebackSessionsTotal).toBe(2)
    expect(result.factor).toBeCloseTo(1.0)
  })

  it('returns null when the comeback is already complete (done >= total)', () => {
    // 20-day gap → total=2; 2 post-gap sessions = done=2, comeback over
    const sessions = [
      makeSession({ id: 'post2', started_at: daysAgo(3, NOW), completed_at: daysAgo(3, NOW) }),
      makeSession({ id: 'post1', started_at: daysAgo(5, NOW), completed_at: daysAgo(5, NOW) }),
      makeSession({ id: 'bench', completed_at: daysAgo(25, NOW) }),
    ]
    expect(detectComeback(sessions, NOW)).toBeNull()
  })
})

// ─── initializeSession ───────────────────────────────────────────────────────

describe('initializeSession', () => {

  // ── top_set exercise ──────────────────────────────────────────────────────

  describe('top_set exercise', () => {
    const ex = makeEx({ working_set_type: 'top_set', working_rep_target: '3-5', weight_increment: 5 })

    it('generates a single top set with null weight when there are no prior logs', () => {
      const sets = initializeSession([ex], [])
      expect(sets).toHaveLength(1)
      expect(sets[0].set_type).toBe('top')
      expect(sets[0].target_weight).toBeNull()
      expect(sets[0].completed).toBe(false)
      expect(sets[0].actual_weight).toBeNull()
    })

    it('carries over the previous weight when progression was not earned', () => {
      const logs = [makeSetLog({ set_type: 'top', set_index: 0, actual_weight: 200, actual_reps: 4 })]
      const sets = initializeSession([ex], logs)
      expect(sets[0].target_weight).toBe(200) // reps < 5, no bump
    })

    it('adds the weight increment when progression is earned', () => {
      const logs = [makeSetLog({ set_type: 'top', set_index: 0, actual_weight: 200, actual_reps: 5 })]
      const sets = initializeSession([ex], logs)
      expect(sets[0].target_weight).toBe(205)
    })

    it('falls back to target_weight when actual_weight is null, and still applies progression', () => {
      const logs = [
        makeSetLog({ set_type: 'top', set_index: 0, actual_weight: null, target_weight: 200, actual_reps: 5 }),
      ]
      const sets = initializeSession([ex], logs)
      expect(sets[0].target_weight).toBe(205) // base=200 from target_weight, earns progression
    })

    it('scales weight by comeback factor and skips progression', () => {
      // 200 * 0.85 = 170; rounds to 170 (nearest 5)
      const logs = [makeSetLog({ set_type: 'top', set_index: 0, actual_weight: 200, actual_reps: 5 })]
      const sets = initializeSession([ex], logs, 0.85)
      expect(sets[0].target_weight).toBe(170)
    })

    it('generates backoff sets at the correct weight', () => {
      const exWithBackoff = makeEx({
        working_set_type: 'top_set',
        backoff_set_count: 2,
        backoff_percentage: 0.8,
        backoff_rep_target: '8',
      })
      const logs = [makeSetLog({ set_type: 'top', set_index: 0, actual_weight: 200, actual_reps: 4 })]
      const sets = initializeSession([exWithBackoff], logs)
      expect(sets).toHaveLength(3) // 1 top + 2 backoff
      expect(sets[1].set_type).toBe('backoff')
      expect(sets[1].target_weight).toBe(160) // 80% of 200
      expect(sets[2].target_weight).toBe(160)
    })
  })

  // ── warmup generation ────────────────────────────────────────────────────

  describe('warmup sets', () => {
    const exWithWarmup = makeEx({
      working_set_type: 'top_set',
      working_rep_target: '3-5',
      warmup_rule: 'percentage_of_top_set',
      warmup_percentages: [0, 0.5, 0.7],
      warmup_reps: [5, 5, 3],
      rounding_increment: 5,
    })

    it('generates warmup sets in order before the top set', () => {
      const logs = [makeSetLog({ set_type: 'top', set_index: 3, actual_weight: 200, actual_reps: 4 })]
      const sets = initializeSession([exWithWarmup], logs)
      expect(sets).toHaveLength(4)
      expect(sets[0]).toMatchObject({ set_type: 'warmup', target_weight: 45 })  // 0% → bar
      expect(sets[1]).toMatchObject({ set_type: 'warmup', target_weight: 100 }) // 50% of 200
      expect(sets[2]).toMatchObject({ set_type: 'warmup', target_weight: 140 }) // 70% of 200
      expect(sets[3]).toMatchObject({ set_type: 'top',    target_weight: 200 })
    })

    it('assigns sequential set_index values across warmup and working sets', () => {
      const logs = [makeSetLog({ set_type: 'top', set_index: 3, actual_weight: 200, actual_reps: 4 })]
      const sets = initializeSession([exWithWarmup], logs)
      expect(sets.map(s => s.set_index)).toEqual([0, 1, 2, 3])
    })

    it('skips warmup sets when working weight is unknown', () => {
      const sets = initializeSession([exWithWarmup], [])
      // No previous logs → workingWeight null → warmups skipped
      expect(sets).toHaveLength(1)
      expect(sets[0].set_type).toBe('top')
    })

    it('generates a dumbbell warmup set', () => {
      const exDB = makeEx({
        working_set_type: 'top_set',
        warmup_rule: 'dumbbell_percentage',
        warmup_db_percentage: 0.3,
        warmup_db_reps: 10,
        rounding_increment: 5,
      })
      const logs = [makeSetLog({ set_type: 'top', set_index: 1, actual_weight: 60, actual_reps: 4 })]
      const sets = initializeSession([exDB], logs)
      expect(sets).toHaveLength(2)
      expect(sets[0].set_type).toBe('warmup')
      expect(sets[0].target_weight).toBe(20) // 60 * 0.3 = 18 → 20
    })

    it('generates a fixed-weight warmup set', () => {
      const exFixed = makeEx({
        working_set_type: 'top_set',
        warmup_rule: 'fixed_weight',
        warmup_fixed_weight: 45,
        warmup_fixed_reps: 8,
      })
      const logs = [makeSetLog({ set_type: 'top', set_index: 1, actual_weight: 200, actual_reps: 4 })]
      const sets = initializeSession([exFixed], logs)
      expect(sets[0]).toMatchObject({ set_type: 'warmup', target_weight: 45, target_reps: '8' })
    })
  })

  // ── straight_sets exercise ───────────────────────────────────────────────

  describe('straight_sets exercise', () => {
    const ex = makeEx({
      working_set_type: 'straight_sets',
      working_set_count: 3,
      working_rep_target: '8',
      weight_increment: 2.5,
      rounding_increment: 2.5,
    })

    const prevLogs = (reps: number) =>
      [0, 1, 2].map(i =>
        makeSetLog({ set_type: 'working', set_index: i, actual_weight: 100, actual_reps: reps }),
      )

    it('generates the correct number of working sets', () => {
      const sets = initializeSession([ex], prevLogs(7))
      expect(sets).toHaveLength(3)
      expect(sets.every(s => s.set_type === 'working')).toBe(true)
    })

    it('applies progression when every set hits the rep target', () => {
      const sets = initializeSession([ex], prevLogs(8))
      expect(sets[0].target_weight).toBe(102.5)
    })

    it('does not progress when at least one set missed the rep target', () => {
      const logs = [
        makeSetLog({ set_type: 'working', set_index: 0, actual_weight: 100, actual_reps: 8 }),
        makeSetLog({ set_type: 'working', set_index: 1, actual_weight: 100, actual_reps: 8 }),
        makeSetLog({ set_type: 'working', set_index: 2, actual_weight: 100, actual_reps: 7 }), // missed
      ]
      const sets = initializeSession([ex], logs)
      expect(sets[0].target_weight).toBe(100)
    })
  })

  // ── exercise ordering ────────────────────────────────────────────────────

  describe('exercise ordering', () => {
    it('sorts exercises by position, not input order', () => {
      const exA = makeEx({ id: 'a', position: 1 })
      const exB = makeEx({ id: 'b', position: 0 })
      const sets = initializeSession([exA, exB], [])
      // exB (position 0) should come first
      expect(sets[0].exercise_template_id).toBe('b')
      expect(sets[1].exercise_template_id).toBe('a')
    })
  })
})
