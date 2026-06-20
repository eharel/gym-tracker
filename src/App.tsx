import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
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

function App() {
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
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
