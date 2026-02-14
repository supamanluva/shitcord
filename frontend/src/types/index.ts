// Core types for Shitcord

export interface User {
  id: string
  username: string
  email: string
  display_name: string
  avatar_url: string
  status: 'online' | 'offline' | 'idle' | 'dnd'
  bio: string
  public_key: string
  is_approved: boolean
  is_admin: boolean
  created_at: string
}

export interface Server {
  id: string
  name: string
  description: string
  icon_url: string
  owner_id: string
  invite_code: string
  is_private: boolean
  channels: Channel[]
  owner?: User
  created_at: string
}

export interface ServerMember {
  id: string
  server_id: string
  user_id: string
  role: 'owner' | 'admin' | 'moderator' | 'member'
  nickname: string
  joined_at: string
  user?: User
}

export interface Channel {
  id: string
  server_id: string
  name: string
  topic: string
  type: 'text' | 'voice' | 'video'
  position: number
  is_private: boolean
  created_at: string
}

export interface Message {
  id: string
  channel_id: string
  author_id: string
  content: string
  nonce: string
  encryption_header: string
  type: 'text' | 'image' | 'file' | 'system'
  attachment_url?: string
  reply_to_id?: string
  is_edited: boolean
  is_pinned: boolean
  author: User
  reply_to?: Message
  created_at: string
  updated_at: string
}

export interface DMChannel {
  id: string
  user1_id: string
  user2_id: string
  user1: User
  user2: User
  created_at: string
}

export interface VoiceState {
  id: string
  user_id: string
  channel_id: string
  server_id: string
  is_muted: boolean
  is_deafened: boolean
  is_streaming: boolean
  user?: User
}

export interface Invite {
  id: string
  code: string
  server_id: string
  creator_id: string
  max_uses: number
  uses: number
  expires_at?: string
  server?: Server
}

// WebSocket event types
export interface WSMessage {
  event: string
  data: unknown
  channel_id?: string
  server_id?: string
  timestamp: number
}

// Encryption key types
export interface UserPublicKey {
  id: string
  user_id: string
  key_type: 'identity' | 'signed_prekey' | 'one_time_prekey'
  public_key: string
  key_id: number
  signature: string
  is_active: boolean
}
