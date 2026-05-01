# Gym Tracker — Product Specification
**v0.2 — Updated Draft**

---

## 1. Overview

A web-based workout tracking app designed to replace a manual Google Calendar system. The core insight driving the design: serious strength training programs have internal logic — warmup weights derive from working weights, set types relate to each other, progression follows defined rules — and no existing app models this. This app captures that logic so the lifter only enters what actually changes session to session.

The app is designed to grow in three phases:

- **V1 — Configurable:** Program lives in the database. User can add workouts, swap exercises, and edit any parameter through the UI. Calculation logic (warmup percentages, back-off weights, staleness) is opinionated and built-in.
- **V2 — Parameterized rules:** Each exercise can select from a menu of named rule types (e.g. `percentage_of_top_set` vs `fixed_weight` vs `dumbbell_warmup`). Logic is still code, but users choose between behaviors.
- **V3 — Rule engine:** Rules become user-definable. Users can specify their own progression logic, warmup formulas, and staleness triggers without touching code.

> **Note:** This spec covers V1 in full. V2 and V3 are described at an architectural level to ensure V1 decisions do not foreclose those paths.

---

## 2. Problem Statement

The current workflow for each gym session:

- Open Google Calendar, find the last session of the same workout type
- Copy all text from that event into a new event on today's date
- Manually update every changed value — new weights, rep counts, notes
- Recalculate warmup set percentages by hand whenever the top set changes
- Manually track sessions elapsed since last weight increase per exercise
- Do all of this on a phone keyboard inside a plain-text field with no formatting

This is error-prone and time-consuming. It also creates no queryable history — looking up a PR or a trend requires scrolling through calendar events manually.

---

## 3. Goals

### V1 must-haves

- Automatically determine and display the correct next workout based on session history
- Auto-calculate warmup set weights from the current top set weight
- Auto-calculate back-off set weights from the current top set weight
- Track staleness per exercise (sessions elapsed since last progression)
- Allow full in-session editing of weights and reps with minimal taps
- Persist all session data across app launches (Supabase backend)
- Allow the user to edit their program — add/remove workouts, add/remove/reorder exercises, change any parameter — without touching code
- Support optional exercises (exercises that can be skipped on a given session)
- Support supersets (exercises grouped and displayed together)

### Explicit non-goals for V1

- Offline support — gym has reliable WiFi
- Social features
- AI programming recommendations
- Cardio or non-barbell-primary tracking
- Wearable integration
- User accounts / multi-user support

---

## 4. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | React + Vite + TypeScript | Web app, PWA-capable for home screen install on phone |
| Styling | Tailwind CSS | Utility-first, fast to build with Claude Code |
| State management | Zustand | Lightweight, pairs well with async Supabase calls |
| Backend / DB | Supabase | Postgres hosted, free tier, real-time capable, auth built-in |
| Deployment | Vercel | Free tier, auto-deploy from GitHub, zero config |
| Testing | Vitest | For calculation logic unit tests — critical to get right before wiring UI |

> **Note:** The app is a PWA (Progressive Web App). On iOS Safari, "Add to Home Screen" installs it as a fullscreen app icon — no App Store, no developer account required. This is the primary delivery mechanism.

---

## 5. Data Model

Six core tables. All primary keys are UUIDs. Timestamps are ISO 8601 with timezone.

### 5.1 programs

```sql
programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,          -- e.g. 'Full Body A/B'
  description text,
  is_active   boolean DEFAULT false,  -- only one active at a time
  created_at  timestamptz DEFAULT now()
)
```

### 5.2 workout_templates

```sql
workout_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       uuid REFERENCES programs(id) ON DELETE CASCADE,
  name             text NOT NULL,     -- e.g. 'Full Body A'
  order_in_program integer NOT NULL,  -- 0-based; determines alternation sequence
  warmup_text      text,              -- plain text warmup protocol
  cooldown_text    text,              -- plain text cooldown protocol
  created_at       timestamptz DEFAULT now()
)
```

