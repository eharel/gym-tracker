import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSettingsStore } from './store/settings'
import { useProfileStore } from './store/profile'
import ProfilePickerScreen from './screens/ProfilePickerScreen'
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
import ProgressScreen from './screens/ProgressScreen'

function App() {
  const profilesLoaded = useProfileStore(s => s.loaded)
  const currentProfileId = useProfileStore(s => s.currentProfileId)
  const loadProfiles = useProfileStore(s => s.load)
  const loadSettings = useSettingsStore(s => s.load)

  useEffect(() => { loadProfiles() }, [loadProfiles])
  // Settings are per-profile; the store reloads when the profile changes
  useEffect(() => {
    if (currentProfileId) loadSettings()
  }, [currentProfileId, loadSettings])

  if (!profilesLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!currentProfileId) {
    return (
      <ErrorBoundary>
        <ProfilePickerScreen />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
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
        <Route path="/progress" element={<ProgressScreen />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
