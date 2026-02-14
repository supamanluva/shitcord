import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AdminPanel from './pages/AdminPanel'
import MainLayout from './layouts/MainLayout'

function App() {
  const { token, user } = useAuthStore()

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/register" element={token ? <Navigate to="/" /> : <RegisterPage />} />
      <Route
        path="/admin"
        element={token && user?.is_admin ? <AdminPanel /> : <Navigate to="/" />}
      />
      <Route
        path="/*"
        element={token ? <MainLayout /> : <Navigate to="/login" />}
      />
    </Routes>
  )
}

export default App