### 5.3 exercise_templates

```sql
exercise_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_template_id  uuid REFERENCES workout_templates(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  position             integer NOT NULL,       -- display order, 0-based
  rpe_target           text,                   -- e.g. '8-9', stored as string
  notes                text,                   -- coaching cues
  superset_group       text,                   -- nullable; shared value = grouped
  is_optional          boolean DEFAULT false,  -- can be skipped per session

  -- Warmup configuration
  warmup_rule          text NOT NULL DEFAULT 'percentage_of_top_set',
                       -- enum: percentage_of_top_set | dumbbell_percentage |
                       --       fixed_weight | none
  warmup_percentages   jsonb,   -- array of floats e.g. [0, 0.45, 0.65, 0.85]
                       -- 0 = empty bar (45 lbs), only valid for percentage rules
  warmup_reps          jsonb,   -- array of integers e.g. [10, 5, 3, 1]
  warmup_db_percentage float,  -- for dumbbell_percentage rule, e.g. 0.325
  warmup_db_reps       integer,
  warmup_fixed_weight  float,  -- for fixed_weight rule
  warmup_fixed_reps    integer,

  -- Working set configuration
  working_set_count    integer NOT NULL DEFAULT 1,
  working_set_type     text NOT NULL DEFAULT 'top_set',
                       -- enum: top_set | straight_sets | amrap
  working_rep_target   text,   -- e.g. '2-4', '6-8', 'AMRAP' (string)

  -- Back-off set configuration
  backoff_set_count    integer NOT NULL DEFAULT 0,
  backoff_percentage   float,  -- fraction of top set weight e.g. 0.81
  backoff_rep_target   text,   -- e.g. '8-10'

  -- Progression
  weight_increment     float DEFAULT 5.0,  -- lbs to add on progression
  rounding_increment   float DEFAULT 5.0,  -- nearest lbs to round auto-calc weights

  created_at           timestamptz DEFAULT now()
)
```

> **Note:** `warmup_rule` is the V1 foundation for V2's parameterized rule system. In V1, the app ships with logic for all four rule types. In V2, new rule types are added here without schema changes.

### 5.4 sessions

```sql
sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_template_id uuid REFERENCES workout_templates(id),
  started_at          timestamptz DEFAULT now(),
  completed_at        timestamptz,   -- null = session in progress
  notes               text
)
```

### 5.5 set_logs

```sql
set_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_template_id uuid REFERENCES exercise_templates(id),
  set_index            integer NOT NULL,   -- 0-based position within exercise
  set_type             text NOT NULL,
                       -- enum: warmup | top | backoff | working | amrap
  target_weight        float,   -- auto-calculated at session start
  actual_weight        float,   -- what the user lifted (may differ from target)
  target_reps          text,    -- from template e.g. '2-4'
  actual_reps          integer, -- what the user actually completed
  is_weight_override   boolean DEFAULT false, -- user manually changed target_weight
  completed            boolean DEFAULT false,
  created_at           timestamptz DEFAULT now()
)
```

### 5.6 exercise_notes (V1.5)

```sql
exercise_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_template_id uuid REFERENCES exercise_templates(id),
  note                 text NOT NULL,
  created_at           timestamptz DEFAULT now()
)
```

Per-session notes on a specific exercise (e.g. "felt shaky on set 3"). Distinct from the template-level coaching notes.

---

## 6. Calculation Logic

All calculation logic lives in a single file: `src/lib/calculations.ts`. These are pure functions — no database calls, no side effects. Claude Code should write full Vitest unit tests for every function before wiring to the UI.

### 6.1 Warmup weight calculation

#### Rule: `percentage_of_top_set`

Used by: Squat, Bench Press, Deadlift, Incline Bench, Overhead Press.

```typescript
function calcWarmupWeight(
  topSetWeight: number,
  percentage: number,
  roundingIncrement: number = 5
): number {
  if (percentage === 0) return 45; // empty bar, always
  const raw = topSetWeight * percentage;
  return Math.round(raw / roundingIncrement) * roundingIncrement;
}
```

