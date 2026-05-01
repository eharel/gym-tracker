import { useEffect, useRef, useState } from 'react'

const PRESETS = [
  { label: '1m',  seconds: 60  },
  { label: '90s', seconds: 90  },
  { label: '2m',  seconds: 120 },
  { label: '3m',  seconds: 180 },
  { label: '5m',  seconds: 300 },
]

const STORAGE_KEY = 'gym-tracker:rest-duration'

function playBeep() {
  try {
    const ctx = new AudioContext()
    // Two quick tones
    ;[0, 0.25].forEach(offset => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0, ctx.currentTime + offset)
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.4)
      osc.start(ctx.currentTime + offset)
      osc.stop(ctx.currentTime + offset + 0.4)
    })
    setTimeout(() => ctx.close(), 1000)
  } catch (_) {}
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function RestTimer() {
  const [duration, setDuration] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? parseInt(saved, 10) : 120
  })
  const [remaining, setRemaining] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  function start(secs = duration) {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setRemaining(secs)
    setDone(false)
    setShowPicker(false)
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(intervalRef.current!)
          setDone(true)
          playBeep()
          setTimeout(() => { setRemaining(null); setDone(false) }, 3000)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  function stop() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setRemaining(null)
    setDone(false)
    setShowPicker(false)
  }

  function selectPreset(seconds: number) {
    setDuration(seconds)
    localStorage.setItem(STORAGE_KEY, String(seconds))
    start(seconds)
  }

  const isRunning = remaining !== null && !done
  const isLow = isRunning && remaining !== null && remaining <= 10

  return (
    <div className="fixed bottom-8 right-4 flex flex-col items-end gap-2 z-50 select-none">

      {/* Preset picker — floats upward */}
      {showPicker && (
        <div className="flex flex-col items-end gap-1.5 mb-1">
          {PRESETS.map(p => (
            <button
              key={p.seconds}
              onClick={() => selectPreset(p.seconds)}
              className={`text-xs font-semibold px-3.5 py-2 rounded-xl border shadow-card transition-colors
                ${duration === p.seconds
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface/95 backdrop-blur text-ink-secondary border-edge active:opacity-70'
                }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Duration / edit button — hidden while running */}
        {!isRunning && !done && (
          <button
            onClick={() => setShowPicker(p => !p)}
            className={`h-8 px-2.5 flex items-center gap-1.5 rounded-full border shadow-card transition-colors text-xs font-medium
              ${showPicker
                ? 'bg-elevated border-edge-strong text-ink'
                : 'bg-surface/90 backdrop-blur border-edge text-ink-disabled active:opacity-70'
              }`}
            aria-label="Set timer duration"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
            </svg>
            <span>{fmt(duration)}</span>
          </button>
        )}

        {/* Main FAB */}
        <button
          onClick={isRunning ? stop : () => start()}
          className={`flex items-center justify-center rounded-full font-bold shadow-elevated transition-all active:scale-95
            ${done
              ? 'w-14 h-14 bg-positive text-gray-900'
              : isRunning
                ? `w-14 h-14 border-2 tabular-nums text-sm font-bold
                   ${isLow
                     ? 'bg-negative/10 border-negative text-negative'
                     : 'bg-elevated border-edge-strong text-ink'
                   }`
                : 'w-12 h-12 bg-surface/90 backdrop-blur border border-edge text-ink-secondary'
            }`}
          aria-label={isRunning ? 'Stop timer' : 'Start rest timer'}
        >
          {done ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : isRunning ? (
            fmt(remaining!)
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
