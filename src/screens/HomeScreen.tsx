import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createStarterProgram,
  getActiveProgram,
  getExerciseTemplates,
  getHomeStats,
  getInProgressSession,
  getProfileCompletedSessions,
  getWorkoutTemplate,
  getWorkoutTemplates,
  type HomeStats,
} from '../lib/db'
import {
  buildWeekPlan,
  getNextWorkoutTemplate,
  isWeeklyProgram,
  pickFeaturedSlot,
  type WeekSlot,
  type WeekSlotStatus,
} from '../lib/calculations'
import { useProfileStore } from '../store/profile'
import { useUnit } from '../lib/units'
import type { ExerciseTemplate, Program, Session, WorkoutTemplate } from '../types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface HomeData {
  program: Program
  templates: WorkoutTemplate[]
  sessions: Session[]            // every completed session of the profile
  /** The workout to feature; null when a weekly plan is fully done. */
  nextTemplate: WorkoutTemplate | null
  nextLabel: string
  nextExercises: ExerciseTemplate[]
  /** This week's plan for weekly programs; null for A/B rotation. */
  weekPlan: WeekSlot[] | null
  lastSession: Session | null
  lastTemplate: WorkoutTemplate | null
  stats: HomeStats
  inProgress: Session | null
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatsRow({ stats }: { stats: HomeStats }) {
  const unit = useUnit()
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCell label="Total sessions" value={String(stats.totalSessions)} />
      <StatCell label="This month" value={String(stats.sessionsThisMonth)} />
      <StatCell
        label={stats.highlightExerciseName ? `${stats.highlightExerciseName} PR` : 'PR'}
        value={stats.highlightPR != null ? `${stats.highlightPR}` : '—'}
        unit={stats.highlightPR != null ? unit.label : undefined}
      />
    </div>
  )
}

function StatCell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="bg-surface/80 backdrop-blur border border-edge rounded-xl p-3 sm:p-4 flex flex-col items-center gap-1 text-center">
      <div className="flex items-baseline gap-1">
        <span className="text-2xl sm:text-3xl font-bold text-ink tabular-nums">{value}</span>
        {unit && <span className="text-xs text-ink-secondary">{unit}</span>}
      </div>
      <span className="text-xs text-ink-secondary leading-tight">{label}</span>
    </div>
  )
}

function NextWorkoutCard({
  label,
  template,
  exercises,
  onBegin,
}: {
  label: string
  template: WorkoutTemplate
  exercises: ExerciseTemplate[]
  onBegin: () => void
}) {
  const preview = exercises.slice(0, 4).map(e => e.name).join(' · ')
  const overflow = exercises.length > 4 ? ` +${exercises.length - 4} more` : ''

  return (
    <div className="bg-surface/80 backdrop-blur border border-accent/30 rounded-2xl p-5 flex flex-col gap-4 shadow-elevated">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-accent" />
          <p className="text-xs font-semibold text-accent uppercase tracking-widest">{label}</p>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-ink">{template.name}</h2>
      </div>

      <p className="text-sm text-ink-secondary leading-relaxed">
        {preview}
        {overflow && <span className="text-ink-disabled">{overflow}</span>}
      </p>

      <button
        onClick={onBegin}
        className="w-full bg-accent hover:bg-accent/90 text-on-accent font-bold rounded-xl py-3.5 min-h-touch transition-colors active:scale-[0.98] transition-transform text-base tracking-wide shadow-card"
      >
        Preview Workout
      </button>
    </div>
  )
}

// ─── Week plan ───────────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function StatusTag({ status, optional }: { status: WeekSlotStatus; optional: boolean }) {
  switch (status) {
    case 'done':
      return (
        <span className="w-5 h-5 rounded-full bg-positive flex items-center justify-center shrink-0" aria-label="Done">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )
    case 'today':
      return <span className="text-xs font-semibold text-accent shrink-0">Today</span>
    case 'missed':
      return <span className="text-xs font-medium text-caution shrink-0">Missed</span>
    case 'skipped':
      return <span className="text-xs text-ink-disabled shrink-0">Skipped</span>
    case 'upcoming':
      return optional
        ? <span className="text-xs text-ink-disabled shrink-0">Optional</span>
        : null
  }
}

