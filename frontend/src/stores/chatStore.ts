import { create } from 'zustand'
import type { Server, Channel, Message, ServerMember, DMChannel, User } from '../types'

export interface IncomingCall {
  fromUserId: string
  fromUsername: string
  dmChannelId: string
  callType: 'audio' | 'video'
}

interface ChatState {
  // Servers
  servers: Server[]
  currentServer: Server | null
  setServers: (servers: Server[]) => void
  addServer: (server: Server) => void
  setCurrentServer: (server: Server | null) => void
  removeServer: (id: string) => void

  // Channels
  currentChannel: Channel | null
  setCurrentChannel: (channel: Channel | null) => void

  // DM Channels
  dmChannels: DMChannel[]
  currentDMChannel: DMChannel | null
  setDMChannels: (dms: DMChannel[]) => void
  addDMChannel: (dm: DMChannel) => void
  setCurrentDMChannel: (dm: DMChannel | null) => void

  // Incoming call
  incomingCall: IncomingCall | null
  setIncomingCall: (call: IncomingCall | null) => void

  // Active DM call
  activeDMCall: { dmChannelId: string; remoteUserId: string; callType: 'audio' | 'video' } | null
  setActiveDMCall: (call: { dmChannelId: string; remoteUserId: string; callType: 'audio' | 'video' } | null) => void

  // Messages
  messages: Record<string, Message[]>  // channelId -> messages
  addMessage: (channelId: string, message: Message) => void
  setMessages: (channelId: string, messages: Message[]) => void
  updateMessage: (channelId: string, messageId: string, content: string) => void
  removeMessage: (channelId: string, messageId: string) => void
  prependMessages: (channelId: string, messages: Message[]) => void

  // Members
  members: Record<string, ServerMember[]>  // serverId -> members
  setMembers: (serverId: string, members: ServerMember[]) => void

  // Typing indicators
  typingUsers: Record<string, { userId: string; username: string; timestamp: number }[]>
  addTypingUser: (channelId: string, userId: string, username: string) => void
  removeTypingUser: (channelId: string, userId: string) => void

  // Online users
  onlineUsers: Set<string>
  setUserOnline: (userId: string) => void
  setUserOffline: (userId: string) => void
}

export const useChatStore = create<ChatState>((set) => ({
  servers: [],
  currentServer: null,
  setServers: (servers) => set({ servers }),
  addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
  setCurrentServer: (server) => set({ currentServer: server }),
  removeServer: (id) => set((s) => ({ servers: s.servers.filter((srv) => srv.id !== id) })),

  currentChannel: null,
  setCurrentChannel: (channel) => set({ currentChannel: channel }),

  dmChannels: [],
  currentDMChannel: null,
  setDMChannels: (dms) => set({ dmChannels: dms }),
  addDMChannel: (dm) => set((s) => {
    const exists = s.dmChannels.find((d) => d.id === dm.id)
    if (exists) return { dmChannels: s.dmChannels }
    return { dmChannels: [dm, ...s.dmChannels] }
  }),
  setCurrentDMChannel: (dm) => set({ currentDMChannel: dm, currentServer: null, currentChannel: null }),

  incomingCall: null,
  setIncomingCall: (call) => set({ incomingCall: call }),

  activeDMCall: null,
  setActiveDMCall: (call) => set({ activeDMCall: call }),

  messages: {},
  addMessage: (channelId, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: [...(s.messages[channelId] || []), message],
      },
    })),
  setMessages: (channelId, messages) =>
    set((s) => ({
      messages: { ...s.messages, [channelId]: messages },
    })),
  updateMessage: (channelId, messageId, content) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] || []).map((m) =>
          m.id === messageId ? { ...m, content, is_edited: true } : m
        ),
      },
    })),
  removeMessage: (channelId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: (s.messages[channelId] || []).filter((m) => m.id !== messageId),
      },
    })),
  prependMessages: (channelId, messages) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: [...messages, ...(s.messages[channelId] || [])],
      },
    })),

  members: {},
  setMembers: (serverId, members) =>
    set((s) => ({ members: { ...s.members, [serverId]: members } })),

  typingUsers: {},
  addTypingUser: (channelId, userId, username) =>
    set((s) => {
      const current = s.typingUsers[channelId] || []
      const filtered = current.filter((t) => t.userId !== userId)
      return {
        typingUsers: {
          ...s.typingUsers,
          [channelId]: [...filtered, { userId, username, timestamp: Date.now() }],
        },
      }
    }),
  removeTypingUser: (channelId, userId) =>
    set((s) => ({
      typingUsers: {
        ...s.typingUsers,
        [channelId]: (s.typingUsers[channelId] || []).filter((t) => t.userId !== userId),
      },
    })),

  onlineUsers: new Set(),
  setUserOnline: (userId) =>
    set((s) => {
      const newSet = new Set(s.onlineUsers)
      newSet.add(userId)
      return { onlineUsers: newSet }
    }),
  setUserOffline: (userId) =>
    set((s) => {
      const newSet = new Set(s.onlineUsers)
      newSet.delete(userId)
      return { onlineUsers: newSet }
    }),
}))
