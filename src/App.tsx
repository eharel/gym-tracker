import { useRegisterSW } from 'virtual:pwa-register/react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomeScreen from './screens/HomeScreen'
import WorkoutScreen from './screens/WorkoutScreen'
import SummaryScreen from './screens/SummaryScreen'
import ProgramScreen from './screens/ProgramScreen'
import TemplateEditorScreen from './screens/TemplateEditorScreen'
import ExerciseEditorScreen from './screens/ExerciseEditorScreen'
import SessionsScreen from './screens/SessionsScreen'
import SessionDetailScreen from './screens/SessionDetailScreen'
import ExerciseHistoryScreen from './screens/ExerciseHistoryScreen'
import WorkoutPreviewScreen from './screens/WorkoutPreviewScreen'

function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-3 px-4 py-3 bg-accent text-white text-sm font-medium shadow-lg">
      <span>New version available</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="shrink-0 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 text-xs font-semibold active:opacity-70"
      >
        Update
      </button>
    </div>
  )
}

function App() {
  return (
    <>
    <UpdateBanner />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/workout/:sessionId" element={<WorkoutScreen />} />
        <Route path="/summary/:sessionId" element={<SummaryScreen />} />
        <Route path="/program" element={<ProgramScreen />} />
        <Route path="/program/template/:templateId" element={<TemplateEditorScreen />} />
        <Route path="/program/exercise/:exerciseId" element={<ExerciseEditorScreen />} />
        <Route path="/sessions" element={<SessionsScreen />} />
        <Route path="/sessions/:sessionId" element={<SessionDetailScreen />} />
        <Route path="/workout/preview" element={<WorkoutPreviewScreen />} />
        <Route path="/program/exercise/:exerciseId/history" element={<ExerciseHistoryScreen />} />
      </Routes>
    </BrowserRouter>
    </>
  )
}

export default App