/** This week at a glance; tapping any row previews that workout — the
 *  picker for doing a day's session early, late, or on its alternate day. */
function WeekStrip({ plan, onPick }: { plan: WeekSlot[]; onPick: (t: WorkoutTemplate) => void }) {
  return (
    <div className="bg-surface/80 backdrop-blur border border-edge rounded-2xl p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest">This week</p>
      <div className="flex flex-col gap-1">
        {plan.map(slot => {
          const muted = slot.status === 'done' || slot.status === 'skipped'
          return (
            <button
              key={slot.template.id}
              onClick={() => onPick(slot.template)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left active:opacity-70 transition-colors ${
                slot.status === 'today' ? 'bg-accent/10 border border-accent/30' : 'border border-transparent'
              }`}
            >
              <span className={`w-14 shrink-0 text-xs font-semibold tabular-nums ${
                slot.status === 'today' ? 'text-accent' : 'text-ink-disabled'
              }`}>
                {slot.days.map(d => DAY_NAMES[d]).join('/')}
              </span>
              <span className={`flex-1 min-w-0 text-sm truncate ${muted ? 'text-ink-disabled' : 'text-ink'}`}>
                {slot.template.name}
              </span>
              <StatusTag status={slot.status} optional={slot.template.is_optional} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LastSessionCard({
  session,
  template,
  onClick,
}: {
  session: Session
  template: WorkoutTemplate
  onClick: () => void
}) {
  const date = new Date(session.completed_at!)
  const formatted = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  return (
    <button
      onClick={onClick}
      className="w-full bg-surface/60 border border-edge rounded-2xl p-5 flex items-center justify-between gap-4 text-left active:opacity-70"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium text-ink-disabled uppercase tracking-wider">Last session</p>
        <h3 className="text-base font-semibold text-ink">{template.name}</h3>
        <p className="text-sm text-ink-secondary">{formatted}</p>
      </div>
      <div className="w-9 h-9 rounded-full bg-elevated border border-edge flex items-center justify-center text-ink-disabled shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </button>
  )
}

// ─── Consistency heatmap ─────────────────────────────────────────────────────

const HEATMAP_WEEKS = 16

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function ConsistencyCard({ sessions }: { sessions: Session[] }) {
  const { cells, monthLabels, activeWeeks, streak } = useMemo(() => {
    const sessionDates = new Set(
      sessions.filter(s => s.completed_at).map(s => localDate(new Date(s.completed_at!))),
    )

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = localDate(today)

    const daysToMon = (today.getDay() + 6) % 7
    const thisMonday = new Date(today)
    thisMonday.setDate(today.getDate() - daysToMon)

    const gridStart = new Date(thisMonday)
    gridStart.setDate(thisMonday.getDate() - (HEATMAP_WEEKS - 1) * 7)

    const cells = Array.from({ length: HEATMAP_WEEKS * 7 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      const dateStr = localDate(d)
      return { dateStr, month: d.getMonth(), future: dateStr > todayStr, active: sessionDates.has(dateStr) }
    })

    const monthLabels: (string | null)[] = Array.from({ length: HEATMAP_WEEKS }, (_, w) => {
      const first = cells[w * 7]
      const prev  = w > 0 ? cells[(w - 1) * 7] : null
      return (!prev || first.month !== prev.month)
        ? new Date(first.dateStr + 'T12:00:00').toLocaleString('en-US', { month: 'short' })
        : null
    })

    const weekActive = Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
      cells.slice(w * 7, w * 7 + 7).some(c => !c.future && c.active),
    )
    const activeWeeks = weekActive.filter(Boolean).length

    let streak = 0
    const startW = weekActive[HEATMAP_WEEKS - 1] ? HEATMAP_WEEKS - 1 : HEATMAP_WEEKS - 2
    for (let w = startW; w >= 0; w--) {
      if (weekActive[w]) streak++
      else break
    }

    return { cells, monthLabels, activeWeeks, streak }
  }, [sessions])

  const DAY_LABELS = ['M', '', 'W', '', 'F', '', 'S']

  return (
    <div className="bg-surface/80 backdrop-blur border border-edge rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest">Consistency</p>
        <div className="flex items-center gap-2.5 text-xs">
          {streak >= 2 && <span className="font-semibold text-accent">{streak}w streak</span>}
          <span className="text-ink-disabled">{activeWeeks}/{HEATMAP_WEEKS} weeks</span>
        </div>
      </div>

      <div className="flex gap-2 items-start">
        {/* Day labels */}
        <div className="flex flex-col shrink-0" style={{ gap: 2 }}>
          {DAY_LABELS.map((d, i) => (
            <div key={i} style={{ height: 10 }} className="flex items-center">
              <span className="text-[8px] text-ink-disabled w-2.5 text-right leading-none">{d}</span>
            </div>
          ))}
        </div>

        {/* Month labels + grid */}
        <div className="flex-1 flex flex-col" style={{ gap: 3 }}>
          <div className="grid" style={{ gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 2 }}>
            {monthLabels.map((label, w) => (
              <div key={w} className="text-[8px] text-ink-disabled overflow-hidden whitespace-nowrap leading-none h-2.5 flex items-center">
                {label ?? ''}
              </div>
            ))}
          </div>
          <div
            className="grid"
            style={{ gridTemplateRows: 'repeat(7, 10px)', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 2 }}
          >
            {cells.map(cell => (
              <div
                key={cell.dateStr}
                className={`rounded-[2px] ${cell.future ? '' : cell.active ? 'bg-accent' : 'bg-elevated'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ResumeBanner({
  onResume,
  onDiscard,
}: {
  session: Session
  onResume: () => void
  onDiscard: () => void
}) {
  return (
    <div className="bg-caution/10 border border-caution/30 rounded-2xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-caution">Session in progress</p>
        <p className="text-xs text-ink-secondary mt-0.5">
          You have an unfinished workout. Pick up where you left off?
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onResume}
          className="flex-1 bg-caution text-gray-900 font-semibold rounded-xl py-3 min-h-touch active:opacity-80 transition-opacity text-sm"
        >
          Resume
        </button>
        <button
          onClick={onDiscard}
          className="flex-1 bg-elevated text-ink-secondary font-medium rounded-xl py-3 min-h-touch active:opacity-80 transition-opacity text-sm border border-edge"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigate = useNavigate()
  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noProgram, setNoProgram] = useState(false)
  const [creating, setCreating] = useState(false)
  const profileName = useProfileStore(
    s => s.profiles.find(p => p.id === s.currentProfileId)?.name ?? '',
  )

  async function load() {
    try {
      const program = await getActiveProgram()
      if (!program) { setNoProgram(true); return }

      const [templates, sessions, stats, inProgress] = await Promise.all([
        getWorkoutTemplates(program.id),
        getProfileCompletedSessions(),
        getHomeStats(program.highlight_exercise_id ?? null),
        getInProgressSession(),
      ])

      let nextTemplate: WorkoutTemplate | null
      let nextLabel = 'Up next'
      let weekPlan: WeekSlot[] | null = null
      if (isWeeklyProgram(templates)) {
        weekPlan = buildWeekPlan(templates, sessions)
        const featured = pickFeaturedSlot(weekPlan)
        nextTemplate = featured?.template ?? null
        nextLabel = featured?.status === 'today' ? 'Today'
          : featured?.status === 'missed' ? 'Catch up'
          : 'Up next'
      } else {
        // Rotation only follows this program's own sessions
        const programSessions = sessions.filter(ps => templates.some(t => t.id === ps.workout_template_id))
        nextTemplate = getNextWorkoutTemplate(programSessions, templates)
      }

      const nextExercises = nextTemplate
        ? (await getExerciseTemplates(nextTemplate.id)).filter(e => !e.is_alternate_only)
        : []

      // The last session may belong to another program — look its workout up directly
      const lastSession = sessions[0] ?? null
      const lastTemplate = lastSession
        ? (templates.find(t => t.id === lastSession.workout_template_id)
            ?? await getWorkoutTemplate(lastSession.workout_template_id))
        : null

      setData({
        program, templates, sessions,
        nextTemplate, nextLabel, nextExercises, weekPlan,
        lastSession, lastTemplate,
        stats, inProgress,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }

  useEffect(() => { load() }, [])

  async function handleDiscard() {
    if (!data?.inProgress) return
    const { discardSession } = await import('../lib/db')
    await discardSession(data.inProgress.id)
    setData(prev => prev ? { ...prev, inProgress: null } : prev)
  }

  function handleResume() {
    if (data?.inProgress) navigate(`/workout/${data.inProgress.id}`)
  }

  function handleBegin() {
    if (data?.nextTemplate) navigate(`/workout/preview?template=${data.nextTemplate.id}`)
  }

  async function handleCreateProgram() {
    setCreating(true)
    try {
      await createStarterProgram(profileName ? `${profileName}'s Program` : 'My Program')
      navigate('/program')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create program')
    } finally {
      setCreating(false)
    }
  }

  if (noProgram) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-xs flex flex-col gap-5 text-center">
          <div>
            <h1 className="text-2xl font-bold text-ink">
              {profileName ? `Welcome, ${profileName}!` : 'Welcome!'}
            </h1>
            <p className="text-sm text-ink-secondary mt-2 leading-relaxed">
              You don't have a program yet. Create one and add your workouts and exercises.
            </p>
          </div>
          <button
            onClick={handleCreateProgram}
            disabled={creating}
            className="bg-accent text-on-accent font-bold rounded-2xl py-3.5 text-base active:opacity-80 disabled:opacity-50 shadow-card"
          >
            {creating ? 'Creating…' : 'Create my program'}
          </button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-negative text-sm text-center">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-10 sm:py-16 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-ink">Gym Tracker</h1>
            <p className="text-sm text-ink-secondary mt-0.5">{data.program.name}</p>
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/progress')}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary hover:text-ink hover:border-edge-strong transition-colors active:opacity-70"
            aria-label="Progress"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </button>
          <button
            onClick={() => navigate('/sessions')}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary hover:text-ink hover:border-edge-strong transition-colors active:opacity-70"
            aria-label="Session history"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v4l3 3" />
              <path d="M3.05 11a9 9 0 1 1 .5 4" />
              <polyline points="3 16 3 11 8 11" />
            </svg>
          </button>
          <button
            onClick={() => navigate('/program')}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary hover:text-ink hover:border-edge-strong transition-colors active:opacity-70"
            aria-label="Program settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          </div>
        </div>

        {/* Resume banner */}
        {data.inProgress && (
          <ResumeBanner
            session={data.inProgress}
            onResume={handleResume}
            onDiscard={handleDiscard}
          />
        )}

        {/* Stats */}
        <StatsRow stats={data.stats} />

        {/* Consistency heatmap */}
        <ConsistencyCard sessions={data.sessions} />

        {/* Featured workout */}
        {data.nextTemplate ? (
          <NextWorkoutCard
            label={data.nextLabel}
            template={data.nextTemplate}
            exercises={data.nextExercises}
            onBegin={handleBegin}
          />
        ) : (
          <div className="bg-surface/80 border border-positive/30 rounded-2xl p-5 text-center">
            <p className="text-base font-semibold text-positive">Week complete</p>
            <p className="text-sm text-ink-secondary mt-1">Every session this week is done. Tap any day below to train anyway.</p>
          </div>
        )}

        {/* Week plan (weekly programs) */}
        {data.weekPlan && (
          <WeekStrip
            plan={data.weekPlan}
            onPick={t => navigate(`/workout/preview?template=${t.id}`)}
          />
        )}

        {/* Last session */}
        {data.lastSession && data.lastTemplate && (
          <LastSessionCard
            session={data.lastSession}
            template={data.lastTemplate}
            onClick={() => navigate(`/sessions/${data.lastSession!.id}`)}
          />
        )}

      </div>
    </div>
  )
}