#### Rule: `dumbbell_percentage`

Used by: Barbell RDL (warmup), Pendlay Row (warmup), Lat Pulldown (warmup). Calculates a per-hand dumbbell weight as a percentage of the barbell working weight, rounded to nearest 5 lbs.

```typescript
function calcDumbbellWarmup(
  workingWeight: number,
  dbPercentage: number = 0.325, // 32.5% per hand default
  roundingIncrement: number = 5
): number {
  const raw = workingWeight * dbPercentage;
  return Math.round(raw / roundingIncrement) * roundingIncrement;
}
```

#### Rule: `fixed_weight`

Used by: Bulgarian Split Squat (bodyweight warmup). Returns the fixed weight as stored on the template, no calculation needed.

#### Rule: `none`

Used by: Pull-ups, Face Pulls, Leg Curls. No warmup sets generated.

### 6.2 Back-off set weight calculation

```typescript
function calcBackoffWeight(
  topSetWeight: number,
  backoffPercentage: number,
  roundingIncrement: number = 5
): number {
  const raw = topSetWeight * backoffPercentage;
  return Math.round(raw / roundingIncrement) * roundingIncrement;
}
```

Back-off percentages by exercise:

| Exercise | Back-off % | Notes |
|---|---|---|
| Squat | 81% | ~80-85% of top set |
| Bench Press | 85% | ~80-85% of top set |
| Deadlift | — | No back-off set in current program |
| Incline Bench | 83% | ~80-85% of top set |
| Overhead Press | 78% | ~75-80% of top set |

### 6.3 Staleness counter

Counts consecutive completed sessions for a given exercise where the top set weight did NOT increase. Resets when `actual_reps >= upper bound of rep range target`, or when weight increases.

```typescript
function calcStaleness(
  exerciseTemplateId: string,
  sessionHistory: SetLog[]  // ordered newest-first
): number {
  let count = 0;
  let prevTopWeight: number | null = null;
  for (const log of sessionHistory) {
    if (log.set_type !== 'top') continue;
    if (prevTopWeight === null) { prevTopWeight = log.actual_weight; continue; }
    if (log.actual_weight < prevTopWeight) { count++; }
    else { break; } // weight increased, stop counting
    prevTopWeight = log.actual_weight;
  }
  return count;
}

function parseRepRangeMax(repTarget: string): number | null {
  // '2-4' -> 4, 'AMRAP' -> null, '8' -> 8
  if (repTarget === 'AMRAP') return null;
  const parts = repTarget.split('-');
  return parseInt(parts[parts.length - 1]);
}
```

Display rule: staleness counter is hidden when 0. Shown in muted gray at 1-2. Shown in amber with a nudge indicator at 3+.

### 6.4 Progression trigger detection

Determines whether the user has earned a weight increase on a given exercise in the completed session.

```typescript
function hasEarnedProgression(
  repTarget: string,   // e.g. '2-4'
  actualReps: number
): boolean {
  const max = parseRepRangeMax(repTarget);
  if (max === null) return false; // AMRAP never auto-triggers
  return actualReps >= max;
}
```

When this returns true at session completion, the app shows a subtle indicator on the exercise: "Ready to increase weight next session." It does not auto-increment — the user confirms the new weight at the start of the next session.

### 6.5 Next workout determination

```typescript
function getNextWorkoutTemplate(
  programId: string,
  sessions: Session[],         // all sessions for this program, newest-first
  templates: WorkoutTemplate[] // all templates for this program
): WorkoutTemplate {
  if (sessions.length === 0) return templates[0];
  const lastTemplateId = sessions[0].workout_template_id;
  const lastTemplate = templates.find(t => t.id === lastTemplateId);
  const nextOrder = (lastTemplate.order_in_program + 1) % templates.length;
  return templates.find(t => t.order_in_program === nextOrder);
}
```

### 6.6 Session initialization

