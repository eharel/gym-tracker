import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomeScreen from './screens/HomeScreen'
import WorkoutScreen from './screens/WorkoutScreen'
import SummaryScreen from './screens/SummaryScreen'
import ProgramScreen from './screens/ProgramScreen'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/workout/:sessionId" element={<WorkoutScreen />} />
        <Route path="/summary/:sessionId" element={<SummaryScreen />} />
        <Route path="/program" element={<ProgramScreen />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
