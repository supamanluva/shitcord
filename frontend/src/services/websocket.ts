/**
 * Shitcord WebSocket Service
 * 
 * Manages the real-time WebSocket connection to the backend.
 * Handles reconnection, heartbeats, and event dispatching.
 */

import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { ringToneService } from './ringtone'
import type { Message, WSMessage } from '../types'

type EventHandler = (data: unknown) => void

class WebSocketService {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private handlers: Map<string, EventHandler[]> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private isConnecting = false

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) return

    const token = useAuthStore.getState().token
    if (!token) return

    this.isConnecting = true
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws?token=${token}`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        console.log('🔌 WebSocket connected')
        this.isConnecting = false
        this.reconnectAttempts = 0
        this.startHeartbeat()
      }

      this.ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data)
          this.handleMessage(msg)
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err)
        }
      }

      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason)
        this.isConnecting = false
        this.stopHeartbeat()
        this.scheduleReconnect()
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        this.isConnecting = false
      }
    } catch (err) {
      console.error('Failed to create WebSocket:', err)
      this.isConnecting = false
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting')
      this.ws = null
    }
    this.reconnectAttempts = 0
  }

  /**
   * Send a message through the WebSocket
   */
  send(event: string, data: unknown, channelId?: string, serverId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send:', event)
      return
    }

    const msg: WSMessage = {
      event,
      data: data as unknown,
      channel_id: channelId,
      server_id: serverId,
      timestamp: Date.now(),
    }

    this.ws.send(JSON.stringify(msg))
  }

  /**
   * Subscribe to a channel for real-time updates
   */
  subscribeChannel(channelId: string): void {
    this.send('SUBSCRIBE_CHANNEL', { channel_id: channelId })
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribeChannel(channelId: string): void {
    this.send('UNSUBSCRIBE_CHANNEL', { channel_id: channelId })
  }

  /**
   * Subscribe to a server for events
   */
  subscribeServer(serverId: string): void {
    this.send('SUBSCRIBE_SERVER', { server_id: serverId })
  }

  /**
   * Send typing indicator
   */
  sendTyping(channelId: string): void {
    this.send('TYPING_START', { channel_id: channelId })
  }

  /**
   * Send WebRTC signaling data
   */
  sendWebRTCOffer(targetUserId: string, signal: unknown, channelId: string): void {
    this.send('WEBRTC_OFFER', { target_user_id: targetUserId, signal, channel_id: channelId })
  }

  sendWebRTCAnswer(targetUserId: string, signal: unknown, channelId: string): void {
    this.send('WEBRTC_ANSWER', { target_user_id: targetUserId, signal, channel_id: channelId })
  }

  sendICECandidate(targetUserId: string, signal: unknown, channelId: string): void {
    this.send('WEBRTC_ICE_CANDIDATE', { target_user_id: targetUserId, signal, channel_id: channelId })
  }

  /**
   * DM Call signaling
   */
  sendDMCallRing(targetUserId: string, dmChannelId: string, callType: string): void {
    this.send('DM_CALL_RING', { target_user_id: targetUserId, dm_channel_id: dmChannelId, call_type: callType })
  }

  sendDMCallAccept(targetUserId: string, dmChannelId: string): void {
    this.send('DM_CALL_ACCEPT', { target_user_id: targetUserId, dm_channel_id: dmChannelId })
  }

  sendDMCallReject(targetUserId: string, dmChannelId: string): void {
    this.send('DM_CALL_REJECT', { target_user_id: targetUserId, dm_channel_id: dmChannelId })
  }

  sendDMCallEnd(targetUserId: string, dmChannelId: string): void {
    this.send('DM_CALL_END', { target_user_id: targetUserId, dm_channel_id: dmChannelId })
  }

  /**
   * Register an event handler
   */
  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)
  }

  /**
   * Remove an event handler
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index !== -1) handlers.splice(index, 1)
    }
  }

  private handleMessage(msg: WSMessage): void {
    const chatStore = useChatStore.getState()

    switch (msg.event) {
      case 'READY':
        console.log('✓ WebSocket ready')
        break

      case 'HEARTBEAT_ACK':
        // Heartbeat acknowledged
        break

      case 'MESSAGE_CREATE': {
        const message = msg.data as Message
        if (message.channel_id) {
          chatStore.addMessage(message.channel_id, message)
        }
        break
      }

      case 'MESSAGE_UPDATE': {
        const message = msg.data as Message
        if (message.channel_id) {
          chatStore.updateMessage(message.channel_id, message.id, message.content)
        }
        break
      }

      case 'MESSAGE_DELETE': {
        const data = msg.data as { message_id: string; channel_id: string }
        chatStore.removeMessage(data.channel_id, data.message_id)
        break
      }

      case 'TYPING_START': {
        const data = msg.data as { user_id: string; username: string; channel_id: string }
        chatStore.addTypingUser(data.channel_id, data.user_id, data.username)
        // Auto-remove after 3 seconds
        setTimeout(() => {
          chatStore.removeTypingUser(data.channel_id, data.user_id)
        }, 3000)
        break
      }

      case 'PRESENCE_UPDATE': {
        const data = msg.data as { user_id: string; status: string }
        if (data.status === 'online') {
          chatStore.setUserOnline(data.user_id)
        } else {
          chatStore.setUserOffline(data.user_id)
        }
        break
      }

      case 'MEMBER_JOIN': {
        const data = msg.data as { server_id: string; member: import('../types').ServerMember }
        if (data.server_id && data.member) {
          // Use fresh state to avoid stale closures
          const freshState = useChatStore.getState()
          const existing = freshState.members[data.server_id] || []
          // Only add if not already present
          if (!existing.find((m) => m.user_id === data.member.user_id)) {
            freshState.setMembers(data.server_id, [...existing, data.member])
          }
          // Also add a system message in the current channel so it's visible
          const currentServer = freshState.currentServer
          const currentChannel = freshState.currentChannel
          if (currentServer && currentServer.id === data.server_id && currentChannel) {
            const username = data.member.user?.display_name || data.member.user?.username || 'Someone'
            const systemMsg: Message = {
              id: `system-join-${Date.now()}`,
              channel_id: currentChannel.id,
              author_id: 'system',
              content: `📥 **${username}** has joined the server!`,
              nonce: '',
              encryption_header: '',
              type: 'system',
              is_edited: false,
              is_pinned: false,
              author: {
                id: 'system',
                username: 'System',
                email: '',
                display_name: 'System',
                avatar_url: '',
                status: 'online',
                bio: '',
                public_key: '',
                is_approved: true,
                is_admin: false,
                created_at: new Date().toISOString(),
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
            freshState.addMessage(currentChannel.id, systemMsg)
          }
        }
        break
      }

      case 'MEMBER_LEAVE': {
        const data = msg.data as { server_id: string; user_id: string; username?: string }
        if (data.server_id) {
          const freshState = useChatStore.getState()
          const existing = freshState.members[data.server_id] || []
          freshState.setMembers(data.server_id, existing.filter((m) => m.user_id !== data.user_id))
        }
        break
      }

      case 'DM_CALL_RING': {
        const data = msg.data as { from_user_id: string; from_username: string; dm_channel_id: string; call_type: 'audio' | 'video' }
        chatStore.setIncomingCall({
          fromUserId: data.from_user_id,
          fromUsername: data.from_username,
          dmChannelId: data.dm_channel_id,
          callType: data.call_type,
        })
        // Play incoming ring tone
        ringToneService.startIncomingRing()
        break
      }

      case 'DM_CALL_ACCEPT': {
        // Remote user accepted — stop outgoing ring
        ringToneService.stopAll()
        break
      }

      case 'DM_CALL_REJECT':
      case 'DM_CALL_END': {
        ringToneService.stopAll()
        chatStore.setIncomingCall(null)
        chatStore.setActiveDMCall(null)
        break
      }

      default:
        break
    }

    // Dispatch to registered handlers
    const handlers = this.handlers.get(msg.event)
    if (handlers) {
      handlers.forEach((handler) => handler(msg.data))
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send('HEARTBEAT', {})
    }, 30000) // Every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }
}

// Singleton instance
export const wsService = new WebSocketService()
