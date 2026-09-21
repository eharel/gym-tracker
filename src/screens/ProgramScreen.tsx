import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveProgram, getPrograms, getWorkoutTemplates, setActiveProgram } from '../lib/db'
import { useSettingsStore } from '../store/settings'
import { useProfileStore } from '../store/profile'
import { useUnit } from '../lib/units'
import { DEFAULT_THEME, THEMES } from '../lib/themes'
import type { Program, WorkoutTemplate, UnitSystem } from '../types'

const JS_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** [5, 6] → "Fri/Sat" — listed Monday-first so Sunday comes last. */
function formatDays(days: number[] | null): string | null {
  if (!days?.length) return null
  return [...days]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map(d => JS_DAY_NAMES[d])
    .join('/')
}

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
  const [programs, setPrograms] = useState<Program[]>([])
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)

  async function handleSwitchProgram(id: string) {
    if (id === program?.id || switchingTo) return
    setSwitchingTo(id)
    try {
      await setActiveProgram(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch program')
    } finally {
      setSwitchingTo(null)
    }
  }

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

  async function load() {
    try {
      const [p, all] = await Promise.all([getActiveProgram(), getPrograms()])
      if (!p) { setError('No active program found.'); return }
      const t = await getWorkoutTemplates(p.id)
      setProgram(p)
      setPrograms(all)
      setTemplates(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }

  useEffect(() => { load() }, [])

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

        {/* Program switcher — only when there's something to switch between */}
        {programs.length > 1 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest px-1">
              Programs
            </p>
            <div className="bg-surface/80 border border-edge rounded-2xl p-1.5 flex flex-col gap-1 shadow-card">
              {programs.map(p => {
                const active = p.id === program.id
                return (
                  <button
                    key={p.id}
                    onClick={() => handleSwitchProgram(p.id)}
                    disabled={switchingTo !== null}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                      active ? 'bg-accent/10' : 'active:opacity-70'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      active ? 'border-accent' : 'border-edge-strong'
                    }`}>
                      {active && <span className="w-2 h-2 rounded-full bg-accent" />}
                    </span>
                    <span className={`flex-1 text-sm font-semibold ${active ? 'text-ink' : 'text-ink-secondary'}`}>
                      {p.name}
                    </span>
                    {switchingTo === p.id && <span className="text-xs text-ink-disabled">Switching…</span>}
                    {active && <span className="text-xs font-medium text-accent">Active</span>}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-ink-disabled px-1">
              Your history, weights and PRs carry across programs.
            </p>
          </div>
        )}

        {/* Workout templates */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest px-1">
            Workouts
          </p>
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => navigate(`/program/template/${t.id}`)}
              className="bg-surface/80 border border-edge rounded-2xl px-4 py-4 flex items-center gap-3 text-left active:opacity-70 shadow-card"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink">{t.name}</p>
                {(t.scheduled_days?.length || t.warmup_text || t.cooldown_text) ? (
                  <p className="text-xs text-ink-disabled mt-0.5">
                    {[
                      formatDays(t.scheduled_days),
                      t.is_optional && 'optional',
                      t.warmup_text && 'warmup',
                      t.cooldown_text && 'cooldown',
                    ].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
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
