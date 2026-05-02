import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveProgram, getWorkoutTemplates } from '../lib/db'
import type { Program, WorkoutTemplate } from '../types'

export default function ProgramScreen() {
  const navigate = useNavigate()
  const [program, setProgram] = useState<Program | null>(null)
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const p = await getActiveProgram()
        if (!p) { setError('No active program found.'); return }
        const t = await getWorkoutTemplates(p.id)
        setProgram(p)
        setTemplates(t)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    }
    load()
  }, [])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm text-center">{error}</p>
    </div>
  )

  if (!program) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-ink">Program</h1>
            <p className="text-xs text-ink-secondary">{program.name}</p>
          </div>
        </div>

        {/* Workout templates */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest px-1">
            Workout templates
          </p>
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => navigate(`/program/template/${t.id}`)}
              className="bg-surface/80 border border-edge rounded-2xl px-4 py-4 flex items-center gap-3 text-left active:opacity-70 shadow-card"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink">{t.name}</p>
                {(t.warmup_text || t.cooldown_text) && (
                  <p className="text-xs text-ink-disabled mt-0.5">
                    {[t.warmup_text && 'warmup', t.cooldown_text && 'cooldown'].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-disabled shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>

      </div>
    </div>
  )
}
