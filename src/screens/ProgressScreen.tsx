import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUnit } from '../lib/units'
import {
  getActiveProgram,
  getProgramExercises,
  getProgressLogs,
} from '../lib/db'
import type { ProgressLog } from '../lib/db'
import type { ExerciseTemplate } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExerciseTrend {
  exercise: ExerciseTemplate
  /** Primary (top/working) weight per completed session, oldest → newest. */
  series: number[]
  latest: number
  delta: number | null      // latest − previous session, null with <2 sessions
  sessions: number
  lastDate: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Collapses an exercise's logs into one weight per session, ordered by date. */
function buildTrend(exercise: ExerciseTemplate, logs: ProgressLog[]): ExerciseTrend | null {
  const bySession = new Map<string, { date: string; weight: number; isTop: boolean }>()
  for (const log of logs) {
    if (log.actual_weight === null) continue
    const existing = bySession.get(log.session_id)
    const isTop = log.set_type === 'top'
    // Prefer the top set; otherwise first working set wins
    if (!existing || (isTop && !existing.isTop)) {
      bySession.set(log.session_id, { date: log.session_completed_at, weight: log.actual_weight, isTop })
    }
  }
  const ordered = [...bySession.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (ordered.length === 0) return null

  const series = ordered.map(p => p.weight)
  const latest = series[series.length - 1]
  const prev = series.length >= 2 ? series[series.length - 2] : null

  return {
    exercise,
    series,
    latest,
    delta: prev !== null ? latest - prev : null,
    sessions: ordered.length,
    lastDate: ordered[ordered.length - 1].date,
  }
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  const W = 96
  const H = 32
  const PAD = 3
  const pts = values.slice(-12)
  if (pts.length < 2) {
    return <div className="w-24 h-8" />
  }
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
  // Flat series renders as a midline
  const y = (v: number) => range === 0 ? H / 2 : H - PAD - ((v - min) / range) * (H - PAD * 2)
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const up = pts[pts.length - 1] >= pts[0]

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke={up ? 'var(--color-positive, #4ade80)' : 'var(--color-negative, #f87171)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="2.5" fill={up ? 'var(--color-positive, #4ade80)' : 'var(--color-negative, #f87171)'} />
    </svg>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const navigate = useNavigate()
  const unit = useUnit()

  const [trends, setTrends] = useState<ExerciseTrend[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const program = await getActiveProgram()
        if (!program) { setTrends([]); return }
        const exercises = await getProgramExercises(program.id)
        const logs = await getProgressLogs(exercises.map(e => e.id))

        const byExercise = new Map<string, ProgressLog[]>()
        for (const log of logs) {
          const list = byExercise.get(log.exercise_template_id) ?? []
          list.push(log)
          byExercise.set(log.exercise_template_id, list)
        }

        const result = exercises
          .map(ex => buildTrend(ex, byExercise.get(ex.id) ?? []))
          .filter((t): t is ExerciseTrend => t !== null)
          // Most recently trained first
          .sort((a, b) => b.lastDate.localeCompare(a.lastDate))

        setTrends(result)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load progress')
      }
    }
    load()
  }, [])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm">{error}</p>
    </div>
  )

  if (!trends) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70 shrink-0"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-ink">Progress</h1>
            <p className="text-xs text-ink-secondary mt-0.5">
              Change vs previous session · tap for full history
            </p>
          </div>
        </div>

        {trends.length === 0 ? (
          <div className="bg-surface/60 border border-edge rounded-2xl p-6 text-center">
            <p className="text-ink-secondary text-sm">No completed sessions yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {trends.map(t => (
              <button
                key={t.exercise.id}
                onClick={() => navigate(`/program/exercise/${t.exercise.id}/history?from=progress`)}
                className="bg-surface/80 border border-edge rounded-xl px-4 py-3 flex items-center gap-3 text-left active:opacity-70"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{t.exercise.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-ink-secondary tabular-nums">
                      {t.latest} {unit.label}
                    </span>
                    {t.delta !== null && t.delta !== 0 && (
                      <span className={`text-xs font-bold tabular-nums ${t.delta > 0 ? 'text-positive' : 'text-negative'}`}>
                        {t.delta > 0 ? '+' : ''}{t.delta}
                      </span>
                    )}
                    <span className="text-xs text-ink-disabled">· {shortDate(t.lastDate)}</span>
                  </div>
                </div>
                <Sparkline values={t.series} />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-disabled shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
