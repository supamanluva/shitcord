import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { channelAPI, serverAPI } from '../api/client'
import type { Channel } from '../types'

export default function ChannelSidebar() {
  const { currentServer, currentChannel, setCurrentChannel, setCurrentServer, removeServer } = useChatStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  if (!currentServer) return null

  const textChannels = currentServer.channels?.filter((c) => c.type === 'text') || []
  const voiceChannels = currentServer.channels?.filter((c) => c.type === 'voice' || c.type === 'video') || []

  const handleLeaveServer = async () => {
    if (!confirm('Are you sure you want to leave this server?')) return
    try {
      await serverAPI.leaveServer(currentServer.id)
      removeServer(currentServer.id)
      setCurrentServer(null)
      setCurrentChannel(null)
    } catch (err) {
      console.error('Failed to leave server:', err)
    }
  }

  return (
    <div className="channel-sidebar">
      <div className="server-header">
        <span className="truncate">{currentServer.name}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            title="Invite People"
            onClick={() => setShowInvite(true)}
            style={{ fontSize: '1.1rem' }}
          >
            🔗
          </button>
          <button
            title="Settings"
            onClick={handleLeaveServer}
            style={{ fontSize: '1.1rem' }}
          >
            🚪
          </button>
        </div>
      </div>

      <div className="channel-list">
        {/* Text Channels */}
        <div className="channel-category">
          <span>Text Channels</span>
          <button
            onClick={() => setShowCreateChannel(true)}
            style={{ fontSize: '1rem', color: 'var(--text-muted)' }}
            title="Create Channel"
          >
            +
          </button>
        </div>
        {textChannels.map((channel) => (
          <div
            key={channel.id}
            className={`channel-item ${currentChannel?.id === channel.id ? 'active' : ''}`}
            onClick={() => setCurrentChannel(channel)}
          >
            <span className="channel-icon">#</span>
            <span className="truncate">{channel.name}</span>
          </div>
        ))}

        {/* Voice Channels */}
        {voiceChannels.length > 0 && (
          <>
            <div className="channel-category">
              <span>Voice Channels</span>
            </div>
            {voiceChannels.map((channel) => (
              <div
                key={channel.id}
                className={`channel-item ${currentChannel?.id === channel.id ? 'active' : ''}`}
                onClick={() => setCurrentChannel(channel)}
              >
                <span className="channel-icon">🔊</span>
                <span className="truncate">{channel.name}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* User Panel */}
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
        {user?.is_admin && (
          <button onClick={() => navigate('/admin')} title="Admin Panel" style={{ fontSize: '1.1rem', padding: '4px' }}>
            🛡️
          </button>
        )}
      </div>

      {showCreateChannel && (
        <CreateChannelModal
          serverId={currentServer.id}
          onClose={() => setShowCreateChannel(false)}
          onCreated={(channel) => {
            // Add to current server's channels
            if (currentServer.channels) {
              currentServer.channels.push(channel)
            }
            setCurrentChannel(channel)
            setShowCreateChannel(false)
          }}
        />
      )}

      {showInvite && (
        <InviteModal
          inviteCode={currentServer.invite_code}
          serverId={currentServer.id}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  )
}

function CreateChannelModal({
  serverId,
  onClose,
  onCreated,
}: {
  serverId: string
  onClose: () => void
  onCreated: (channel: Channel) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('text')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const { data } = await channelAPI.create(serverId, { name, type })
      onCreated(data)
    } catch (err) {
      console.error('Failed to create channel:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create Channel</h2>
        <div className="form-group">
          <label>Channel Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            placeholder="new-channel"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>Channel Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="text">💬 Text</option>
            <option value="voice">🔊 Voice</option>
            <option value="video">📹 Video</option>
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create Channel'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InviteModal({
  inviteCode,
  serverId,
  onClose,
}: {
  inviteCode: string
  serverId: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [newCode, setNewCode] = useState('')

  const code = newCode || inviteCode

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleNewInvite = async () => {
    try {
      const { data } = await serverAPI.createInvite(serverId)
      setNewCode(data.code)
    } catch (err) {
      console.error('Failed to create invite:', err)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Invite People</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
          Share this invite code with friends to let them join your server.
        </p>
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          background: 'var(--bg-primary)',
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          marginBottom: '16px',
        }}>
          <code style={{
            flex: 1,
            fontSize: '1.1rem',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.05em',
          }}>
            {code}
          </code>
          <button className="btn btn-primary" onClick={handleCopy}>
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={handleNewInvite}>
            Generate New Code
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
