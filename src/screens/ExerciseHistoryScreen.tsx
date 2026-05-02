import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getSetLogsForExercise } from '../lib/db'

import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataPoint {
  date: string          // session completed_at ISO
  weight: number        // top/working set actual_weight
  reps: number | null   // actual_reps for that set
  sessionId: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Mini sparkline ───────────────────────────────────────────────────────────

function Sparkline({ points, width = 280, height = 64 }: { points: DataPoint[]; width?: number; height?: number }) {
  if (points.length < 2) return null

  const weights = points.map(p => p.weight)
  const minW = Math.min(...weights)
  const maxW = Math.max(...weights)
  const range = maxW - minW || 1

  const xs = points.map((_, i) => (i / (points.length - 1)) * (width - 16) + 8)
  const ys = points.map(p => height - 8 - ((p.weight - minW) / range) * (height - 16))

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${ys[i]}`).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {/* Grid line at max */}
      <line
        x1={8} y1={8} x2={width - 8} y2={8}
        stroke="currentColor" strokeWidth="0.5" className="text-edge" strokeDasharray="3 3"
      />
      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent"
      />
      {/* Dots */}
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={3} className="fill-accent" />
      ))}
      {/* Min / max labels */}
      <text x={8} y={height - 1} className="fill-ink-disabled" fontSize={9}>{minW}</text>
      <text x={width - 8} y={8 - 3} className="fill-ink-disabled" fontSize={9} textAnchor="end">{maxW}</text>
    </svg>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseHistoryScreen() {
  const { exerciseId } = useParams<{ exerciseId: string }>()
  const [searchParams] = useSearchParams()
  const templateId = searchParams.get('templateId') ?? ''
  const navigate = useNavigate()

  const [exerciseName, setExerciseName] = useState('')
  const [points, setPoints] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!exerciseId) return
    load(exerciseId)
  }, [exerciseId])

  async function load(id: string) {
    try {
      // Get exercise name
      const { data: exData } = await supabase
        .from('exercise_templates')
        .select('name')
        .eq('id', id)
        .single()
      if (exData) setExerciseName(exData.name)

      // Get set logs with session date info — fetch more to build a useful history
      const logs = await getSetLogsForExercise(id, 60)

      // For each log, we need the session's completed_at. Fetch distinct session IDs.
      const sessionIds = [...new Set(logs.map(l => l.session_id))]
      if (sessionIds.length === 0) { setPoints([]); return }

      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, completed_at')
        .in('id', sessionIds)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: true })

      if (!sessions) { setPoints([]); return }

      const sessionDateMap = new Map<string, string>(
        sessions.map(s => [s.id, s.completed_at as string]),
      )

      // One data point per session: use top set (or working set) actual_weight
      const pts: DataPoint[] = []
      for (const session of sessions) {
        const sessionLogs = logs.filter(l => l.session_id === session.id)
        const topSet = sessionLogs.find(l => l.set_type === 'top' && l.actual_weight !== null && l.completed)
          ?? sessionLogs.find(l => l.set_type === 'working' && l.actual_weight !== null && l.completed)
        if (!topSet?.actual_weight || !sessionDateMap.get(session.id)) continue
        pts.push({
          date: sessionDateMap.get(session.id)!,
          weight: topSet.actual_weight,
          reps: topSet.actual_reps,
          sessionId: session.id,
        })
      }

      setPoints(pts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  const backPath = templateId
    ? `/program/exercise/${exerciseId}?templateId=${templateId}`
    : `/program/exercise/${exerciseId}`

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm">{error}</p>
    </div>
  )

  // PR = highest weight ever
  const pr = points.length > 0 ? Math.max(...points.map(p => p.weight)) : null
  // Last session
  const last = points[points.length - 1] ?? null
  // Number of sessions with data
  const sessionCount = points.length

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
              <p className="text-xs text-ink-secondary mt-0.5">{sessionCount} sessions logged</p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : points.length === 0 ? (
          <div className="bg-surface/60 border border-edge rounded-2xl p-6 text-center">
            <p className="text-ink-secondary text-sm">No completed sets logged yet for this exercise.</p>
          </div>
        ) : (
          <>
            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface/80 border border-edge rounded-xl p-3 flex flex-col items-center gap-0.5 text-center">
                <span className="text-lg font-bold text-ink tabular-nums">{last?.weight ?? '—'}</span>
                <span className="text-xs text-ink-secondary">Last</span>
              </div>
              <div className="bg-surface/80 border border-accent/25 rounded-xl p-3 flex flex-col items-center gap-0.5 text-center">
                <span className="text-lg font-bold text-accent tabular-nums">{pr ?? '—'}</span>
                <span className="text-xs text-ink-secondary">PR</span>
              </div>
              <div className="bg-surface/80 border border-edge rounded-xl p-3 flex flex-col items-center gap-0.5 text-center">
                <span className="text-lg font-bold text-ink tabular-nums">{sessionCount}</span>
                <span className="text-xs text-ink-secondary">Sessions</span>
              </div>
            </div>

            {/* Sparkline chart */}
            {points.length >= 2 && (
              <div className="bg-surface/80 border border-edge rounded-2xl p-4">
                <p className="text-xs font-semibold text-ink-disabled uppercase tracking-wide mb-3">
                  Weight over time
                </p>
                <div className="w-full overflow-hidden">
                  <Sparkline points={points} width={320} height={72} />
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-xs text-ink-disabled">{formatShortDate(points[0].date)}</span>
                  <span className="text-xs text-ink-disabled">{formatShortDate(points[points.length - 1].date)}</span>
                </div>
              </div>
            )}

            {/* Per-session log — newest first */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest px-1">
                Session log
              </p>
              {[...points].reverse().map((pt, i) => {
                const isPR = pt.weight === pr
                return (
                  <button
                    key={i}
                    onClick={() => navigate(`/sessions/${pt.sessionId}`)}
                    className="bg-surface/80 border border-edge rounded-xl px-4 py-3 flex items-center gap-3 text-left active:opacity-70"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink tabular-nums">
                          {pt.weight} lbs
                        </span>
                        {isPR && (
                          <span className="text-xs font-bold text-accent bg-accent/10 border border-accent/25 rounded px-1.5 py-0.5">
                            PR
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-ink-secondary">{formatShortDate(pt.date)}</span>
                        {pt.reps != null && (
                          <span className="text-xs text-ink-disabled">· {pt.reps} reps</span>
                        )}
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