When a user starts a new session, the app generates `set_logs` pre-populated with target weights derived from the most recent completed session of the same workout type.

```typescript
function initializeSession(
  template: WorkoutTemplate,
  lastSession: Session | null,   // most recent session of same template
  lastSetLogs: SetLog[]          // set_logs from lastSession
): SetLog[] {
  // For each exercise in template:
  //   Find last top set weight for that exercise from lastSetLogs
  //   Apply warmup rule to generate warmup set targets
  //   Set working set targets from template
  //   Apply backoff rule if applicable
}
```

> **Note:** If `lastSession` is null (first ever session of this type), warmup target weights are populated from the seed data defaults and a banner is shown: "First session — confirm your starting weights before beginning."

---

## 7. Screens

### 7.1 Home

- Stats row: total sessions logged, sessions this month, top PR for primary lift (Squat)
- "Up next" card — highlighted with accent border, shows workout name + exercise name preview, tap to begin
- "Last session" card — muted styling, shows workout name + date, tap to review (read-only)
- No full history list in V1 — keep it focused

### 7.2 Active workout

The primary screen. Shown when user taps a workout card to begin a session.

- Warmup protocol at top — collapsible plain text block
- Exercise cards in order, with superset labels between grouped exercises
- Each exercise card contains:
  - Exercise name, RPE badge, optional coaching notes
  - Column headers: Set | Type | Weight | Reps | ✓
  - One row per set — set label, set type tag, weight input, reps input, done checkbox
  - Staleness indicator below working sets (hidden at 0, gray at 1-2, amber at 3+)
  - "Skip this exercise" toggle for optional exercises
- Cooldown protocol at bottom — collapsible plain text block
- "Complete session" button — saves session and all set_logs, navigates to session summary

#### Weight input behavior

- Tapping a weight field opens a numeric input (native numeric keyboard on mobile)
- Changing the top set weight for an exercise immediately recalculates all warmup and back-off target weights for that exercise — live, in the current session
- Recalculation only affects sets not yet marked complete
- User can manually enter any weight value; if it differs from the auto-calculated target, `is_weight_override` is flagged true in the set_log
- Weight overrides persist for that session only — they do not modify the template

#### Session resume

If the app is closed mid-session, the incomplete session persists in Supabase (`completed_at` is null). On next app open, a banner offers to resume the in-progress session.

### 7.3 Session summary

Shown immediately after completing a session.

- Session duration
- Total volume lifted (sum of weight × reps across all working sets)
- Exercises where progression was earned — "Ready to increase weight next session"
- Option to add a session note
- "Done" returns to Home

### 7.4 Program editor

Accessible from a settings icon on Home. Allows full CRUD on the active program.

- Add / rename / reorder / delete workout templates
- Add / rename / reorder / delete exercises within a workout
- Edit any exercise parameter: RPE, warmup rule and values, working sets, back-off %, rep targets, weight increment, rounding increment, notes, superset group, optional flag
- Edit warmup and cooldown text for each workout template

> ⚠️ **The program editor is a V1 requirement, not a V2 stretch goal.** Without it, the app cannot evolve with the user's program and becomes stale.

### 7.5 Exercise history (V1.5)

Accessible by tapping an exercise name in read-only mode. Shows a simple chart of top set weight over time, plus a log of recent sessions for that exercise.

---

## 8. Seed Data

The app ships with one program pre-loaded: "Full Body A/B". All weights in lbs. This data is inserted via a Supabase seed SQL file and should be idempotent (safe to re-run).

### 8.1 Full Body A

**Warmup:** 3 min brisk walk · 10 leg swings (straight + side) · 10 arm circles · 3 inchworms

**Cooldown:** Hip flexor stretch 30s/side · Hamstring stretch 30s/side · Doorway pec stretch 30s/side · Child's pose 45-60s

