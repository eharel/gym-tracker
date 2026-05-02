import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { upsertExerciseTemplate } from '../lib/db'
import type { ExerciseTemplate, WarmupRule, WorkingSetType } from '../types'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

type DraftExercise = Omit<ExerciseTemplate, 'id' | 'created_at' | 'workout_template_id' | 'position'>

// ─── Small helper components ──────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-ink-disabled uppercase tracking-wide">
      {children}
    </label>
  )
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-disabled outline-none focus:border-accent transition-colors"
    />
  )
}

function NumberInput({
  value,
  onChange,
  min,
  step,
}: {
  value: number | string
  onChange: (v: string) => void
  min?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value)}
      min={min}
      step={step}
      className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink outline-none focus:border-accent transition-colors"
    />
  )
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex bg-elevated border border-edge rounded-xl overflow-hidden">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 py-2 text-xs font-semibold transition-colors',
            i > 0 ? 'border-l border-edge' : '',
            value === opt.value
              ? 'bg-accent text-white'
              : 'text-ink-secondary active:opacity-70',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between py-1"
    >
      <span className="text-sm text-ink">{label}</span>
      <div
        className={[
          'w-10 h-6 rounded-full transition-colors relative',
          value ? 'bg-accent' : 'bg-elevated border border-edge',
        ].join(' ')}
      >
        <div
          className={[
            'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
            value ? 'translate-x-4' : 'translate-x-0.5',
          ].join(' ')}
        />
      </div>
    </button>
  )
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface/80 border border-edge rounded-2xl p-4 flex flex-col gap-4">
      {children}
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseEditorScreen() {
  const { exerciseId } = useParams<{ exerciseId: string }>()
  const [searchParams] = useSearchParams()
  const templateId = searchParams.get('templateId') ?? ''
  const navigate = useNavigate()

  const [exercise, setExercise] = useState<ExerciseTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Editable fields
  const [name, setName] = useState('')
  const [rpeTarget, setRpeTarget] = useState('')
  const [notes, setNotes] = useState('')
  const [supersetGroup, setSupersetGroup] = useState('')
  const [isOptional, setIsOptional] = useState(false)

  // Warmup
  const [warmupRule, setWarmupRule] = useState<WarmupRule>('none')
  // percentage_of_top_set
  const [warmupPercentages, setWarmupPercentages] = useState('')   // comma-separated e.g. "40,60,80"
  const [warmupReps, setWarmupReps] = useState('')                  // comma-separated e.g. "5,3,2"
  // dumbbell_percentage
  const [warmupDbPercentage, setWarmupDbPercentage] = useState('')
  const [warmupDbReps, setWarmupDbReps] = useState('')
  // fixed_weight
  const [warmupFixedWeight, setWarmupFixedWeight] = useState('')
  const [warmupFixedReps, setWarmupFixedReps] = useState('')

  // Working sets
  const [workingSetType, setWorkingSetType] = useState<WorkingSetType>('straight_sets')
  const [workingSetCount, setWorkingSetCount] = useState('3')
  const [workingRepTarget, setWorkingRepTarget] = useState('8-10')

  // Backoff
  const [backoffSetCount, setBackoffSetCount] = useState('0')
  const [backoffPercentage, setBackoffPercentage] = useState('')
  const [backoffRepTarget, setBackoffRepTarget] = useState('')

  // Progression
  const [weightIncrement, setWeightIncrement] = useState('5')
  const [roundingIncrement, setRoundingIncrement] = useState('5')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      if (!exerciseId) return
      try {
        const { data, error } = await supabase
          .from('exercise_templates')
          .select('*')
          .eq('id', exerciseId)
          .single()
        if (error) throw error
        const ex: ExerciseTemplate = data

        setExercise(ex)
        setName(ex.name)
        setRpeTarget(ex.rpe_target ?? '')
        setNotes(ex.notes ?? '')
        setSupersetGroup(ex.superset_group ?? '')
        setIsOptional(ex.is_optional)

        setWarmupRule(ex.warmup_rule)
        setWarmupPercentages(ex.warmup_percentages?.join(', ') ?? '')
        setWarmupReps(ex.warmup_reps?.join(', ') ?? '')
        setWarmupDbPercentage(ex.warmup_db_percentage?.toString() ?? '')
        setWarmupDbReps(ex.warmup_db_reps?.toString() ?? '')
        setWarmupFixedWeight(ex.warmup_fixed_weight?.toString() ?? '')
        setWarmupFixedReps(ex.warmup_fixed_reps?.toString() ?? '')

        setWorkingSetType(ex.working_set_type)
        setWorkingSetCount(ex.working_set_count.toString())
        setWorkingRepTarget(ex.working_rep_target ?? '')

        setBackoffSetCount(ex.backoff_set_count.toString())
        setBackoffPercentage(ex.backoff_percentage?.toString() ?? '')
        setBackoffRepTarget(ex.backoff_rep_target ?? '')

        setWeightIncrement(ex.weight_increment.toString())
        setRoundingIncrement(ex.rounding_increment.toString())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    }
    load()
  }, [exerciseId])

  // ── Save ──────────────────────────────────────────────────────────────────

  function parseNumbers(s: string): number[] | null {
    if (!s.trim()) return null
    const nums = s.split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n > 0)
    return nums.length > 0 ? nums : null
  }

  function buildPayload(overrides: Partial<DraftExercise> = {}): DraftExercise {
    const base: DraftExercise = {
      name,
      rpe_target: rpeTarget.trim() || null,
      notes: notes.trim() || null,
      superset_group: supersetGroup.trim() || null,
      is_optional: isOptional,

      warmup_rule: warmupRule,
      warmup_percentages: warmupRule === 'percentage_of_top_set' ? parseNumbers(warmupPercentages) : null,
      warmup_reps: warmupRule === 'percentage_of_top_set' ? parseNumbers(warmupReps) : null,
      warmup_db_percentage: warmupRule === 'dumbbell_percentage' ? (Number(warmupDbPercentage) || null) : null,
      warmup_db_reps: warmupRule === 'dumbbell_percentage' ? (Number(warmupDbReps) || null) : null,
      warmup_fixed_weight: warmupRule === 'fixed_weight' ? (Number(warmupFixedWeight) || null) : null,
      warmup_fixed_reps: warmupRule === 'fixed_weight' ? (Number(warmupFixedReps) || null) : null,

      working_set_type: workingSetType,
      working_set_count: Number(workingSetCount) || 1,
      working_rep_target: workingRepTarget.trim() || null,

      backoff_set_count: Number(backoffSetCount) || 0,
      backoff_percentage: Number(backoffSetCount) > 0 ? (Number(backoffPercentage) || null) : null,
      backoff_rep_target: Number(backoffSetCount) > 0 ? (backoffRepTarget.trim() || null) : null,

      weight_increment: Number(weightIncrement) || 5,
      rounding_increment: Number(roundingIncrement) || 5,
    }
    return { ...base, ...overrides }
  }

  function scheduleSave(overrides: Partial<DraftExercise> = {}) {
    if (!exercise) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!exerciseId || !exercise) return
      setSaving(true)
      try {
        await upsertExerciseTemplate({
          id: exerciseId,
          workout_template_id: exercise.workout_template_id,
          position: exercise.position,
          ...buildPayload(overrides),
        })
      } catch {
        // silent — non-critical
      } finally {
        setSaving(false)
      }
    }, 800)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-negative text-sm">{error}</p>
    </div>
  )

  if (!exercise) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const backoffCount = Number(backoffSetCount) || 0

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate(templateId ? `/program/template/${templateId}` : '/program')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70 shrink-0"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{name || 'Exercise'}</h1>
            {saving && <p className="text-xs text-ink-disabled">Saving…</p>}
          </div>
        </div>

        {/* ── Basic info ────────────────────────────────────────────────────── */}
        <SectionCard>
          <FieldGroup>
            <Label>Name</Label>
            <TextInput
              value={name}
              onChange={v => { setName(v); scheduleSave({ name: v }) }}
              placeholder="Exercise name"
            />
          </FieldGroup>

          <FieldGroup>
            <Label>RPE target</Label>
            <TextInput
              value={rpeTarget}
              onChange={v => { setRpeTarget(v); scheduleSave({ rpe_target: v.trim() || null }) }}
              placeholder="e.g. 8 or 7-8"
            />
          </FieldGroup>

          <FieldGroup>
            <Label>Superset group</Label>
            <TextInput
              value={supersetGroup}
              onChange={v => { setSupersetGroup(v); scheduleSave({ superset_group: v.trim() || null }) }}
              placeholder="e.g. A (leave blank if none)"
            />
          </FieldGroup>

          <FieldGroup>
            <Label>Notes</Label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => { setNotes(e.target.value); scheduleSave({ notes: e.target.value.trim() || null }) }}
              placeholder="Cues, form reminders…"
              className="bg-elevated border border-edge rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-ink-disabled outline-none focus:border-accent transition-colors resize-none"
            />
          </FieldGroup>

          <Toggle
            value={isOptional}
            onChange={v => { setIsOptional(v); scheduleSave({ is_optional: v }) }}
            label="Optional exercise"
          />
        </SectionCard>

        {/* ── Working sets ─────────────────────────────────────────────────── */}
        <SectionCard>
          <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest">Working sets</p>

          <FieldGroup>
            <Label>Set type</Label>
            <SegmentedControl<WorkingSetType>
              options={[
                { label: 'Straight', value: 'straight_sets' },
                { label: 'Top set', value: 'top_set' },
                { label: 'AMRAP', value: 'amrap' },
              ]}
              value={workingSetType}
              onChange={v => { setWorkingSetType(v); scheduleSave({ working_set_type: v }) }}
            />
          </FieldGroup>

          {workingSetType !== 'top_set' && (
            <FieldGroup>
              <Label>Number of sets</Label>
              <NumberInput
                value={workingSetCount}
                onChange={v => { setWorkingSetCount(v); scheduleSave({ working_set_count: Number(v) || 1 }) }}
                min={1}
              />
            </FieldGroup>
          )}

          {workingSetType !== 'amrap' && (
            <FieldGroup>
              <Label>Rep target</Label>
              <TextInput
                value={workingRepTarget}
                onChange={v => { setWorkingRepTarget(v); scheduleSave({ working_rep_target: v.trim() || null }) }}
                placeholder="e.g. 5, 8-10, 3-5"
              />
            </FieldGroup>
          )}
        </SectionCard>

        {/* ── Backoff sets ─────────────────────────────────────────────────── */}
        {workingSetType === 'top_set' && (
          <SectionCard>
            <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest">Back-off sets</p>

            <FieldGroup>
              <Label>Number of back-off sets</Label>
              <NumberInput
                value={backoffSetCount}
                onChange={v => { setBackoffSetCount(v); scheduleSave({ backoff_set_count: Number(v) || 0 }) }}
                min={0}
              />
            </FieldGroup>

            {backoffCount > 0 && (
              <>
                <FieldGroup>
                  <Label>Back-off % of top set</Label>
                  <NumberInput
                    value={backoffPercentage}
                    onChange={v => { setBackoffPercentage(v); scheduleSave({ backoff_percentage: Number(v) || null }) }}
                    min={1}
                    step={5}
                  />
                </FieldGroup>
                <FieldGroup>
                  <Label>Back-off rep target</Label>
                  <TextInput
                    value={backoffRepTarget}
                    onChange={v => { setBackoffRepTarget(v); scheduleSave({ backoff_rep_target: v.trim() || null }) }}
                    placeholder="e.g. 6-8"
                  />
                </FieldGroup>
              </>
            )}
          </SectionCard>
        )}

        {/* ── Warmup ───────────────────────────────────────────────────────── */}
        <SectionCard>
          <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest">Warmup</p>

          <FieldGroup>
            <Label>Warmup type</Label>
            <SegmentedControl<WarmupRule>
              options={[
                { label: 'None', value: 'none' },
                { label: 'Barbell %', value: 'percentage_of_top_set' },
                { label: 'DB %', value: 'dumbbell_percentage' },
                { label: 'Fixed', value: 'fixed_weight' },
              ]}
              value={warmupRule}
              onChange={v => { setWarmupRule(v); scheduleSave({ warmup_rule: v }) }}
            />
          </FieldGroup>

          {warmupRule === 'percentage_of_top_set' && (
            <>
              <FieldGroup>
                <Label>Percentages (comma-separated)</Label>
                <TextInput
                  value={warmupPercentages}
                  onChange={v => {
                    setWarmupPercentages(v)
                    scheduleSave({ warmup_percentages: parseNumbers(v) })
                  }}
                  placeholder="e.g. 40, 60, 80"
                />
              </FieldGroup>
              <FieldGroup>
                <Label>Reps per warmup set (comma-separated)</Label>
                <TextInput
                  value={warmupReps}
                  onChange={v => {
                    setWarmupReps(v)
                    scheduleSave({ warmup_reps: parseNumbers(v) })
                  }}
                  placeholder="e.g. 5, 4, 3"
                />
              </FieldGroup>
            </>
          )}

          {warmupRule === 'dumbbell_percentage' && (
            <>
              <FieldGroup>
                <Label>% of working weight</Label>
                <NumberInput
                  value={warmupDbPercentage}
                  onChange={v => { setWarmupDbPercentage(v); scheduleSave({ warmup_db_percentage: Number(v) || null }) }}
                  min={1}
                  step={5}
                />
              </FieldGroup>
              <FieldGroup>
                <Label>Reps</Label>
                <NumberInput
                  value={warmupDbReps}
                  onChange={v => { setWarmupDbReps(v); scheduleSave({ warmup_db_reps: Number(v) || null }) }}
                  min={1}
                />
              </FieldGroup>
            </>
          )}

          {warmupRule === 'fixed_weight' && (
            <>
              <FieldGroup>
                <Label>Fixed weight (lbs)</Label>
                <NumberInput
                  value={warmupFixedWeight}
                  onChange={v => { setWarmupFixedWeight(v); scheduleSave({ warmup_fixed_weight: Number(v) || null }) }}
                  min={0}
                  step={2.5}
                />
              </FieldGroup>
              <FieldGroup>
                <Label>Reps</Label>
                <NumberInput
                  value={warmupFixedReps}
                  onChange={v => { setWarmupFixedReps(v); scheduleSave({ warmup_fixed_reps: Number(v) || null }) }}
                  min={1}
                />
              </FieldGroup>
            </>
          )}
        </SectionCard>

        {/* ── Progression ──────────────────────────────────────────────────── */}
        <SectionCard>
          <p className="text-xs font-semibold text-ink-disabled uppercase tracking-widest">Progression</p>

          <FieldGroup>
            <Label>Weight increment (lbs)</Label>
            <NumberInput
              value={weightIncrement}
              onChange={v => { setWeightIncrement(v); scheduleSave({ weight_increment: Number(v) || 5 }) }}
              min={0}
              step={2.5}
            />
          </FieldGroup>

          <FieldGroup>
            <Label>Rounding increment (lbs)</Label>
            <NumberInput
              value={roundingIncrement}
              onChange={v => { setRoundingIncrement(v); scheduleSave({ rounding_increment: Number(v) || 5 }) }}
              min={1}
              step={0.5}
            />
          </FieldGroup>
        </SectionCard>

      </div>
    </div>
  )
}
