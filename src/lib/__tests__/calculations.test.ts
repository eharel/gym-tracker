import { describe, expect, it } from 'vitest'
import {
  buildWeekPlan,
  calcBackoffWeight,
  calcDumbbellWarmup,
  calcStaleness,
  calcWarmupWeight,
  detectLayoff,
  getNextWorkoutTemplate,
  hasEarnedProgression,
  initializeSession,
  movementKey,
  parseRepRangeMax,
  pickFeaturedSlot,
  planFromHistory,
  startOfWeek,
  type HistoryLog,
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
    bar_type: 'none',
    alternate_exercise_id: null,
    is_alternate_only: false,
    movement_id: null,
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
    scheduled_days: null,
    is_optional: false,
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

// ─── calcWarmupWeight: 0% uses the exercise's own bar ───────────────────────

describe('calcWarmupWeight bar weight', () => {
  it('defaults the empty-bar case to a 45 lb barbell', () => {
    expect(calcWarmupWeight(200, 0)).toBe(45)
  })
  it('uses the given bar weight for non-standard bars', () => {
    expect(calcWarmupWeight(200, 0, 5, 25)).toBe(25)  // EZ bar
    expect(calcWarmupWeight(200, 0, 5, 65)).toBe(65)  // safety squat bar
  })
  it('ignores bar weight for non-zero percentages', () => {
    expect(calcWarmupWeight(200, 0.5, 5, 25)).toBe(100)
  })
})

// ─── calcDumbbellWarmup ──────────────────────────────────────────────────────

describe('calcDumbbellWarmup', () => {
  it('applies the default percentage (60%) and rounds to 5', () => {
    // 100 * 0.6 = 60
    expect(calcDumbbellWarmup(100)).toBe(60)
  })

  // Dumbbell loads are small in absolute terms, so a barbell-style low
  // percentage produces a warmup too light to prime anything
  it('produces a usable primer for realistic dumbbell loads', () => {
    expect(calcDumbbellWarmup(40)).toBe(25)  // not 15
    expect(calcDumbbellWarmup(45)).toBe(25)
    expect(calcDumbbellWarmup(55)).toBe(35)
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

// ─── detectLayoff ─────────────────────────────────────────────────────────────

describe('detectLayoff', () => {
  const NOW = new Date('2026-06-01T12:00:00Z')
  const sess = (id: string, startDaysAgo: number, doneDaysAgo = startDaysAgo) =>
    makeSession({ id, started_at: daysAgo(startDaysAgo, NOW), completed_at: daysAgo(doneDaysAgo, NOW) })

  it('returns null with no sessions', () => {
    expect(detectLayoff([], NOW)).toBeNull()
  })

  it('returns null when training has been continuous', () => {
    expect(detectLayoff([sess('a', 2), sess('b', 9), sess('c', 20)], NOW)).toBeNull()
  })

  it('detects an ongoing layoff right at the 14-day threshold', () => {
    const l = detectLayoff([sess('a', 14)], NOW)!
    expect(l.endedAt).toBeNull()
    expect(l.gapDays).toBeCloseTo(14)
  })

  it('detects a past layoff between two sessions', () => {
    const l = detectLayoff([sess('back', 5), sess('before', 30)], NOW)!
    expect(l.startedAt).toBe(daysAgo(30, NOW))
    expect(l.endedAt).toBe(daysAgo(5, NOW))
    expect(l.gapDays).toBeCloseTo(25)
  })

  it('returns the most recent layoff when there are several', () => {
    const l = detectLayoff([sess('a', 2), sess('b', 20), sess('c', 60), sess('d', 100)], NOW)!
    expect(l.gapDays).toBeCloseTo(18)  // b → a, not c → b
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

// ─── planFromHistory ──────────────────────────────────────────────────────────

describe('planFromHistory', () => {
  const NOW = new Date('2026-09-21T12:00:00Z')
  const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
  /** A layoff that began `from` days ago and ended `to` days ago (null = ongoing). */
  const layoff = (from: number, to: number | null) => ({
    startedAt: day(from),
    endedAt: to === null ? null : day(to),
    gapDays: from - (to ?? 0),
  })

  /** A completed working-set log in a session `daysAgo` days old. */
  function hlog(opts: {
    session: string
    exercise: string
    daysAgo: number
    weight?: number | null
    reps?: number
    type?: SetLog['set_type']
    index?: number
    completed?: boolean
  }): HistoryLog {
    return {
      ...makeSetLog({
        session_id: opts.session,
        exercise_template_id: opts.exercise,
        set_type: opts.type ?? 'top',
        set_index: opts.index ?? 0,
        actual_weight: opts.weight === undefined ? 100 : opts.weight,
        actual_reps: opts.reps ?? 4,
        completed: opts.completed ?? true,
      }),
      session_started_at: day(opts.daysAgo),
      session_completed_at: day(opts.daysAgo),
    }
  }
  const same = (id: string) => id

  it('uses the last performance and remaps logs onto the exercise id', () => {
    const ex = makeEx({ id: 'ohp' })
    const plan = planFromHistory([ex], [
      hlog({ session: 'new', exercise: 'ohp', daysAgo: 3, weight: 95 }),
      hlog({ session: 'old', exercise: 'ohp', daysAgo: 10, weight: 90 }),
    ], same, null)
    expect(plan.refLogs.map(l => l.actual_weight)).toEqual([95])
    expect(plan.lastLogs.every(l => l.exercise_template_id === 'ohp')).toBe(true)
    expect(plan.comebacks).toEqual({})
  })

  it('skips a session where the movement was skipped (nothing completed)', () => {
    const ex = makeEx({ id: 'ohp' })
    const plan = planFromHistory([ex], [
      hlog({ session: 'skipped', exercise: 'ohp', daysAgo: 3, weight: null, completed: false }),
      hlog({ session: 'done', exercise: 'ohp', daysAgo: 10, weight: 90 }),
    ], same, null)
    expect(plan.refLogs.map(l => l.actual_weight)).toEqual([90])
    expect(plan.lastLogs.map(l => l.actual_weight)).toEqual([90])
  })

  it('pulls history from another program\'s copy of the same movement', () => {
    const weeklySquat = makeEx({ id: 'weekly-squat', movement_id: 'ab-squat' })
    const movementOf = (id: string) => (id === 'weekly-squat' || id === 'ab-squat' ? 'ab-squat' : id)
    const plan = planFromHistory([weeklySquat], [
      hlog({ session: 's1', exercise: 'ab-squat', daysAgo: 5, weight: 290, reps: 2 }),
    ], movementOf, null)
    expect(plan.refLogs).toHaveLength(1)
    expect(plan.refLogs[0].exercise_template_id).toBe('weekly-squat')
    expect(plan.refLogs[0].actual_weight).toBe(290)
  })

  it('keeps movements apart even when they share a session', () => {
    const squat = makeEx({ id: 'squat' })
    const rdl = makeEx({ id: 'rdl' })
    const plan = planFromHistory([squat, rdl], [
      hlog({ session: 's1', exercise: 'squat', daysAgo: 5, weight: 290 }),
      hlog({ session: 's1', exercise: 'rdl', daysAgo: 5, weight: 185 }),
    ], same, null)
    expect(plan.refLogs.find(l => l.exercise_template_id === 'squat')?.actual_weight).toBe(290)
    expect(plan.refLogs.find(l => l.exercise_template_id === 'rdl')?.actual_weight).toBe(185)
  })

  it('does not ramp a lift that was only rotated out while training continued', () => {
    const ohp = makeEx({ id: 'ohp' })  // untouched for 44 days, but no layoff
    const plan = planFromHistory([ohp], [
      hlog({ session: 's0', exercise: 'ohp', daysAgo: 44, weight: 110 }),
    ], same, null)
    expect(plan.comebacks).toEqual({})
    expect(plan.refLogs.map(l => l.actual_weight)).toEqual([110])
  })

  it('ramps every lift during an ongoing layoff, from its last weight', () => {
    const squat = makeEx({ id: 'squat' })
    const plan = planFromHistory([squat], [
      hlog({ session: 's0', exercise: 'squat', daysAgo: 30, weight: 290 }),
    ], same, layoff(30, null))
    expect(plan.comebacks.squat?.comebackSessionsDone).toBe(0)
    expect(plan.comebacks.squat?.factor).toBeCloseTo(0.75)
  })

  it.each([
    [20, 2, 0.85],
    [35, 3, 0.75],
    [45, 4, 0.65],
    [90, 4, 0.60],
  ])('a %i-day break ramps over %i sessions from %d', (gap, total, start) => {
    const ex = makeEx({ id: 'squat' })
    const plan = planFromHistory([ex], [
      hlog({ session: 's0', exercise: 'squat', daysAgo: gap, weight: 290 }),
    ], same, layoff(gap, null))
    expect(plan.comebacks.squat?.comebackSessionsTotal).toBe(total)
    expect(plan.comebacks.squat?.factor).toBeCloseTo(start)
  })

  it('counts each lift\'s own appearances since the layoff', () => {
    const ex = makeEx({ id: 'bench' })
    // 35-day break (3-session ramp); one bench session since, still below 290
    const plan = planFromHistory([ex], [
      hlog({ session: 'back', exercise: 'bench', daysAgo: 5, weight: 220 }),
      hlog({ session: 'pre', exercise: 'bench', daysAgo: 40, weight: 290 }),
    ], same, layoff(40, 5))
    expect(plan.comebacks.bench?.comebackSessionsDone).toBe(1)
    expect(plan.refLogs.map(l => l.actual_weight)).toEqual([290])   // weights from pre-break
    expect(plan.lastLogs.map(l => l.actual_weight)).toEqual([220])  // deltas vs last time
  })

  it('ramps a lift not yet done since a past layoff from its first appearance', () => {
    const ohp = makeEx({ id: 'ohp' })
    const plan = planFromHistory([ohp], [
      hlog({ session: 'pre', exercise: 'ohp', daysAgo: 40, weight: 100 }),
    ], same, layoff(40, 5))
    expect(plan.comebacks.ohp?.comebackSessionsDone).toBe(0)
  })

  it('ends a comeback early once a session since the break matched the benchmark', () => {
    const ex = makeEx({ id: 'bench' })
    const plan = planFromHistory([ex], [
      hlog({ session: 'back', exercise: 'bench', daysAgo: 5, weight: 240 }),
      hlog({ session: 'pre', exercise: 'bench', daysAgo: 30, weight: 235 }),
    ], same, layoff(30, 5))
    expect(plan.comebacks.bench).toBeUndefined()
    expect(plan.refLogs.map(l => l.actual_weight)).toEqual([240])
  })

  it('ends a comeback once the lift has had its full ramp', () => {
    const ex = makeEx({ id: 'bench' })
    // 20-day break → 2-session ramp, both done (below benchmark, but ramp over)
    const plan = planFromHistory([ex], [
      hlog({ session: 'r2', exercise: 'bench', daysAgo: 2, weight: 225 }),
      hlog({ session: 'r1', exercise: 'bench', daysAgo: 5, weight: 205 }),
      hlog({ session: 'pre', exercise: 'bench', daysAgo: 25, weight: 235 }),
    ], same, layoff(25, 5))
    expect(plan.comebacks.bench).toBeUndefined()
  })

  it('falls back to newest logs when never performed (rep prefill parity)', () => {
    const ex = makeEx({ id: 'ohp' })
    const plan = planFromHistory([ex], [
      hlog({ session: 's1', exercise: 'ohp', daysAgo: 3, weight: null, reps: 6, completed: false }),
    ], same, null)
    expect(plan.lastLogs.map(l => l.actual_reps)).toEqual([6])
  })

  it('drives initializeSession with per-exercise comeback factors', () => {
    const squat = makeEx({ id: 'squat' })
    const ohp = makeEx({ id: 'ohp' })
    // 25-day break; squat already back at full, OHP not done since
    const plan = planFromHistory([squat, ohp], [
      hlog({ session: 'back', exercise: 'squat', daysAgo: 5, weight: 290, reps: 2 }),
      hlog({ session: 'pre', exercise: 'squat', daysAgo: 30, weight: 290, reps: 2 }),
      hlog({ session: 'pre', exercise: 'ohp', daysAgo: 30, weight: 100, reps: 4 }),
    ], same, layoff(30, 5))
    const factors = Object.fromEntries(Object.entries(plan.comebacks).map(([id, c]) => [id, c.factor]))
    const sets = initializeSession([squat, ohp], plan.refLogs, factors)
    expect(sets.find(s => s.exercise_template_id === 'squat')?.target_weight).toBe(290) // full
    expect(sets.find(s => s.exercise_template_id === 'ohp')?.target_weight).toBe(75)    // 100 × 0.75
  })
})

describe('movementKey', () => {
  it('is the row id for an original and the original\'s id for a copy', () => {
    expect(movementKey({ id: 'a', movement_id: null })).toBe('a')
    expect(movementKey({ id: 'b', movement_id: 'a' })).toBe('a')
  })
})

// ─── Weekly schedule ──────────────────────────────────────────────────────────

describe('startOfWeek', () => {
  it('returns Monday 00:00 for any day of the week', () => {
    const mon = startOfWeek(new Date(2026, 8, 21, 15, 0))  // Mon Sep 21
    const sun = startOfWeek(new Date(2026, 8, 27, 23, 0))  // Sun Sep 27
    expect(mon.getDay()).toBe(1)
    expect(mon.getDate()).toBe(21)
    expect(mon.getHours()).toBe(0)
    expect(sun.getDate()).toBe(21)  // Sunday belongs to the week that started Monday
  })
})

describe('buildWeekPlan', () => {
  // JS weekdays: Sun 0 … Sat 6
  const mon    = makeTemplate({ id: 'mon', scheduled_days: [1] })
  const tue    = makeTemplate({ id: 'tue', scheduled_days: [2], is_optional: true })
  const wed    = makeTemplate({ id: 'wed', scheduled_days: [3] })
  const friSat = makeTemplate({ id: 'fs',  scheduled_days: [5, 6] })
  const sun    = makeTemplate({ id: 'sun', scheduled_days: [0] })
  const all = [sun, friSat, wed, tue, mon]   // deliberately unordered
  const done = (templateId: string, when: Date) =>
    makeSession({ id: templateId + when.getTime(), workout_template_id: templateId, completed_at: when.toISOString() })

  it('orders slots Monday → Sunday', () => {
    const plan = buildWeekPlan(all, [], new Date(2026, 8, 21, 12))
    expect(plan.map(s => s.template.id)).toEqual(['mon', 'tue', 'wed', 'fs', 'sun'])
  })

  it('marks today, missed, skipped (optional) and upcoming by weekday', () => {
    const thu = new Date(2026, 8, 24, 12)  // Thursday
    const plan = buildWeekPlan(all, [done('wed', new Date(2026, 8, 23, 12))], thu)
    const status = Object.fromEntries(plan.map(s => [s.template.id, s.status]))
    expect(status).toEqual({ mon: 'missed', tue: 'skipped', wed: 'done', fs: 'upcoming', sun: 'upcoming' })
  })

  it('treats a multi-day workout as today on either of its days', () => {
    const sat = new Date(2026, 8, 26, 12)
    expect(buildWeekPlan([friSat], [], sat)[0].status).toBe('today')
  })

  it('ignores sessions completed before this week', () => {
    const lastSunday = new Date(2026, 8, 20, 12)
    const plan = buildWeekPlan([mon], [done('mon', lastSunday)], new Date(2026, 8, 21, 12))
    expect(plan[0].status).toBe('today')
  })

  it('leaves rotation-style workouts (no days) out of the plan', () => {
    const rotation = makeTemplate({ id: 'a', scheduled_days: null })
    expect(buildWeekPlan([rotation, mon], [], new Date(2026, 8, 21, 12)).map(s => s.template.id)).toEqual(['mon'])
  })
})

describe('pickFeaturedSlot', () => {
  const t = (id: string, optional = false) => makeTemplate({ id, is_optional: optional })
  it('prefers today, then the next required session, then a missed one', () => {
    expect(pickFeaturedSlot([
      { template: t('a'), days: [0], status: 'missed' },
      { template: t('b'), days: [2], status: 'today' },
    ])?.template.id).toBe('b')
    expect(pickFeaturedSlot([
      { template: t('opt', true), days: [1], status: 'upcoming' },
      { template: t('req'), days: [2], status: 'upcoming' },
    ])?.template.id).toBe('req')
    expect(pickFeaturedSlot([
      { template: t('a'), days: [0], status: 'missed' },
      { template: t('b'), days: [1], status: 'done' },
    ])?.template.id).toBe('a')
  })
  it('returns null when everything is done', () => {
    expect(pickFeaturedSlot([{ template: t('a'), days: [0], status: 'done' }])).toBeNull()
  })
})