| # | Exercise | RPE | Warmup rule | Working sets | Back-off | Superset | Optional |
|---|---|---|---|---|---|---|---|
| 1 | Squat | 8-9 | 4 sets @ 0/45/65/85% → 10/5/3/1 reps | 1 × 2-4 (top set) | 1 × 8-10 @ 81% | — | No |
| 2 | Bench Press | 8-9 | 4 sets @ 0/45/65/85% → 10/5/3/1 reps | 1 × 3-5 (top set) | 1 × 8-10 @ 85% | — | No |
| 3 | Barbell RDL | 8 | DB @ 32.5% per hand × 10 reps | 3 × 8-10 (straight) | — | — | No |
| 4 | Pendlay Row | 8 | DB @ 32.5% per hand × 8 reps | 3 × 6-8 (straight) | — | — | No |
| 5 | Pull-ups | 8 | None | 3 × AMRAP | — | Leg raises | No |
| 6a | EZ Bar Curls | 8 | None | 2 × 10-12 (straight) | — | 6b | No |
| 6b | Overhead Tri Ext | 8 | None | 2 × 10-12 (straight) | — | 6a | No |

**Starting weights:**

| Exercise | Top set weight | Back-off weight |
|---|---|---|
| Squat | 290 lbs | 235 lbs |
| Bench Press | 230 lbs | 195 lbs |
| Barbell RDL | 190 lbs | — |
| Pendlay Row | 155 lbs | — |
| Pull-ups | BW (0 lbs) | — |
| EZ Bar Curls | 60 lbs total (30/side) | — |
| Overhead Tri Ext | 47.5 lbs | — |

### 8.2 Full Body B

**Warmup:** Same as Full Body A.

**Cooldown:** 2-3 min gentle cardio · Standing hamstring stretch 30s/side · Hip flexor stretch 30s/side · Lat stretch 30s/side · Doorway pec stretch 30s/side · Cat-cow stretch 8-10 cycles

| # | Exercise | RPE | Warmup rule | Working sets | Back-off | Superset | Optional |
|---|---|---|---|---|---|---|---|
| 1 | Deadlift (Conv.) | 8-9 | 4 sets @ 0/45/65/85% → 10/5/3/1 reps | 1 × 3-5 (top set) | — | — | No |
| 2 | Incline Bench | 8-9 | 3 sets @ 0/~54/~66% → 10/5/3 reps | 1 × 6-8 (top set) | 1 × 10-12 @ 83% | — | No |
| 3 | Bulgarian Split Squat | 8 | BW × 10 each leg (fixed) | 3 × 8-10/leg (straight) | — | Ab crunches | No |
| 4 | Lat Pulldown (wide) | 8 | Fixed: 100 lbs × 10 | 3 × 8-10 (straight) | — | — | No |
| 5 | Standing OHP | 8-9 | 2 sets @ 0/~68% → 10/5 reps | 1 × 5-8 (top set) | 1 × 10-12 @ 78% | Ab crunches | No |
| 6 | Face Pulls / Rear Delt Flyes | 8 | None | 3 × 12-15 (straight) | — | — | No |
| 7 | Leg Curls | 8-9 | None | 2 × 10-12 (straight) | — | — | Yes |

**Starting weights:**

| Exercise | Top set weight | Back-off weight | Notes |
|---|---|---|---|
| Deadlift | 265 lbs | — | Form check flagged at 275 lbs — do not auto-suggest above 275 until user clears flag |
| Incline Bench | 175 lbs | 145 lbs | |
| Bulgarian Split Squat | 45 lbs DBs | — | Max previously reached: 55 lbs |
| Lat Pulldown | 160 lbs | — | |
| Standing OHP | 95 lbs | 75 lbs | |
| Face Pulls | 47.5 lbs | — | Cable weight |
| Leg Curls | 80 lbs | — | Optional exercise |

> **Note:** The Deadlift form flag is a one-time seed data annotation. In V1, implement as a coaching note on the exercise template: "Stop at 275 lbs to check form before increasing further." The app does not enforce weight caps — it is informational only.

---

## 9. Edge Cases

