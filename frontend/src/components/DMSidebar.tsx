import { useState, useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { dmAPI } from '../api/client'
import type { DMChannel } from '../types'

export default function DMSidebar() {
  const { user, logout } = useAuthStore()
  const {
    dmChannels, setDMChannels, currentDMChannel, setCurrentDMChannel,
  } = useChatStore()
  const [loading, setLoading] = useState(false)
  const [showNewDM, setShowNewDM] = useState(false)

  useEffect(() => {
    const loadDMs = async () => {
      setLoading(true)
      try {
        const { data } = await dmAPI.getDMChannels()
        setDMChannels(data || [])
      } catch (err) {
        console.error('Failed to load DMs:', err)
      } finally {
        setLoading(false)
      }
    }
    loadDMs()
  }, [setDMChannels])

  const getOtherUser = (dm: DMChannel) => {
    return dm.user1_id === user?.id ? dm.user2 : dm.user1
  }

  return (
    <div className="channel-sidebar">
      <div className="server-header">
        <span className="truncate">Direct Messages</span>
        <button
          onClick={() => setShowNewDM(true)}
          title="New DM"
          style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}
        >
          +
        </button>
      </div>

      <div className="channel-list">
        <div className="channel-category">
          <span>Conversations</span>
        </div>

        {loading ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Loading...
          </div>
        ) : dmChannels.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No conversations yet. Click + to start one!
          </div>
        ) : (
          dmChannels.map((dm) => {
            const other = getOtherUser(dm)
            if (!other) return null
            return (
              <div
                key={dm.id}
                className={`channel-item dm-item ${currentDMChannel?.id === dm.id ? 'active' : ''}`}
                onClick={() => setCurrentDMChannel(dm)}
              >
                <div className="dm-avatar" style={{ background: stringToColor(other.username || '') }}>
                  {(other.display_name || other.username || '?')[0].toUpperCase()}
                </div>
                <span className="truncate">{other.display_name || other.username}</span>
              </div>
            )
          })
        )}
      </div>

      {/* User Panel (same as channel sidebar) */}
      <div className="user-panel">
        <div className="user-avatar">
          {(user?.display_name || user?.username || '?')[0].toUpperCase()}
          <span className={`status-dot ${user?.status || 'online'}`} />
        </div>
        <div className="user-info">
          <div className="username truncate">{user?.display_name || user?.username}</div>
          <div className="user-status">🔒 E2E Encrypted</div>
        </div>
        <button onClick={logout} title="Logout" style={{ fontSize: '1.1rem', padding: '4px' }}>
          ⏏
        </button>
      </div>

      {showNewDM && (
        <NewDMModal
          onClose={() => setShowNewDM(false)}
          onCreated={(dm) => {
            setShowNewDM(false)
            setCurrentDMChannel(dm)
          }}
        />
      )}
    </div>
  )
}

function NewDMModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (dm: DMChannel) => void
}) {
  const { servers, members } = useChatStore()
  const { user } = useAuthStore()
  const { addDMChannel } = useChatStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Gather unique users from all servers
  const allUsers = new Map<string, { id: string; username: string; display_name: string }>()
  Object.values(members).forEach((memberList) => {
    memberList.forEach((m) => {
      if (m.user && m.user_id !== user?.id) {
        allUsers.set(m.user_id, {
          id: m.user_id,
          username: m.user.username,
          display_name: m.user.display_name,
        })
      }
    })
  })

  const userList = Array.from(allUsers.values())

  const handleSelect = async (userId: string) => {
    setLoading(true)
    setError('')
    try {
      const { data } = await dmAPI.createDM(userId)
      addDMChannel(data)
      onCreated(data)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr.response?.data?.error || 'Failed to create DM')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Direct Message</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
          Select a user to start a conversation.
        </p>
        {error && (
          <div style={{ color: 'var(--accent-danger)', marginBottom: '12px', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}
        {userList.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px', fontSize: '0.9rem' }}>
            No users found. Join a server to find people to message!
          </div>
        ) : (
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {userList.map((u) => (
              <div
                key={u.id}
                className="member-item"
                onClick={() => !loading && handleSelect(u.id)}
                style={{ cursor: loading ? 'wait' : 'pointer' }}
              >
                <div className="dm-avatar" style={{ background: stringToColor(u.username) }}>
                  {(u.display_name || u.username || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                    {u.display_name || u.username}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    @{u.username}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function stringToColor(str: string): string {
  const colors = [
    '#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245',
    '#f47b67', '#e78df5', '#45b3e0', '#3ba55c', '#f0b232',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}
