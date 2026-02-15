/**
 * Shitcord WebRTC Service
 * 
 * Manages peer-to-peer audio/video connections for voice and video calls.
 * Uses the WebSocket service for signaling (offer/answer/ICE exchange).
 */

import { wsService } from './websocket'
import { useAuthStore } from '../stores/authStore'

export interface PeerConnection {
  userId: string
  username: string
  connection: RTCPeerConnection
  localStream?: MediaStream
  remoteStream?: MediaStream
}

type StreamHandler = (userId: string, stream: MediaStream) => void

class WebRTCService {
  private peers: Map<string, PeerConnection> = new Map()
  private localStream: MediaStream | null = null
  private channelId: string | null = null
  private onRemoteStream: StreamHandler | null = null
  private onPeerDisconnected: ((userId: string) => void) | null = null

  // Queue ICE candidates that arrive before remote description is set
  private pendingICECandidates: Map<string, RTCIceCandidateInit[]> = new Map()

  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]

  constructor() {
    // Listen for WebRTC signaling events
    wsService.on('WEBRTC_OFFER', this.handleOffer.bind(this))
    wsService.on('WEBRTC_ANSWER', this.handleAnswer.bind(this))
    wsService.on('WEBRTC_ICE_CANDIDATE', this.handleICECandidate.bind(this))
    wsService.on('VOICE_STATE_LEAVE', this.handlePeerLeave.bind(this))

    // Fetch ICE server config (TURN/STUN) from backend
    this.fetchICEServers()
  }

  /**
   * Fetch ICE servers (STUN + TURN) from the backend API
   */
  private async fetchICEServers(): Promise<void> {
    try {
      const token = useAuthStore.getState().token
      if (!token) return
      const resp = await fetch('/api/v1/voice/ice-servers', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.ice_servers && data.ice_servers.length > 0) {
          this.iceServers = data.ice_servers
          console.log('✓ ICE servers loaded from backend:', this.iceServers.length, 'servers')
        }
      }
    } catch (err) {
      console.warn('Could not fetch ICE servers from backend, using defaults:', err)
    }
  }

  /**
   * Set callback for when a remote stream is received
   */
  setOnRemoteStream(handler: StreamHandler): void {
    this.onRemoteStream = handler
  }

  /**
   * Set callback for when a peer disconnects
   */
  setOnPeerDisconnected(handler: (userId: string) => void): void {
    this.onPeerDisconnected = handler
  }

  /**
   * Join a voice/video channel
   */
  async joinChannel(channelId: string, options: { audio: boolean; video: boolean }): Promise<MediaStream> {
    this.channelId = channelId

    // Refresh ICE server config (TURN credentials may be time-limited)
    await this.fetchICEServers()

    // Get local media stream
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: options.audio ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } : false,
      video: options.video ? {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      } : false,
    })

    return this.localStream
  }

  /**
   * Create a peer connection and send an offer to a user
   */
  async callUser(userId: string, username: string): Promise<void> {
    if (!this.localStream || !this.channelId) return

    const pc = this.createPeerConnection(userId, username)
    
    // Add local tracks
    this.localStream.getTracks().forEach((track) => {
      pc.connection.addTrack(track, this.localStream!)
    })

    // Create and send offer
    const offer = await pc.connection.createOffer()
    await pc.connection.setLocalDescription(offer)

    wsService.sendWebRTCOffer(userId, {
      type: offer.type,
      sdp: offer.sdp,
    }, this.channelId)
  }

  /**
   * Leave the current voice/video channel
   */
  leaveChannel(): void {
    // Close all peer connections
    this.peers.forEach((peer) => {
      peer.connection.close()
    })
    this.peers.clear()
    this.pendingICECandidates.clear()
    this.pendingOffer = null

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }

    this.channelId = null
  }

  /**
   * Toggle audio mute
   */
  toggleMute(): boolean {
    if (!this.localStream) return false
    const audioTrack = this.localStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      return !audioTrack.enabled // return true if muted
    }
    return false
  }

  /**
   * Toggle video
   */
  toggleVideo(): boolean {
    if (!this.localStream) return false
    const videoTrack = this.localStream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      return !videoTrack.enabled // return true if video off
    }
    return false
  }

  private screenStream: MediaStream | null = null
  private originalVideoTrack: MediaStreamTrack | null = null

  /**
   * Start screen sharing — replaces camera video track with screen capture
   * on all active peer connections.
   */
  async startScreenShare(): Promise<MediaStream> {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' } as MediaTrackConstraints,
      audio: false,
    })

    this.screenStream = screenStream
    const screenTrack = screenStream.getVideoTracks()[0]

    // Save the original camera track so we can restore it later
    if (this.localStream) {
      this.originalVideoTrack = this.localStream.getVideoTracks()[0] || null
    }

    // Replace the video track on every peer connection
    this.peers.forEach((peer) => {
      const sender = peer.connection.getSenders().find((s) => s.track?.kind === 'video')
      if (sender) {
        sender.replaceTrack(screenTrack)
      } else {
        // No video sender yet (audio-only call) — add the screen track
        peer.connection.addTrack(screenTrack, screenStream)
      }
    })

    // Also put the screen track into localStream so the local preview updates
    if (this.localStream && this.originalVideoTrack) {
      this.localStream.removeTrack(this.originalVideoTrack)
      this.localStream.addTrack(screenTrack)
    }

    // When the user clicks the browser's "Stop sharing" button, revert automatically
    screenTrack.onended = () => {
      this.stopScreenShare()
    }

    return screenStream
  }

  /**
   * Stop screen sharing — reverts to the original camera track.
   * Returns true if screen share was active and stopped.
   */
  stopScreenShare(): boolean {
    if (!this.screenStream) return false

    const screenTrack = this.screenStream.getVideoTracks()[0]
    screenTrack?.stop()

    // Restore the original camera track on all peers
    if (this.originalVideoTrack) {
      this.peers.forEach((peer) => {
        const sender = peer.connection.getSenders().find((s) => s.track?.kind === 'video' || s.track === screenTrack)
        if (sender) {
          sender.replaceTrack(this.originalVideoTrack!)
        }
      })

      // Restore in localStream
      if (this.localStream) {
        const currentScreen = this.localStream.getVideoTracks()[0]
        if (currentScreen) this.localStream.removeTrack(currentScreen)
        this.localStream.addTrack(this.originalVideoTrack)
      }
    }

    this.screenStream = null
    this.originalVideoTrack = null
    return true
  }

  /**
   * Check if screen sharing is active
   */
  isScreenSharing(): boolean {
    return this.screenStream !== null
  }

  /**
   * Get the local media stream
   */
  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  /**
   * Get all peer connections
   */
  getPeers(): Map<string, PeerConnection> {
    return this.peers
  }

  private createPeerConnection(userId: string, username: string): PeerConnection {
    const connection = new RTCPeerConnection({
      iceServers: this.iceServers,
    })

    const peer: PeerConnection = {
      userId,
      username,
      connection,
    }

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate && this.channelId) {
        wsService.sendICECandidate(userId, {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }, this.channelId)
      }
    }

    // Handle remote stream
    connection.ontrack = (event) => {
      const remoteStream = event.streams[0]
      peer.remoteStream = remoteStream
      if (this.onRemoteStream) {
        this.onRemoteStream(userId, remoteStream)
      }
    }

    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'disconnected' || 
          connection.connectionState === 'failed') {
        this.removePeer(userId)
      }
    }

    this.peers.set(userId, peer)
    return peer
  }

  private pendingOffer: {
    from_user_id: string
    from_username: string
    signal: RTCSessionDescriptionInit
    channel_id: string
  } | null = null

  private async handleOffer(data: unknown): Promise<void> {
    const { from_user_id, from_username, signal, channel_id } = data as {
      from_user_id: string
      from_username: string
      signal: RTCSessionDescriptionInit
      channel_id: string
    }

    // If we don't have local media yet (callee hasn't finished getUserMedia),
    // queue the offer so it can be processed once media is ready.
    if (!this.localStream) {
      console.log('WebRTC: Queuing offer from', from_username, '(no local stream yet)')
      this.pendingOffer = { from_user_id, from_username, signal, channel_id }
      return
    }

    await this.processOffer(from_user_id, from_username, signal, channel_id)
  }

  /**
   * Process a WebRTC offer (called directly or after dequeuing)
   */
  private async processOffer(
    from_user_id: string,
    from_username: string,
    signal: RTCSessionDescriptionInit,
    channel_id: string,
  ): Promise<void> {
    if (!this.localStream) return

    this.channelId = channel_id
    const pc = this.createPeerConnection(from_user_id, from_username)

    // Add local tracks
    this.localStream.getTracks().forEach((track) => {
      pc.connection.addTrack(track, this.localStream!)
    })

    // Set remote description and create answer
    await pc.connection.setRemoteDescription(new RTCSessionDescription(signal))

    // Flush any ICE candidates that arrived before remote description was set
    await this.flushPendingICECandidates(from_user_id)

    const answer = await pc.connection.createAnswer()
    await pc.connection.setLocalDescription(answer)

    wsService.sendWebRTCAnswer(from_user_id, {
      type: answer.type,
      sdp: answer.sdp,
    }, channel_id)
  }

  /**
   * Process a queued offer (called after local media is ready on the callee side)
   */
  async processPendingOffer(): Promise<void> {
    if (!this.pendingOffer) return
    const { from_user_id, from_username, signal, channel_id } = this.pendingOffer
    this.pendingOffer = null
    console.log('WebRTC: Processing queued offer from', from_username)
    await this.processOffer(from_user_id, from_username, signal, channel_id)
  }

  private async handleAnswer(data: unknown): Promise<void> {
    const { from_user_id, signal } = data as {
      from_user_id: string
      signal: RTCSessionDescriptionInit
    }

    const peer = this.peers.get(from_user_id)
    if (peer) {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(signal))
      // Flush any ICE candidates that arrived before remote description was set
      await this.flushPendingICECandidates(from_user_id)
    }
  }

  private async handleICECandidate(data: unknown): Promise<void> {
    const { from_user_id, signal } = data as {
      from_user_id: string
      signal: RTCIceCandidateInit
    }

    const peer = this.peers.get(from_user_id)
    if (peer && peer.connection.remoteDescription) {
      // Remote description already set — apply immediately
      await peer.connection.addIceCandidate(new RTCIceCandidate(signal))
    } else {
      // Queue the candidate until remote description is set
      if (!this.pendingICECandidates.has(from_user_id)) {
        this.pendingICECandidates.set(from_user_id, [])
      }
      this.pendingICECandidates.get(from_user_id)!.push(signal)
    }
  }

  /**
   * Flush queued ICE candidates for a peer after remote description is set
   */
  private async flushPendingICECandidates(userId: string): Promise<void> {
    const candidates = this.pendingICECandidates.get(userId)
    if (!candidates || candidates.length === 0) return

    const peer = this.peers.get(userId)
    if (!peer) return

    console.log(`WebRTC: Flushing ${candidates.length} queued ICE candidates for ${userId}`)
    for (const candidate of candidates) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (err) {
        console.warn('Failed to add queued ICE candidate:', err)
      }
    }
    this.pendingICECandidates.delete(userId)
  }

  private handlePeerLeave(data: unknown): void {
    const { user_id } = data as { user_id: string }
    this.removePeer(user_id)
  }

  private removePeer(userId: string): void {
    const peer = this.peers.get(userId)
    if (peer) {
      peer.connection.close()
      this.peers.delete(userId)
      if (this.onPeerDisconnected) {
        this.onPeerDisconnected(userId)
      }
    }
  }
}

// Singleton instance
export const webrtcService = new WebRTCService()
