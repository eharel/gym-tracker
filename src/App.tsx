import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomeScreen from './screens/HomeScreen'
import WorkoutScreen from './screens/WorkoutScreen'
import SummaryScreen from './screens/SummaryScreen'
import ProgramScreen from './screens/ProgramScreen'
import TemplateEditorScreen from './screens/TemplateEditorScreen'
import ExerciseEditorScreen from './screens/ExerciseEditorScreen'
import SessionsScreen from './screens/SessionsScreen'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/workout/:sessionId" element={<WorkoutScreen />} />
        <Route path="/summary/:sessionId" element={<SummaryScreen />} />
        <Route path="/program" element={<ProgramScreen />} />
        <Route path="/program/template/:templateId" element={<TemplateEditorScreen />} />
        <Route path="/program/exercise/:exerciseId" element={<ExerciseEditorScreen />} />
        <Route path="/sessions" element={<SessionsScreen />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
