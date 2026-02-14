import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authAPI } from '../api/client'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const { data } = await authAPI.register({ username, email, password })
      if (data.pending) {
        setPending(true)
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr.response?.data?.error || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>💩 Shitcord</h1>

        {pending ? (
          <div className="pending-approval">
            <div className="pending-icon">⏳</div>
            <h2>Account Created!</h2>
            <p>Your account is pending admin approval. You'll be able to log in once an admin approves your registration.</p>
            <Link to="/login" className="btn-primary" style={{ display: 'inline-block', marginTop: '1rem', textDecoration: 'none' }}>
              Back to Login
            </Link>
          </div>
        ) : (
          <>
            <p className="subtitle">Create an account</p>

            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  required
                  minLength={3}
                  maxLength={32}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  required
                  minLength={8}
                />
              </div>

              <div className="form-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                />
              </div>

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <p className="auth-footer">
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
