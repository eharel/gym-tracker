import type { SetLog } from '../types'

/**
 * Builds a Google Calendar "quick add" URL pre-filled with session details.
 * Exercises with no completed working sets (skipped) are left out — the
 * calendar entry records what was actually done.
 */
export function buildGCalUrl(opts: {
  title: string
  startedAt: string
  completedAt: string | null
  exercises: { name: string; sets: SetLog[] }[]
  unitLabel: string
}): string {
  // GCal expects UTC: YYYYMMDDTHHMMSSZ
  const fmt = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const start = fmt(opts.startedAt)
  const end = opts.completedAt ? fmt(opts.completedAt) : start

  const exerciseLines = opts.exercises.flatMap(({ name, sets }) => {
    const working = sets.filter(s => s.set_type !== 'warmup' && s.completed)
    if (working.length === 0) return []
    const topSet = working[0]
    const w = topSet.actual_weight ?? topSet.target_weight
    const r = topSet.actual_reps ?? topSet.target_reps
    return [w ? `${name}: ${w} ${opts.unitLabel} × ${r ?? '?'}` : name]
  })

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${start}/${end}`,
    details: exerciseLines.join('\n'),
  })
  return `https://calendar.google.com/calendar/render?${params}`
}