- **First session ever:** No prior data exists. Populate target weights from seed defaults. Show banner: "First session — confirm your starting weights."
- **Top set weight changed mid-session:** Recalculate warmup and back-off targets live. Only affect sets not yet marked complete.
- **Set unchecked after being marked complete:** Weight and reps fields become editable again. Staleness recalculates on session save.
- **Optional exercise skipped:** No set_logs written for that exercise in that session. Staleness counter pauses (does not increment) for skipped sessions.
- **App closed mid-session:** Session row exists with `completed_at = null`. On re-open, banner prompts user to resume or discard.
- **Bodyweight exercises (Pull-ups):** Weight field shows "0 lbs" with a "+" affordance for added weight. AMRAP reps field accepts any positive integer.
- **Dumbbell exercises (Bulgarian Split Squat, EZ Bar Curls):** Weight field represents per-hand or total weight as defined in template notes. Displayed with "DB" suffix.
- **Weight that does not divide cleanly by rounding increment:** Always round to nearest increment in auto-calculation. User can override to any value manually.

---

## 10. V2 / V3 Architecture Notes

These V1 decisions keep the path to V2 and V3 clean:

- **`warmup_rule` column:** Already an enum in the schema. Adding a new rule type in V2 means adding a new enum value, a new calculation function in `calculations.ts`, and a new UI option in the program editor. No schema migration required for the core tables.
- **`calculations.ts` as pure functions:** In V2, `getWarmupWeight()` becomes a dispatcher that reads `exercise_template.warmup_rule` and calls the appropriate function. In V3, it interprets a user-defined rule expression instead of calling a hardcoded function.
- **`staleness_rule` (not yet in schema):** V1 hardcodes the staleness trigger (`actual_reps >= rep range max`). In V2, add a `staleness_rule` column to `exercise_templates` with options: `rep_range_hit | sessions_elapsed | manual`. Schema change is additive only.
- **Rule expressions (V3):** When V3 is reached, store rule logic as structured JSON expressions in the DB. The calculation engine interprets them. The V1/V2 named rules become pre-built expressions users can select as starting points.

---

## 11. Build Order for Claude Code

Run each phase as a separate Claude Code session. Attach this file to each session and begin with: **"Read SPEC.md. We are on Phase N."**

| Phase | Focus | Deliverable | Verify before proceeding |
|---|---|---|---|
| 1 | Project scaffold | React + Vite + TypeScript + Tailwind + Supabase client + Vercel config | App loads at localhost, Supabase connection confirmed |
| 2 | Database schema | Supabase migration SQL for all 6 tables + seed data for Full Body A/B | Tables visible in Supabase dashboard, seed data queryable |
| 3 | Calculation logic | `src/lib/calculations.ts` with all functions + Vitest unit tests | All tests pass; verify warmup calc against examples in section 6.1 |
| 4 | Data layer | `src/lib/db.ts` — typed async query functions wrapping Supabase client | Each function tested manually via browser console |
| 5 | Home screen | HomeScreen with stats row, next workout card, last session card | Correct next workout shown based on seeded session history |
| 6 | Active workout screen | WorkoutScreen with exercise cards, set rows, weight/rep inputs, done checkboxes | All seed exercises render correctly for both A and B |
| 7 | Live recalculation | Changing top set weight updates warmup and back-off targets instantly | Change squat top set — verify all 4 warmup rows update |
| 8 | Session persistence | Complete session writes session + set_logs to Supabase; resume flow for abandoned sessions | Complete a session, reload app, verify history |
| 9 | Session summary | Summary screen: duration, volume, progression indicators | Progression earned indicator appears when rep target hit |
| 10 | Program editor | Full CRUD UI for programs, workout templates, exercise templates | Add a new exercise, verify it appears in active workout |
| 11 | PWA config | manifest.json, service worker, iOS meta tags for home screen install | Install to iPhone home screen, launches fullscreen |
| 12 | Polish | Staleness indicators, superset labels, collapsible warmup/cooldown, optional exercise toggle | All visual states verified on mobile Safari |

---

*— end of spec v0.2 —*
