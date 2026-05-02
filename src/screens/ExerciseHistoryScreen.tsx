import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getSetLogsForExercise } from '../lib/db'
import LineChart from '../components/LineChart'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

type Metric = 'weight' | 'e1rm' | 'volume'

interface DataPoint {
  date:      string        // completed_at ISO
  shortDate: string        // "Jan 5"
  weight:    number        // top/working set actual_weight
  reps:      number | null
  volume:    number        // Σ weight × reps for all completed working sets
  e1rm:      number | null // Epley estimate, null when no reps
  sessionId: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/** Epley formula: weight × (1 + reps/30), rounded to nearest 0.5. */
function epley(weight: number, reps: number): number {
  return Math.round(weight * (1 + reps / 30) * 2) / 2
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseHistoryScreen() {
  const { exerciseId }  = useParams<{ exerciseId: string }>()
  const [searchParams]  = useSearchParams()
  const templateId      = searchParams.get('templateId') ?? ''
  const navigate        = useNavigate()

  const [exerciseName, setExerciseName] = useState('')
  const [points, setPoints]             = useState<DataPoint[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [metric, setMetric]             = useState<Metric>('weight')

  useEffect(() => {
    if (exerciseId) load(exerciseId)
  }, [exerciseId])

  async function load(id: string) {
    try {
      const { data: exData } = await supabase
        .from('exercise_templates').select('name').eq('id', id).single()
      if (exData) setExerciseName(exData.name)

      const logs = await getSetLogsForExercise(id, 120)
      const sessionIds = [...new Set(logs.map(l => l.session_id))]
      if (!sessionIds.length) { setPoints([]); return }

      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, completed_at')
        .in('id', sessionIds)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: true })

      if (!sessions?.length) { setPoints([]); return }

      const pts: DataPoint[] = []
      for (const sess of sessions) {
        const sessLogs = logs.filter(l => l.session_id === sess.id)

        // Primary set for weight / reps
        const primarySet =
          sessLogs.find(l => l.set_type === 'top'     && l.completed && l.actual_weight) ??
          sessLogs.find(l => l.set_type === 'working' && l.completed && l.actual_weight)
        if (!primarySet?.actual_weight) continue

        // Volume: all working-type completed sets
        const vol = sessLogs
          .filter(l =>
            (l.set_type === 'top' || l.set_type === 'working' ||
             l.set_type === 'backoff' || l.set_type === 'amrap') &&
            l.completed && l.actual_weight && l.actual_reps,
          )
          .reduce((s, l) => s + l.actual_weight! * l.actual_reps!, 0)

        const reps = primarySet.actual_reps
        pts.push({
          date:      sess.completed_at!,
          shortDate: shortDate(sess.completed_at!),
          weight:    primarySet.actual_weight,
          reps,
          volume:    vol,
          e1rm:      reps ? epley(primarySet.actual_weight, reps) : null,
          sessionId: sess.id,
        })
      }
      setPoints(pts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  // For Est. 1RM, only use sessions where reps were logged
  const e1rmPoints = points.filter(p => p.e1rm !== null)

  // The active series for the chart
  const activePoints = metric === 'e1rm' ? e1rmPoints : points

  const chartValues: number[] = activePoints.map(p =>
    metric === 'weight' ? p.weight :
    metric === 'e1rm'   ? p.e1rm! :
    p.volume,
  )
  const chartDates   = activePoints.map(p => p.shortDate)
  const chartTooltips = activePoints.map(p => {
    const line1 =
      metric === 'weight' ? `${p.weight} lbs` :
      metric === 'e1rm'   ? `~${p.e1rm} e1RM` :
      `${p.volume.toLocaleString()} lbs vol`
    const parts = [longDate(p.date)]
    if (metric !== 'volume' && p.reps) parts.push(`${p.weight} lbs × ${p.reps}`)
    else if (metric === 'volume' && p.reps) parts.push(`${p.weight} × ${p.reps}`)
    return `${line1}\n${parts.join(' · ')}`
  })

  // Stats
  const prWeight = points.length ? Math.max(...points.map(p => p.weight))                : null
  const prE1rm   = e1rmPoints.length ? Math.max(...e1rmPoints.map(p => p.e1rm!))         : null
  const prVolume = points.length ? Math.max(...points.map(p => p.volume))                : null
  const last     = points[points.length - 1] ?? null

  const displayPR =
    metric === 'weight' ? prWeight :
    metric === 'e1rm'   ? prE1rm :
    prVolume

  const displayLast =
    metric === 'weight' ? last?.weight :
    metric === 'e1rm'   ? last?.e1rm :
    last?.volume

  const prLabel  = metric === 'volume' ? 'Best vol' : 'PR'
  const lastLabel = 'Last'
  const unit =
    metric === 'weight' ? ' lbs' :
    metric === 'e1rm'   ? ' lbs' :
    ' lbs'

  function fmtStat(v: number | null | undefined): string {
    if (v == null) return '—'
    if (metric === 'volume' && v >= 1000) return `${(v / 1000).toFixed(1)}k`
    return String(v)
  }

  const backPath = templateId
    ? `/program/exercise/${exerciseId}?templateId=${templateId}`
    : `/program/exercise/${exerciseId}`

  // ── Render ──────────────────────────────────────────────────────────────────

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm">{error}</p>
    </div>
  )

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate(backPath)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70 shrink-0"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{exerciseName || 'Exercise history'}</h1>
            {!loading && (
              <p className="text-xs text-ink-secondary mt-0.5">{points.length} sessions logged</p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : points.length === 0 ? (
          <div className="bg-surface/60 border border-edge rounded-2xl p-6 text-center">
            <p className="text-ink-secondary text-sm">No completed sets logged yet.</p>
          </div>
        ) : (
          <>
            {/* Metric tabs */}
            <div className="flex bg-elevated border border-edge rounded-xl overflow-hidden">
              {([
                { key: 'weight', label: 'Weight' },
                { key: 'e1rm',   label: 'Est. 1RM', disabled: !e1rmPoints.length },
                { key: 'volume', label: 'Volume' },
              ] as { key: Metric; label: string; disabled?: boolean }[]).map((tab, i) => (
                <button
                  key={tab.key}
                  disabled={tab.disabled}
                  onClick={() => setMetric(tab.key)}
                  className={[
                    'flex-1 py-2 text-xs font-semibold transition-colors',
                    i > 0 ? 'border-l border-edge' : '',
                    metric === tab.key
                      ? 'bg-accent text-white'
                      : tab.disabled
                        ? 'text-ink-disabled cursor-not-allowed'
                        : 'text-ink-secondary active:opacity-70',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface/80 border border-edge rounded-xl p-3 flex flex-col items-center gap-0.5 text-center">
                <span className="text-lg font-bold text-ink tabular-nums">
                  {fmtStat(displayLast)}
                </span>
                <span className="text-xs text-ink-secondary">{lastLabel}</span>
              </div>
              <div className="bg-surface/80 border border-accent/25 rounded-xl p-3 flex flex-col items-center gap-0.5 text-center">
                <span className="text-lg font-bold text-accent tabular-nums">
                  {fmtStat(displayPR)}
                </span>
                <span className="text-xs text-ink-secondary">{prLabel}</span>
              </div>
              <div className="bg-surface/80 border border-edge rounded-xl p-3 flex flex-col items-center gap-0.5 text-center">
                <span className="text-lg font-bold text-ink tabular-nums">{points.length}</span>
                <span className="text-xs text-ink-secondary">Sessions</span>
              </div>
            </div>

            {/* Chart */}
            {activePoints.length >= 2 && (
              <div className="bg-surface/80 border border-edge rounded-2xl px-3 pt-4 pb-3">
                <LineChart
                  values={chartValues}
                  dates={chartDates}
                  tooltips={chartTooltips}
                  unit={unit}
                  gradId={`ex-hist-${metric}`}
                />
              </div>
            )}

            {/* Per-session log — newest first */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest px-1">
                Session log
              </p>
              {[...points].reverse().map((pt, i) => {
                const isPR  = metric === 'weight' ? pt.weight === prWeight
                            : metric === 'e1rm'   ? pt.e1rm   === prE1rm
                            : pt.volume === prVolume
                const mainVal =
                  metric === 'weight' ? `${pt.weight} lbs` :
                  metric === 'e1rm'   ? (pt.e1rm ? `~${pt.e1rm} lbs` : `${pt.weight} lbs`) :
                  `${pt.volume.toLocaleString()} lbs`
                const subVal =
                  metric === 'weight'
                    ? pt.reps ? `${pt.reps} reps` : ''
                    : metric === 'e1rm'
                      ? pt.reps ? `${pt.weight} × ${pt.reps}` : ''
                      : pt.reps ? `${pt.weight} × ${pt.reps} + more` : ''

                return (
                  <button
                    key={i}
                    onClick={() => navigate(`/sessions/${pt.sessionId}`)}
                    className="bg-surface/80 border border-edge rounded-xl px-4 py-3 flex items-center gap-3 text-left active:opacity-70"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink tabular-nums">{mainVal}</span>
                        {isPR && (
                          <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/25 rounded px-1.5 py-0.5">
                            PR
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-ink-secondary">{shortDate(pt.date)}</span>
                        {subVal && <span className="text-xs text-ink-disabled">· {subVal}</span>}
                      </div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-disabled shrink-0">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )
              })}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
