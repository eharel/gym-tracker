import { useNavigate, useParams } from 'react-router-dom'

export default function SummaryScreen() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <p className="text-ink font-bold text-lg">Session complete!</p>
      <p className="text-ink-secondary text-sm">Summary coming in Phase 9.</p>
      <p className="text-ink-disabled text-xs font-mono">{sessionId}</p>
      <button
        onClick={() => navigate('/')}
        className="mt-4 bg-accent text-white font-semibold rounded-xl px-8 py-3"
      >
        Done
      </button>
    </div>
  )
}
