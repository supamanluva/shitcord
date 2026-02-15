import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { wsService } from '../services/websocket'
import { ringToneService } from '../services/ringtone'
import { webrtcService } from '../services/webrtc'

export default function DMCallView() {
  const { activeDMCall, setActiveDMCall, currentDMChannel } = useChatStore()
  const { user } = useAuthStore()
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isVideo = activeDMCall?.callType === 'video'

  // Ensure remote media plays on mobile when stream becomes available
  useEffect(() => {
    if (!remoteStream) return
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream
      remoteVideoRef.current.play().catch(() => {})
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream
      remoteAudioRef.current.play().catch(() => {})
    }
  }, [remoteStream])

  // Start media and WebRTC when call becomes active
  useEffect(() => {
    if (!activeDMCall) return

    const isCaller = activeDMCall.isCaller

    const startCall = async () => {
      try {
        // Get local media
        const localStream = await webrtcService.joinChannel(activeDMCall.dmChannelId, {
          audio: true,
          video: isVideo,
        })

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream
          // Explicitly play for mobile browsers
          localVideoRef.current.play().catch(() => {})
        }

        // Set remote stream handler
        webrtcService.setOnRemoteStream((_userId, stream) => {
          setRemoteStream(stream)
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream
            // Explicitly play for mobile browsers (required for unmuted media)
            remoteVideoRef.current.play().catch(() => {})
          }
          setIsConnected(true)
          // Call connected — stop any ring tone
          ringToneService.stopAll()
        })

        webrtcService.setOnPeerDisconnected(() => {
          handleEndCall()
        })

        if (isCaller) {
          // CALLER: Do NOT send an offer yet. Wait for callee to accept.
          // The offer will be sent when we receive DM_CALL_ACCEPT.
        } else {
          // CALLEE: We just accepted. Our local media is ready.
          // Process any queued offer from the caller (it arrived before we had media).
          await webrtcService.processPendingOffer()
        }

        // Start call duration timer
        timerRef.current = setInterval(() => {
          setCallDuration((d) => d + 1)
        }, 1000)
      } catch (err) {
        console.error('Failed to start call:', err)
        handleEndCall()
      }
    }

    startCall()

    // Listen for call acceptance from the WebSocket (caller side)
    const handleCallAccept = async (data: unknown) => {
      const d = data as { from_user_id: string }
      if (d.from_user_id === activeDMCall.remoteUserId) {
        // Remote user accepted — NOW send the WebRTC offer
        console.log('Call accepted, sending WebRTC offer')
        ringToneService.stopAll()
        await webrtcService.callUser(activeDMCall.remoteUserId, 'User')
      }
    }
    wsService.on('DM_CALL_ACCEPT', handleCallAccept)

    return () => {
      wsService.off('DM_CALL_ACCEPT', handleCallAccept)
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [activeDMCall?.dmChannelId])

  const handleEndCall = () => {
    ringToneService.stopAll()
    if (activeDMCall) {
      wsService.sendDMCallEnd(activeDMCall.remoteUserId, activeDMCall.dmChannelId)
    }
    webrtcService.leaveChannel()
    setActiveDMCall(null)
    setRemoteStream(null)
    setCallDuration(0)
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
  }

  const handleToggleMute = () => {
    const muted = webrtcService.toggleMute()
    setIsMuted(muted)
  }

  const handleToggleVideo = () => {
    const off = webrtcService.toggleVideo()
    setIsVideoOff(off)
  }

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      webrtcService.stopScreenShare()
      setIsScreenSharing(false)
      if (localVideoRef.current && webrtcService.getLocalStream()) {
        localVideoRef.current.srcObject = webrtcService.getLocalStream()
      }
    } else {
      try {
        const screenStream = await webrtcService.startScreenShare()
        setIsScreenSharing(true)
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = webrtcService.getLocalStream()
        }
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

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  if (!activeDMCall) return null

  // Get the other user info from the DM channel
  const otherUser = currentDMChannel
    ? (currentDMChannel.user1_id === user?.id ? currentDMChannel.user2 : currentDMChannel.user1)
    : null
  const remoteName = otherUser?.display_name || otherUser?.username || 'User'

  return (
    <div className="dm-call-view">
      <div className="dm-call-content">
        {isVideo ? (
          // Video call layout
          <div className="dm-call-video-grid">
            {/* Remote video (big) */}
            <div className="dm-call-remote">
              {remoteStream ? (
                <video ref={remoteVideoRef} autoPlay playsInline />
              ) : (
                <div className="dm-call-avatar-lg" style={{ background: stringToColor(remoteName) }}>
                  {remoteName[0].toUpperCase()}
                </div>
              )}
              <span className="dm-call-label">{remoteName}</span>
            </div>

            {/* Local video (small, picture-in-picture) */}
            <div className="dm-call-local-pip">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                style={{ transform: 'scaleX(-1)', opacity: isVideoOff ? 0.3 : 1 }}
              />
            </div>
          </div>
        ) : (
          // Audio call layout
          <div className="dm-call-audio-layout">
            <div className="dm-call-avatar-lg" style={{ background: stringToColor(remoteName) }}>
              {remoteName[0].toUpperCase()}
            </div>
            <h2>{remoteName}</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              {isConnected ? formatDuration(callDuration) : 'Connecting...'}
            </p>
          </div>
        )}
      </div>

      {/* Hidden audio element — ensures remote audio always plays, even for voice-only calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Call controls */}
      <div className="voice-controls">
        <button
          className={`btn-mute ${isMuted ? 'active' : ''}`}
          onClick={handleToggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🎙️'}
        </button>
        {isVideo && (
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
        <button className="btn-leave" onClick={handleEndCall} title="End Call">
          📞
        </button>
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
