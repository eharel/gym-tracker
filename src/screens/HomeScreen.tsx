import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getActiveProgram,
  getCompletedSessions,
  getExerciseTemplates,
  getHomeStats,
  getInProgressSession,
  getWorkoutTemplates,
  type HomeStats,
} from '../lib/db'
import { getNextWorkoutTemplate } from '../lib/calculations'
import { useUnit } from '../lib/units'
import type { ExerciseTemplate, Program, Session, WorkoutTemplate } from '../types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface HomeData {
  program: Program
  templates: WorkoutTemplate[]
  sessions: Session[]
  nextTemplate: WorkoutTemplate
  nextExercises: ExerciseTemplate[]
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
  template,
  exercises,
  onBegin,
}: {
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
          <p className="text-xs font-semibold text-accent uppercase tracking-widest">Up next</p>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-ink">{template.name}</h2>
      </div>

      <p className="text-sm text-ink-secondary leading-relaxed">
        {preview}
        {overflow && <span className="text-ink-disabled">{overflow}</span>}
      </p>

      <button
        onClick={onBegin}
        className="w-full bg-accent hover:bg-accent/90 text-white font-bold rounded-xl py-3.5 min-h-touch transition-colors active:scale-[0.98] transition-transform text-base tracking-wide shadow-card"
      >
        Preview Workout
      </button>
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

  async function load() {
    try {
      const program = await getActiveProgram()
      if (!program) { setError('No active program found.'); return }

      const [templates, sessions, stats, inProgress] = await Promise.all([
        getWorkoutTemplates(program.id),
        getCompletedSessions(program.id),
        getHomeStats(program.id, program.highlight_exercise_id ?? null),
        getInProgressSession(),
      ])

      const nextTemplate = getNextWorkoutTemplate(sessions, templates)
      const nextExercises = await getExerciseTemplates(nextTemplate.id)

      const lastSession = sessions[0] ?? null
      const lastTemplate = lastSession
        ? (templates.find(t => t.id === lastSession.workout_template_id) ?? null)
        : null

      setData({
        program, templates, sessions,
        nextTemplate, nextExercises,
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
    navigate(`/workout/preview?template=${data?.nextTemplate.id}`)
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

        {/* Next workout */}
        <NextWorkoutCard
          template={data.nextTemplate}
          exercises={data.nextExercises}
          onBegin={handleBegin}
        />

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
