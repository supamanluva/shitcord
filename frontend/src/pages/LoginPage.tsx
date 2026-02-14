import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { authAPI } from '../api/client'
import { encryptionService } from '../services/encryption'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setTokens, setUser } = useAuthStore()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setPending(false)
    setLoading(true)

    try {
      const { data } = await authAPI.login({ email, password })
      setTokens(data.token, data.refresh_token)
      setUser(data.user)

      // Load existing encryption keys
      const loaded = await encryptionService.loadIdentityKeyPair()
      if (!loaded) {
        // Generate new keys if none stored locally
        await encryptionService.generateIdentityKeyPair()
      }

      navigate('/')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; pending?: boolean } } }
      if (axiosErr.response?.data?.pending) {
        setPending(true)
      } else {
        setError(axiosErr.response?.data?.error || 'Login failed')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>💩 Shitcord</h1>
        <p className="subtitle">Welcome back!</p>

        {error && <div className="error-message">{error}</div>}
        {pending && (
          <div className="pending-approval-inline">
            ⏳ Your account is pending admin approval. Please check back later.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className="auth-footer">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  )
}
