import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import App from './App'

/**
 * Router wrapper.
 * Step 1: keep the existing MVP UX intact (single App view with tabs)
 * while we progressively migrate each tab into a real route/page.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin" element={<App />} />
        <Route path="/admin/:tab" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
