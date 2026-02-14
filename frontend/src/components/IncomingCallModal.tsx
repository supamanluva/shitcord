import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { wsService } from '../services/websocket'
import { webrtcService } from '../services/webrtc'

export default function IncomingCallModal() {
  const { incomingCall, setIncomingCall, setActiveDMCall, setCurrentDMChannel, dmChannels } = useChatStore()
  const { user } = useAuthStore()
  const [ringing, setRinging] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (incomingCall) {
      setRinging(true)
      // Auto-reject after 30 seconds
      const timeout = setTimeout(() => {
        handleReject()
      }, 30000)
      return () => clearTimeout(timeout)
    } else {
      setRinging(false)
    }
  }, [incomingCall])

  if (!incomingCall) return null

  const handleAccept = async () => {
    try {
      // Find the DM channel
      const dm = dmChannels.find((d) => d.id === incomingCall.dmChannelId)
      if (dm) {
        setCurrentDMChannel(dm)
      }

      // Tell the caller we accepted
      wsService.sendDMCallAccept(incomingCall.fromUserId, incomingCall.dmChannelId)

      // Set active call
      setActiveDMCall({
        dmChannelId: incomingCall.dmChannelId,
        remoteUserId: incomingCall.fromUserId,
        callType: incomingCall.callType,
      })

      setIncomingCall(null)
    } catch (err) {
      console.error('Failed to accept call:', err)
    }
  }

  const handleReject = () => {
    wsService.sendDMCallReject(incomingCall.fromUserId, incomingCall.dmChannelId)
    setIncomingCall(null)
  }

  return (
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="incoming-call-modal">
        <div className="call-ring-animation">
          <div className="call-avatar" style={{ background: stringToColor(incomingCall.fromUsername) }}>
            {incomingCall.fromUsername[0].toUpperCase()}
          </div>
          <div className="ring-pulse" />
          <div className="ring-pulse ring-pulse-2" />
        </div>

        <h2 style={{ marginTop: '24px', marginBottom: '4px' }}>
          {incomingCall.fromUsername}
        </h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px', fontSize: '0.9rem' }}>
          Incoming {incomingCall.callType === 'video' ? 'Video' : 'Voice'} Call...
        </p>

        <div style={{ display: 'flex', gap: '24px' }}>
          <button
            className="call-btn call-reject"
            onClick={handleReject}
            title="Reject"
          >
            <span>📞</span>
          </button>
          <button
            className="call-btn call-accept"
            onClick={handleAccept}
            title="Accept"
          >
            <span>{incomingCall.callType === 'video' ? '📹' : '📞'}</span>
          </button>
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
