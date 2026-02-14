import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminAPI } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import type { User } from '../types'

export default function AdminPanel() {
  const [pendingUsers, setPendingUsers] = useState<User[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { user } = useAuthStore()

  useEffect(() => {
    if (!user?.is_admin) {
      navigate('/')
      return
    }
    loadData()
  }, [user, navigate])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [pendingRes, allRes] = await Promise.all([
        adminAPI.getPendingUsers(),
        adminAPI.getAllUsers(),
      ])
      setPendingUsers(pendingRes.data)
      setAllUsers(allRes.data)
    } catch {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (id: string) => {
    try {
      await adminAPI.approveUser(id)
      setPendingUsers((prev) => prev.filter((u) => u.id !== id))
      setAllUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, is_approved: true } : u))
      )
    } catch {
      setError('Failed to approve user')
    }
  }

  const handleReject = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    try {
      await adminAPI.rejectUser(id)
      setPendingUsers((prev) => prev.filter((u) => u.id !== id))
      setAllUsers((prev) => prev.filter((u) => u.id !== id))
    } catch {
      setError('Failed to reject user')
    }
  }

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <button className="admin-back-btn" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>🛡️ Admin Panel</h1>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          Pending ({pendingUsers.length})
        </button>
        <button
          className={`admin-tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All Users ({allUsers.length})
        </button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : activeTab === 'pending' ? (
        <div className="admin-user-list">
          {pendingUsers.length === 0 ? (
            <div className="admin-empty">No pending registrations 🎉</div>
          ) : (
            pendingUsers.map((u) => (
              <div key={u.id} className="admin-user-card">
                <div className="admin-user-info">
                  <span className="admin-user-name">{u.username}</span>
                  <span className="admin-user-email">{u.email}</span>
                  <span className="admin-user-date">
                    Registered: {formatDate(u.created_at)}
                  </span>
                </div>
                <div className="admin-user-actions">
                  <button
                    className="admin-btn approve"
                    onClick={() => handleApprove(u.id)}
                  >
                    ✅ Approve
                  </button>
                  <button
                    className="admin-btn reject"
                    onClick={() => handleReject(u.id, u.username)}
                  >
                    ❌ Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="admin-user-list">
          {allUsers.map((u) => (
            <div key={u.id} className="admin-user-card">
              <div className="admin-user-info">
                <span className="admin-user-name">
                  {u.username}
                  {u.is_admin && <span className="admin-badge">ADMIN</span>}
                </span>
                <span className="admin-user-email">{u.email}</span>
                <span className="admin-user-date">
                  {formatDate(u.created_at)}
                </span>
              </div>
              <div className="admin-user-actions">
                <span
                  className={`admin-status ${u.is_approved ? 'approved' : 'pending'}`}
                >
                  {u.is_approved ? '✅ Approved' : '⏳ Pending'}
                </span>
                {!u.is_approved && (
                  <button
                    className="admin-btn approve"
                    onClick={() => handleApprove(u.id)}
                  >
                    Approve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
