import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveProgram, getWorkoutTemplates } from '../lib/db'
import { useSettingsStore } from '../store/settings'
import { useProfileStore } from '../store/profile'
import { useUnit } from '../lib/units'
import { DEFAULT_THEME, THEMES } from '../lib/themes'
import type { Program, WorkoutTemplate, UnitSystem } from '../types'

export default function ProgramScreen() {
  const navigate = useNavigate()
  const unit = useUnit()
  const updateSettings = useSettingsStore(s => s.update)
  const currentTheme = useSettingsStore(s => s.settings?.theme ?? DEFAULT_THEME)
  const [savingUnit, setSavingUnit] = useState(false)
  const [savingTheme, setSavingTheme] = useState(false)
  const switchProfile = useProfileStore(s => s.switchProfile)
  const profileName = useProfileStore(
    s => s.profiles.find(p => p.id === s.currentProfileId)?.name ?? '',
  )

  const [program, setProgram] = useState<Program | null>(null)
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handleUnitChange(value: UnitSystem) {
    setSavingUnit(true)
    try { await updateSettings({ unit_system: value }) }
    finally { setSavingUnit(false) }
  }

  async function handleThemeChange(value: string) {
    setSavingTheme(true)
    try { await updateSettings({ theme: value }) }
    finally { setSavingTheme(false) }
  }

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

        {/* Settings */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest px-1">
            Settings
          </p>
          <div className="bg-surface/80 border border-edge rounded-2xl px-4 py-4 flex items-center justify-between gap-4 shadow-card">
            <div>
              <p className="font-semibold text-ink text-sm">Profile</p>
              <p className="text-xs text-ink-disabled mt-0.5">Training as {profileName || '—'}</p>
            </div>
            <button
              onClick={switchProfile}
              className="text-sm font-semibold text-ink-secondary bg-elevated border border-edge rounded-xl px-3.5 py-2 active:opacity-70 shrink-0"
            >
              Switch
            </button>
          </div>
          <div className="bg-surface/80 border border-edge rounded-2xl px-4 py-4 flex items-center justify-between gap-4 shadow-card">
            <div>
              <p className="font-semibold text-ink text-sm">Theme</p>
              <p className="text-xs text-ink-disabled mt-0.5">Colors across the app</p>
            </div>
            <div className={`flex bg-elevated border border-edge rounded-xl overflow-hidden shrink-0 ${savingTheme ? 'opacity-50 pointer-events-none' : ''}`}>
              {THEMES.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleThemeChange(t.id)}
                  className={`px-3.5 py-2 text-sm font-semibold transition-colors ${
                    currentTheme === t.id
                      ? 'bg-accent text-on-accent'
                      : 'text-ink-secondary active:opacity-70'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-surface/80 border border-edge rounded-2xl px-4 py-4 flex items-center justify-between gap-4 shadow-card">
            <div>
              <p className="font-semibold text-ink text-sm">Weight unit</p>
              <p className="text-xs text-ink-disabled mt-0.5">Used throughout the app</p>
            </div>
            <div className={`flex bg-elevated border border-edge rounded-xl overflow-hidden shrink-0 ${savingUnit ? 'opacity-50 pointer-events-none' : ''}`}>
              {(['imperial', 'metric'] as UnitSystem[]).map(sys => (
                <button
                  key={sys}
                  onClick={() => handleUnitChange(sys)}
                  className={`px-3.5 py-2 text-sm font-semibold transition-colors ${
                    unit.system === sys
                      ? 'bg-accent text-on-accent'
                      : 'text-ink-secondary active:opacity-70'
                  }`}
                >
                  {sys === 'imperial' ? 'lbs' : 'kg'}
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
