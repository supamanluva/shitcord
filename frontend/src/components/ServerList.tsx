import { useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { serverAPI } from '../api/client'
import type { Server } from '../types'

export default function ServerList() {
  const { servers, currentServer, setCurrentServer, setCurrentChannel, addServer } = useChatStore()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)

  const handleSelectServer = (server: Server) => {
    setCurrentServer(server)
    setCurrentChannel(null)
    // Auto-select first text channel
    const firstText = server.channels?.find((c) => c.type === 'text')
    if (firstText) {
      setCurrentChannel(firstText)
    }
  }

  return (
    <>
      <div className="server-list">
        {/* Home / DMs button */}
        <div
          className={`server-icon tooltip ${!currentServer ? 'active' : ''}`}
          data-tooltip="Direct Messages"
          onClick={() => {
            setCurrentServer(null)
            setCurrentChannel(null)
          }}
        >
          💩
        </div>

        <div className="server-separator" />

        {/* Server icons */}
        {servers.map((server) => (
          <div
            key={server.id}
            className={`server-icon tooltip ${currentServer?.id === server.id ? 'active' : ''}`}
            data-tooltip={server.name}
            onClick={() => handleSelectServer(server)}
          >
            {server.icon_url ? (
              <img src={server.icon_url} alt={server.name} />
            ) : (
              getInitials(server.name)
            )}
          </div>
        ))}

        <div className="server-separator" />

        {/* Add server */}
        <div
          className="server-icon server-add tooltip"
          data-tooltip="Create Server"
          onClick={() => setShowCreateModal(true)}
        >
          +
        </div>

        {/* Join server */}
        <div
          className="server-icon tooltip"
          data-tooltip="Join Server"
          onClick={() => setShowJoinModal(true)}
          style={{ color: 'var(--accent-success)' }}
        >
          →
        </div>
      </div>

      {showCreateModal && (
        <CreateServerModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(server) => {
            addServer(server)
            setShowCreateModal(false)
            handleSelectServer(server)
          }}
        />
      )}

      {showJoinModal && (
        <JoinServerModal
          onClose={() => setShowJoinModal(false)}
          onJoined={(server) => {
            addServer(server)
            setShowJoinModal(false)
            handleSelectServer(server)
          }}
        />
      )}
    </>
  )
}

function CreateServerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (server: Server) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const { data } = await serverAPI.create({ name, description, is_private: isPrivate })
      onCreated(data)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr.response?.data?.error || 'Failed to create server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create a Server</h2>
        {error && <div className="error-message" style={{ color: 'var(--accent-danger)', marginBottom: '12px' }}>{error}</div>}
        <div className="form-group">
          <label>Server Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Awesome Server"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this server about?"
          />
        </div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Private Server (invite only)
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create Server'}
          </button>
        </div>
      </div>
    </div>
  )
}

function JoinServerModal({ onClose, onJoined }: { onClose: () => void; onJoined: (server: Server) => void }) {
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleJoin = async () => {
    if (!inviteCode.trim()) return
    setLoading(true)
    setError('')
    try {
      const { data } = await serverAPI.joinByInvite(inviteCode.trim())
      onJoined(data.server)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } }
      setError(axiosErr.response?.data?.error || 'Failed to join server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Join a Server</h2>
        {error && <div className="error-message" style={{ color: 'var(--accent-danger)', marginBottom: '12px' }}>{error}</div>}
        <div className="form-group">
          <label>Invite Code</label>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="Enter an invite code"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleJoin} disabled={loading || !inviteCode.trim()}>
            {loading ? 'Joining...' : 'Join Server'}
          </button>
        </div>
      </div>
    </div>
  )
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()
}
