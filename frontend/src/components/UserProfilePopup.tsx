import { useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { dmAPI } from '../api/client'
import { wsService } from '../services/websocket'
import { ringToneService } from '../services/ringtone'
import type { User, DMChannel } from '../types'

interface UserProfilePopupProps {
  targetUser: User
  position: { x: number; y: number }
  onClose: () => void
}

export default function UserProfilePopup({ targetUser, position, onClose }: UserProfilePopupProps) {
  const { user } = useAuthStore()
  const { addDMChannel, setCurrentDMChannel } = useChatStore()
  const [loading, setLoading] = useState(false)

  if (!targetUser || targetUser.id === user?.id) return null

  const handleMessage = async () => {
    setLoading(true)
    try {
      const { data } = await dmAPI.createDM(targetUser.id)
      addDMChannel(data)
      setCurrentDMChannel(data)
      onClose()
    } catch (err) {
      console.error('Failed to create DM:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCall = async (callType: 'audio' | 'video') => {
    setLoading(true)
    try {
      const { data } = await dmAPI.createDM(targetUser.id)
      addDMChannel(data)
      setCurrentDMChannel(data)

      // Ring the other user
      wsService.sendDMCallRing(targetUser.id, data.id, callType)

      // Set active call state
      useChatStore.getState().setActiveDMCall({
        dmChannelId: data.id,
        remoteUserId: targetUser.id,
        callType,
      })

      // Start outgoing ring tone so caller knows it's ringing
      ringToneService.startOutgoingRing()

      onClose()
    } catch (err) {
      console.error('Failed to start call:', err)
    } finally {
      setLoading(false)
    }
  }

  // Calculate position so popup stays on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 300),
    top: Math.min(position.y, window.innerHeight - 300),
    zIndex: 1001,
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} style={{ background: 'transparent' }} />
      <div className="user-profile-popup" style={style}>
        {/* Banner */}
        <div className="profile-banner" style={{ background: stringToColor(targetUser.username) }} />

        {/* Avatar */}
        <div className="profile-avatar" style={{ background: stringToColor(targetUser.username) }}>
          {(targetUser.display_name || targetUser.username || '?')[0].toUpperCase()}
        </div>

        {/* User info */}
        <div className="profile-info">
          <div className="profile-display-name">
            {targetUser.display_name || targetUser.username}
          </div>
          <div className="profile-username">@{targetUser.username}</div>
          {targetUser.bio && (
            <div className="profile-bio">{targetUser.bio}</div>
          )}
        </div>

        {/* Actions */}
        <div className="profile-actions">
          <button
            className="btn btn-primary"
            onClick={handleMessage}
            disabled={loading}
            style={{ flex: 1 }}
          >
            💬 Message
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleCall('audio')}
            disabled={loading}
            title="Voice Call"
          >
            📞
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleCall('video')}
            disabled={loading}
            title="Video Call"
          >
            📹
          </button>
        </div>
      </div>
    </>
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
