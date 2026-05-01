import { useNavigate } from 'react-router-dom'

export default function ProgramScreen() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen">
      <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-6">

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface border border-edge text-ink-secondary active:opacity-70"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-ink">Program Editor</h1>
        </div>

        <div className="bg-surface/60 border border-edge rounded-2xl p-6 flex flex-col items-center gap-3 text-center">
          <p className="text-ink-secondary text-sm">Program editor coming in Phase 10.</p>
        </div>

      </div>
    </div>
  )
}
