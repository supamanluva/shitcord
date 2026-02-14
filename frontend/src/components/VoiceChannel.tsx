import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { voiceAPI } from '../api/client'
import { webrtcService } from '../services/webrtc'
import { wsService } from '../services/websocket'
import type { VoiceState } from '../types'

export default function VoiceChannel({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const { currentChannel, setCurrentChannel } = useChatStore()
  const { user } = useAuthStore()
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [participants, setParticipants] = useState<VoiceState[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const localVideoRef = useRef<HTMLVideoElement>(null)

  const isVideoChannel = currentChannel?.type === 'video'

  // Handle remote stream arrivals
  useEffect(() => {
    webrtcService.setOnRemoteStream((userId, stream) => {
      setRemoteStreams((prev) => {
        const newMap = new Map(prev)
        newMap.set(userId, stream)
        return newMap
      })
    })

    webrtcService.setOnPeerDisconnected((userId) => {
      setRemoteStreams((prev) => {
        const newMap = new Map(prev)
        newMap.delete(userId)
        return newMap
      })
    })
  }, [])

  // Listen for voice state join/leave events via WebSocket
  useEffect(() => {
    if (!currentChannel) return

    const handleVoiceJoin = (data: unknown) => {
      const { channel_id, voice_state } = data as { channel_id: string; voice_state: VoiceState }
      if (channel_id === currentChannel.id) {
        setParticipants((prev) => {
          if (prev.find((p) => p.user_id === voice_state.user_id)) return prev
          return [...prev, voice_state]
        })
      }
    }

    const handleVoiceLeave = (data: unknown) => {
      const { channel_id, user_id: leftUserId } = data as { channel_id: string; user_id: string }
      if (channel_id === currentChannel.id) {
        setParticipants((prev) => prev.filter((p) => p.user_id !== leftUserId))
      }
    }

    wsService.on('VOICE_STATE_JOIN', handleVoiceJoin)
    wsService.on('VOICE_STATE_LEAVE', handleVoiceLeave)
    return () => {
      wsService.off('VOICE_STATE_JOIN', handleVoiceJoin)
      wsService.off('VOICE_STATE_LEAVE', handleVoiceLeave)
    }
  }, [currentChannel])

  const handleJoin = async () => {
    if (!currentChannel) return

    try {
      // Join voice channel via API
      const { data } = await voiceAPI.joinVoice(currentChannel.id)
      setParticipants(data.participants)

      // Start WebRTC
      const localStream = await webrtcService.joinChannel(currentChannel.id, {
        audio: true,
        video: isVideoChannel,
      })

      // Show local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream
      }

      // Connect to existing participants
      for (const p of data.participants as VoiceState[]) {
        if (p.user_id !== user?.id) {
          await webrtcService.callUser(p.user_id, p.user?.username || '')
        }
      }

      setIsConnected(true)
    } catch (err) {
      console.error('Failed to join voice channel:', err)
      alert('Failed to access microphone/camera. Please check permissions.')
    }
  }

  const handleLeave = async () => {
    if (!currentChannel) return

    webrtcService.leaveChannel()
    await voiceAPI.leaveVoice(currentChannel.id)
    setIsConnected(false)
    setRemoteStreams(new Map())
    setParticipants([])
  }

  const handleToggleMute = () => {
    const muted = webrtcService.toggleMute()
    setIsMuted(muted)
  }

  const handleToggleVideo = () => {
    const videoOff = webrtcService.toggleVideo()
    setIsVideoOff(videoOff)
  }

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      webrtcService.stopScreenShare()
      setIsScreenSharing(false)
      // Update local preview back to camera
      if (localVideoRef.current && webrtcService.getLocalStream()) {
        localVideoRef.current.srcObject = webrtcService.getLocalStream()
      }
    } else {
      try {
        const screenStream = await webrtcService.startScreenShare()
        setIsScreenSharing(true)
        // Update local preview to show screen
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = webrtcService.getLocalStream()
        }
        // Auto-revert state when user stops via browser button
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
          setIsScreenSharing(false)
          if (localVideoRef.current && webrtcService.getLocalStream()) {
            localVideoRef.current.srcObject = webrtcService.getLocalStream()
          }
        })
      } catch (err) {
        console.error('Failed to share screen:', err)
      }
    }
  }

  if (!currentChannel) return null

  return (
    <div className="chat-area">
      {/* Header */}
      <div className="chat-header">
        <button className="mobile-back-btn" onClick={onMobileMenuToggle}>←</button>
        <button className="mobile-menu-btn" onClick={onMobileMenuToggle}>☰</button>
        <span style={{ fontSize: '1.2rem', opacity: 0.6 }}>
          {isVideoChannel ? '📹' : '🔊'}
        </span>
        <span className="channel-name">{currentChannel.name}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {participants.length} participant{participants.length !== 1 ? 's' : ''}
        </span>
        <div className="chat-header-actions">
          <span className="header-encrypted-badge">🔒 Encrypted P2P</span>
        </div>
      </div>

      {!isConnected ? (
        /* Join prompt */
        <div className="empty-state">
          <div className="emoji">{isVideoChannel ? '📹' : '🎙️'}</div>
          <h3>{currentChannel.name}</h3>
          <p style={{ marginBottom: '24px' }}>
            {isVideoChannel 
              ? 'Join the video call to start chatting with others'
              : 'Join the voice channel to talk with others'}
          </p>
          <button
            className="btn btn-primary"
            onClick={handleJoin}
            style={{ fontSize: '1rem', padding: '12px 32px' }}
          >
            {isVideoChannel ? '📹 Join Video Call' : '🎙️ Join Voice Channel'}
          </button>
          <p style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--accent-success)' }}>
            All voice/video is peer-to-peer encrypted (WebRTC DTLS-SRTP)
          </p>
        </div>
      ) : (
        <>
          {/* Participants grid */}
          <div className="voice-participants" style={{ flex: 1, overflow: 'auto' }}>
            {/* Local video/audio */}
            <div className="voice-participant">
              {isVideoChannel ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ transform: 'scaleX(-1)', opacity: isVideoOff ? 0.3 : 1 }}
                />
              ) : (
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  background: isMuted ? 'var(--accent-danger)' : 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2rem',
                  color: 'white',
                }}>
                  {(user?.display_name || user?.username || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="participant-name">
                {user?.display_name || user?.username} (You)
                {isMuted && ' 🔇'}
              </span>
            </div>

            {/* Remote participants */}
            {Array.from(remoteStreams).map(([userId, stream]) => (
              <RemoteParticipant
                key={userId}
                userId={userId}
                stream={stream}
                isVideo={isVideoChannel}
                participants={participants}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="voice-controls">
            <button
              className={`btn-mute ${isMuted ? 'active' : ''}`}
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🎙️'}
            </button>

            {isVideoChannel && (
              <button
                className={`btn-video ${isVideoOff ? 'active' : ''}`}
                onClick={handleToggleVideo}
                title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
              >
                {isVideoOff ? '📷' : '📹'}
              </button>
            )}

            <button
              className={`btn-screen hide-on-mobile ${isScreenSharing ? 'active' : ''}`}
              onClick={handleToggleScreenShare}
              title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
            >
              🖥️
            </button>

            <button className="btn-leave" onClick={handleLeave} title="Leave channel">
              📞
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function RemoteParticipant({
  userId,
  stream,
  isVideo,
  participants,
}: {
  userId: string
  stream: MediaStream
  isVideo: boolean
  participants: VoiceState[]
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const participant = participants.find((p) => p.user_id === userId)
  const name = participant?.user?.display_name || participant?.user?.username || 'Unknown'

  return (
    <div className="voice-participant">
      {isVideo ? (
        <video ref={videoRef} autoPlay playsInline />
      ) : (
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: 'var(--accent-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '2rem',
          color: 'white',
        }}>
          {name[0].toUpperCase()}
        </div>
      )}
      <span className="participant-name">{name}</span>
    </div>
  )
}
