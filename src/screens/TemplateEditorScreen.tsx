import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  deleteExerciseTemplate,
  getExerciseTemplates,
  reorderExerciseTemplates,
  upsertExerciseTemplate,
} from '../lib/db'
import type { ExerciseTemplate, WorkoutTemplate } from '../types'
import { supabase } from '../lib/supabase'

// ─── DB helpers not yet in db.ts ─────────────────────────────────────────────

async function updateWorkoutTemplate(
  id: string,
  updates: Partial<Pick<WorkoutTemplate, 'name' | 'warmup_text' | 'cooldown_text'>>,
): Promise<void> {
  const { error } = await supabase.from('workout_templates').update(updates).eq('id', id)
  if (error) throw error
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function TemplateEditorScreen() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()

  const [template, setTemplate] = useState<WorkoutTemplate | null>(null)
  const [exercises, setExercises] = useState<ExerciseTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Editable template fields
  const [name, setName] = useState('')
  const [warmupText, setWarmupText] = useState('')
  const [cooldownText, setCooldownText] = useState('')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function load() {
      if (!templateId) return
      try {
        // find the template across all programs
        const { data, error } = await supabase
          .from('workout_templates')
          .select('*')
          .eq('id', templateId)
          .single()
        if (error) throw error
        setTemplate(data)
        setName(data.name)
        setWarmupText(data.warmup_text ?? '')
        setCooldownText(data.cooldown_text ?? '')

        const ex = await getExerciseTemplates(templateId)
        setExercises(ex)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    }
    load()
  }, [templateId])

  function scheduleSave(updates: Partial<Pick<WorkoutTemplate, 'name' | 'warmup_text' | 'cooldown_text'>>) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!templateId) return
      setSaving(true)
      await updateWorkoutTemplate(templateId, updates)
      setSaving(false)
    }, 800)
  }

  function handleNameChange(v: string) {
    setName(v)
    scheduleSave({ name: v, warmup_text: warmupText || null, cooldown_text: cooldownText || null })
  }
  function handleWarmupChange(v: string) {
    setWarmupText(v)
    scheduleSave({ name, warmup_text: v || null, cooldown_text: cooldownText || null })
  }
  function handleCooldownChange(v: string) {
    setCooldownText(v)
    scheduleSave({ name, warmup_text: warmupText || null, cooldown_text: v || null })
  }

  async function handleAddExercise() {
    if (!templateId) return
    const newEx = await upsertExerciseTemplate({
      workout_template_id: templateId,
      name: 'New exercise',
      position: exercises.length,
      rpe_target: null,
      notes: null,
      superset_group: null,
      is_optional: false,
      warmup_rule: 'none',
      warmup_percentages: null,
      warmup_reps: null,
      warmup_db_percentage: null,
      warmup_db_reps: null,
      warmup_fixed_weight: null,
      warmup_fixed_reps: null,
      working_set_type: 'straight_sets',
      working_set_count: 3,
      working_rep_target: '8-10',
      backoff_set_count: 0,
      backoff_percentage: null,
      backoff_rep_target: null,
      weight_increment: 5,
      rounding_increment: 5,
    })
    setExercises(prev => [...prev, newEx])
    navigate(`/program/exercise/${newEx.id}?templateId=${templateId}`)
  }

  async function handleDeleteExercise(id: string) {
    await deleteExerciseTemplate(id)
    const remaining = exercises.filter(e => e.id !== id)
    // Re-index positions
    const reindexed = remaining.map((e, i) => ({ ...e, position: i }))
    await reorderExerciseTemplates(reindexed.map(e => ({ id: e.id, position: e.position })))
    setExercises(reindexed)
  }

  async function moveExercise(idx: number, dir: -1 | 1) {
    const newList = [...exercises]
    const swap = idx + dir
    if (swap < 0 || swap >= newList.length) return
    ;[newList[idx], newList[swap]] = [newList[swap], newList[idx]]
    const reindexed = newList.map((e, i) => ({ ...e, position: i }))
    setExercises(reindexed)
    await reorderExerciseTemplates(reindexed.map(e => ({ id: e.id, position: e.position })))
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm">{error}</p>
    </div>
  )

  if (!template) return (
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
            onClick={() => navigate('/program')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{name || 'Workout template'}</h1>
            {saving && <p className="text-xs text-ink-disabled">Saving…</p>}
          </div>
        </div>

        {/* Template fields */}
        <div className="bg-surface/80 border border-edge rounded-2xl p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-ink-disabled uppercase tracking-wide">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-ink-disabled uppercase tracking-wide">Warmup notes</label>
            <textarea
              rows={2}
              value={warmupText}
              onChange={e => handleWarmupChange(e.target.value)}
              placeholder="e.g. 5 min bike, dynamic stretches…"
              className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-disabled outline-none focus:border-accent transition-colors resize-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-ink-disabled uppercase tracking-wide">Cooldown notes</label>
            <textarea
              rows={2}
              value={cooldownText}
              onChange={e => handleCooldownChange(e.target.value)}
              placeholder="e.g. static stretches, foam roll…"
              className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-disabled outline-none focus:border-accent transition-colors resize-none"
            />
          </div>
        </div>

        {/* Exercise list */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest px-1">
            Exercises ({exercises.length})
          </p>

          {exercises.map((ex, idx) => (
            <div
              key={ex.id}
              className="bg-surface/80 border border-edge rounded-2xl px-4 py-3 flex items-center gap-3"
            >
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => moveExercise(idx, -1)}
                  disabled={idx === 0}
                  className="w-6 h-6 flex items-center justify-center rounded text-ink-disabled disabled:opacity-30 active:opacity-60"
                  aria-label="Move up"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  onClick={() => moveExercise(idx, 1)}
                  disabled={idx === exercises.length - 1}
                  className="w-6 h-6 flex items-center justify-center rounded text-ink-disabled disabled:opacity-30 active:opacity-60"
                  aria-label="Move down"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>

              {/* Exercise info */}
              <button
                onClick={() => navigate(`/program/exercise/${ex.id}?templateId=${templateId}`)}
                className="flex-1 min-w-0 text-left active:opacity-70"
              >
                <p className="font-semibold text-sm text-ink truncate">{ex.name}</p>
                <p className="text-xs text-ink-disabled mt-0.5">
                  {ex.working_set_type === 'top_set'
                    ? `Top set${ex.backoff_set_count > 0 ? ` + ${ex.backoff_set_count} back-off` : ''}`
                    : `${ex.working_set_count}×${ex.working_rep_target}`
                  }
                  {ex.rpe_target ? ` · RPE ${ex.rpe_target}` : ''}
                  {ex.rounding_increment !== 5 ? ` · ${ex.rounding_increment}lb steps` : ''}
                </p>
              </button>

              {/* Delete */}
              <button
                onClick={() => {
                  if (confirm(`Remove "${ex.name}"?`)) handleDeleteExercise(ex.id)
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-disabled active:text-negative active:opacity-70 shrink-0"
                aria-label="Delete exercise"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          ))}

          {/* Add exercise */}
          <button
            onClick={handleAddExercise}
            className="flex items-center justify-center gap-2 py-3 border border-dashed border-edge rounded-2xl text-sm text-ink-secondary active:opacity-70 hover:border-edge-strong transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add exercise
          </button>
        </div>

      </div>
    </div>
  )
}
