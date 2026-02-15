import { useState, useEffect, useRef, useCallback, type KeyboardEvent, type ChangeEvent, type DragEvent } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { messageAPI, uploadAPI, dmAPI, serverAPI } from '../api/client'
import { wsService } from '../services/websocket'
import { ringToneService } from '../services/ringtone'
import { encryptionService } from '../services/encryption'
import type { Message } from '../types'

export default function ChatArea({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const { currentServer, currentChannel, currentDMChannel, messages, setMessages, addMessage, typingUsers, activeDMCall, setActiveDMCall, members, setMembers, onlineUsers } = useChatStore()
  const { user } = useAuthStore()
  const [messageInput, setMessageInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl?: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)

  // Determine channel ID — works for both server channels and DMs
  const channelId = currentChannel?.id || currentDMChannel?.id
  const isDM = !!currentDMChannel && !currentChannel

  // Get the other user in a DM
  const dmOtherUser = isDM
    ? (currentDMChannel!.user1_id === user?.id ? currentDMChannel!.user2 : currentDMChannel!.user1)
    : null

  // Load members when server changes
  useEffect(() => {
    if (!currentServer) return
    const loadMembers = async () => {
      try {
        const { data } = await serverAPI.getMembers(currentServer.id)
        setMembers(currentServer.id, data)
      } catch (err) {
        console.error('Failed to load members:', err)
      }
    }
    loadMembers()
  }, [currentServer, setMembers])

  // Re-fetch members when someone joins/leaves (belt-and-suspenders with WS handler)
  useEffect(() => {
    if (!currentServer) return
    const serverId = currentServer.id
    const handleMemberChange = () => {
      serverAPI.getMembers(serverId).then(({ data }) => {
        setMembers(serverId, data)
      }).catch(() => {})
    }
    wsService.on('MEMBER_JOIN', handleMemberChange)
    wsService.on('MEMBER_LEAVE', handleMemberChange)
    return () => {
      wsService.off('MEMBER_JOIN', handleMemberChange)
      wsService.off('MEMBER_LEAVE', handleMemberChange)
    }
  }, [currentServer, setMembers])

  // Load messages when channel changes
  useEffect(() => {
    if (!channelId) return

    const loadMessages = async () => {
      setLoading(true)
      try {
        const { data } = await messageAPI.getMessages(channelId, { limit: 50 })
        setMessages(channelId, data)
      } catch (err) {
        console.error('Failed to load messages:', err)
      } finally {
        setLoading(false)
      }
    }

    loadMessages()
  }, [channelId, setMessages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages[channelId || '']])

  // Listen for new messages via WebSocket
  useEffect(() => {
    if (!channelId) return

    const handler = (data: unknown) => {
      const msg = data as Message
      if (msg.channel_id === channelId && msg.author_id !== user?.id) {
        addMessage(channelId, msg)
      }
    }

    wsService.on('MESSAGE_CREATE', handler)
    return () => wsService.off('MESSAGE_CREATE', handler)
  }, [channelId, user?.id, addMessage])

  const handleSendMessage = useCallback(async () => {
    if ((!messageInput.trim() && !pendingFile) || !channelId || sending) return

    setSending(true)
    const content = messageInput.trim()
    setMessageInput('')
    setReplyTo(null)

    try {
      let attachmentUrl: string | undefined
      let msgType: string | undefined

      // Upload file if pending
      if (pendingFile) {
        setUploading(true)
        try {
          const { data: uploadData } = await uploadAPI.uploadFile(pendingFile.file)
          attachmentUrl = uploadData.url
          msgType = uploadData.type // image, video, audio, file
        } catch (err) {
          console.error('Failed to upload file:', err)
          setMessageInput(content)
          setSending(false)
          setUploading(false)
          return
        }
        setUploading(false)
        setPendingFile(null)
      }

      // Encrypt message content (or use placeholder for file-only)
      const textToSend = content || (pendingFile ? `[File: ${pendingFile.file.name}]` : '')
      const encrypted = await encryptionService.encryptMessage(textToSend, channelId)

      const { data } = await messageAPI.sendMessage(channelId, {
        content: encrypted.ciphertext,
        nonce: encrypted.nonce,
        encryption_header: encrypted.header,
        reply_to_id: replyTo?.id,
        attachment_url: attachmentUrl,
        type: msgType,
      })

      addMessage(channelId, data)
    } catch (err) {
      console.error('Failed to send message:', err)
      setMessageInput(content)
    } finally {
      setSending(false)
    }
  }, [messageInput, channelId, sending, replyTo, pendingFile, addMessage])

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      alert('File too large. Maximum size is 50MB.')
      return
    }
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    setPendingFile({ file, previewUrl })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      alert('File too large. Maximum size is 50MB.')
      return
    }
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    setPendingFile({ file, previewUrl })
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleDMCall = (callType: 'audio' | 'video') => {
    if (!currentDMChannel || !dmOtherUser) return
    wsService.sendDMCallRing(dmOtherUser.id, currentDMChannel.id, callType)
    useChatStore.getState().setActiveDMCall({
      dmChannelId: currentDMChannel.id,
      remoteUserId: dmOtherUser.id,
      callType,
      isCaller: true,
    })
    // Start outgoing ring tone so caller knows it's ringing
    ringToneService.startOutgoingRing()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }

    // Send typing indicator (throttled)
    if (channelId && !typingTimeoutRef.current) {
      wsService.sendTyping(channelId)
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null
      }, 3000)
    }
  }

  const channelMessages = messages[channelId || ''] || []
  const channelTyping = typingUsers[channelId || ''] || []

  if (!currentChannel && !currentDMChannel) return null

  const headerName = isDM
    ? (dmOtherUser?.display_name || dmOtherUser?.username || 'User')
    : currentChannel!.name

  return (
    <div
      className={`chat-area ${dragOver ? 'drag-over' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Drag overlay */}
      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <div style={{ fontSize: '3rem' }}>📎</div>
            <h3>Drop file to upload</h3>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="chat-header">
        <button className="mobile-back-btn" onClick={onMobileMenuToggle}>←</button>
        <button className="mobile-menu-btn" onClick={onMobileMenuToggle}>☰</button>
        {isDM ? (
          <>
            <div className="dm-header-avatar" style={{ background: stringToColor(dmOtherUser?.username || '') }}>
              {(dmOtherUser?.display_name || dmOtherUser?.username || '?')[0].toUpperCase()}
            </div>
            <span className="channel-name truncate">{headerName}</span>
            <div className="chat-header-actions">
              <button
                onClick={() => handleDMCall('audio')}
                title="Voice Call"
                className="header-call-btn"
              >
                📞
              </button>
              <button
                onClick={() => handleDMCall('video')}
                title="Video Call"
                className="header-call-btn"
              >
                📹
              </button>
              <span className="header-encrypted-badge">🔒</span>
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize: '1.2rem', opacity: 0.6 }}>#</span>
            <span className="channel-name truncate">{currentChannel!.name}</span>
            {currentChannel!.topic && (
              <>
                <span style={{ color: 'var(--border-light)' }}>|</span>
                <span className="channel-topic">{currentChannel!.topic}</span>
              </>
            )}
            <div className="chat-header-actions">
              <button
                className="header-members-btn"
                onClick={() => setShowMembers((v) => !v)}
                title="Members"
              >
                👥 {currentServer && members[currentServer.id] ? members[currentServer.id].length : ''}
              </button>
              <span className="header-encrypted-badge">🔒 Encrypted</span>
            </div>
          </>
        )}
      </div>

      {/* Mobile Members Panel */}
      {showMembers && currentServer && (
        <MembersPanel
          serverId={currentServer.id}
          members={members[currentServer.id] || []}
          onlineUsers={onlineUsers}
          onClose={() => setShowMembers(false)}
        />
      )}

      {/* Messages */}
      <div className="messages-container" ref={messagesContainerRef}>
        <div className="messages-list">
          {loading ? (
            <div className="empty-state">
              <p>Loading messages...</p>
            </div>
          ) : channelMessages.length === 0 ? (
            <div className="empty-state">
              <div className="emoji">💬</div>
              <h3>{isDM ? `Start chatting with ${headerName}!` : `Welcome to #${currentChannel?.name}!`}</h3>
              <p>{isDM ? 'Send a message to get the conversation started.' : 'This is the beginning of the channel. Send a message to get started.'}</p>
            </div>
          ) : (
            channelMessages.map((msg, i) => {
              const prevMsg = i > 0 ? channelMessages[i - 1] : null
              const isGrouped = prevMsg?.author_id === msg.author_id &&
                new Date(msg.created_at).getTime() - new Date(prevMsg!.created_at).getTime() < 300000

              return (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  isGrouped={isGrouped}
                  channelId={channelId!}
                  isOwnMessage={msg.author_id === user?.id}
                  onReply={() => setReplyTo(msg)}
                />
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Typing Indicator */}
      <div className="typing-indicator">
        {channelTyping.length > 0 && (
          <>
            <div className="typing-dots">
              <span /><span /><span />
            </div>
            <span>
              {channelTyping.map((t) => t.username).join(', ')}
              {channelTyping.length === 1 ? ' is' : ' are'} typing...
            </span>
          </>
        )}
      </div>

      {/* Reply indicator */}
      {replyTo && (
        <div style={{
          padding: '8px 16px',
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.85rem',
        }}>
          <span style={{ color: 'var(--text-muted)' }}>Replying to</span>
          <span style={{ fontWeight: 600 }}>{replyTo.author?.display_name || replyTo.author?.username}</span>
          <span style={{ color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {replyTo.content.substring(0, 100)}
          </span>
          <button onClick={() => setReplyTo(null)} style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>
      )}

      {/* Pending file preview */}
      {pendingFile && (
        <div className="pending-file-preview">
          {pendingFile.previewUrl ? (
            <img src={pendingFile.previewUrl} alt="preview" className="file-preview-img" />
          ) : (
            <div className="file-preview-icon">📄</div>
          )}
          <div className="file-preview-info">
            <span className="file-preview-name truncate">{pendingFile.file.name}</span>
            <span className="file-preview-size">{formatFileSize(pendingFile.file.size)}</span>
          </div>
          <button onClick={() => setPendingFile(null)} className="file-preview-remove">✕</button>
        </div>
      )}

      {/* Message Input */}
      <div className="message-input-container">
        <div className="message-input-wrapper">
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
          >
            📎
          </button>
          <textarea
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isDM ? `Message @${headerName}` : `Message #${currentChannel?.name}`}
            rows={1}
          />
          <button
            className="send-btn"
            onClick={handleSendMessage}
            disabled={(!messageInput.trim() && !pendingFile) || sending || uploading}
          >
            {uploading ? '⏳' : '➤'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageItem({
  message,
  isGrouped,
  channelId,
  isOwnMessage,
  onReply,
}: {
  message: Message
  isGrouped: boolean
  channelId: string
  isOwnMessage: boolean
  onReply: () => void
}) {
  const [decryptedContent, setDecryptedContent] = useState(message.content)
  const [showActions, setShowActions] = useState(false)
  const { removeMessage } = useChatStore()

  // Decrypt message content
  useEffect(() => {
    const decrypt = async () => {
      if (message.encryption_header && message.encryption_header !== 'plaintext') {
        const content = await encryptionService.decryptMessage(
          {
            ciphertext: message.content,
            nonce: message.nonce,
            header: message.encryption_header,
          },
          channelId
        )
        setDecryptedContent(content)
      } else if (message.encryption_header === 'plaintext') {
        try {
          setDecryptedContent(decodeURIComponent(atob(message.content)))
        } catch {
          setDecryptedContent(message.content)
        }
      }
    }
    decrypt()
  }, [message, channelId])

  const handleDelete = async () => {
    try {
      await messageAPI.deleteMessage(channelId, message.id)
      removeMessage(channelId, message.id)
    } catch (err) {
      console.error('Failed to delete message:', err)
    }
  }

  const timestamp = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  const fullDate = new Date(message.created_at).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const authorColor = stringToColor(message.author?.username || '')

  // System messages (e.g. member join/leave) render as simple inline text
  if (message.type === 'system' || message.author_id === 'system') {
    return (
      <div className="message system-message">
        <div className="system-message-content">
          <span className="system-message-text">{message.content}</span>
          <span className="timestamp" title={fullDate}>{timestamp}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`message ${isGrouped ? 'grouped' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {!isGrouped && (
        <div className="message-avatar" style={{ background: authorColor }}>
          {(message.author?.display_name || message.author?.username || '?')[0].toUpperCase()}
        </div>
      )}

      <div className="message-content">
        {!isGrouped && (
          <div className="message-header">
            <span className="author" style={{ color: authorColor }}>
              {message.author?.display_name || message.author?.username}
            </span>
            <span className="timestamp" title={fullDate}>{timestamp}</span>
            {message.is_edited && <span className="edited">(edited)</span>}
          </div>
        )}

        {/* Reply reference */}
        {message.reply_to && (
          <div style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            padding: '4px 8px',
            borderLeft: '2px solid var(--accent-primary)',
            marginBottom: '4px',
          }}>
            <span style={{ fontWeight: 600 }}>{message.reply_to.author?.username}</span>{' '}
            {message.reply_to.content.substring(0, 80)}
            {message.reply_to.content.length > 80 && '...'}
          </div>
        )}

        <div className="message-body">
          {decryptedContent}
          {message.encryption_header && message.encryption_header !== 'plaintext' && (
            <span className="encrypted-badge">🔒</span>
          )}
        </div>

        {/* Attachment rendering */}
        {message.attachment_url && (
          <AttachmentRender url={message.attachment_url} type={message.type} />
        )}
      </div>

      {/* Message actions */}
      {showActions && (
        <div style={{
          position: 'absolute',
          right: '16px',
          top: '-12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          padding: '2px',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <button
            onClick={onReply}
            style={{ padding: '6px 8px', fontSize: '0.85rem', borderRadius: 'var(--radius-sm)' }}
            title="Reply"
          >
            ↩
          </button>
          {isOwnMessage && (
            <button
              onClick={handleDelete}
              style={{ padding: '6px 8px', fontSize: '0.85rem', color: 'var(--accent-danger)', borderRadius: 'var(--radius-sm)' }}
              title="Delete"
            >
              🗑
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Render file attachments inline
function AttachmentRender({ url, type }: { url: string; type: string }) {
  if (type === 'image') {
    return (
      <div className="attachment-image">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt="attachment" loading="lazy" />
        </a>
      </div>
    )
  }

  if (type === 'video') {
    return (
      <div className="attachment-video">
        <video src={url} controls preload="metadata" />
      </div>
    )
  }

  if (type === 'audio') {
    return (
      <div className="attachment-audio">
        <audio src={url} controls preload="metadata" />
      </div>
    )
  }

  // Generic file download
  const filename = url.split('/').pop() || 'file'
  return (
    <div className="attachment-file">
      <span className="attachment-file-icon">📄</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="attachment-file-name">
        {filename}
      </a>
      <a href={url} download className="attachment-download">⬇</a>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Members panel overlay
function MembersPanel({ serverId, members, onlineUsers, onClose }: {
  serverId: string
  members: { id: string; user_id: string; role: string; nickname: string; user?: { username: string; display_name: string; status?: string } }[]
  onlineUsers: Set<string>
  onClose: () => void
}) {
  const online = members.filter(m => onlineUsers.has(m.user_id))
  const offline = members.filter(m => !onlineUsers.has(m.user_id))

  const roleBadge = (role: string) => {
    switch (role) {
      case 'owner': return '👑 '
      case 'admin': return '⚡ '
      case 'moderator': return '🛡️ '
      default: return ''
    }
  }

  return (
    <div className="members-panel-overlay" onClick={onClose}>
      <div className="members-panel" onClick={e => e.stopPropagation()}>
        <div className="members-panel-header">
          <span>Members — {members.length}</span>
          <button onClick={onClose} style={{ fontSize: '1.2rem', padding: '4px 8px' }}>✕</button>
        </div>
        <div className="members-panel-list">
          {online.length > 0 && (
            <>
              <div className="members-panel-category">Online — {online.length}</div>
              {online.map(m => (
                <div key={m.id} className="members-panel-item">
                  <div className="members-panel-avatar" style={{ background: stringToColor(m.user?.username || '') }}>
                    {(m.user?.display_name || m.user?.username || '?')[0].toUpperCase()}
                    <span className="members-panel-status online" />
                  </div>
                  <span className="truncate">{roleBadge(m.role)}{m.nickname || m.user?.display_name || m.user?.username}</span>
                </div>
              ))}
            </>
          )}
          {offline.length > 0 && (
            <>
              <div className="members-panel-category">Offline — {offline.length}</div>
              {offline.map(m => (
                <div key={m.id} className="members-panel-item" style={{ opacity: 0.5 }}>
                  <div className="members-panel-avatar" style={{ background: stringToColor(m.user?.username || '') }}>
                    {(m.user?.display_name || m.user?.username || '?')[0].toUpperCase()}
                    <span className="members-panel-status offline" />
                  </div>
                  <span className="truncate">{roleBadge(m.role)}{m.nickname || m.user?.display_name || m.user?.username}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Generate a consistent color from a string
function stringToColor(str: string): string {
  const colors = [
    '#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245',
    '#f47b67', '#e78df5', '#45b3e0', '#3ba55c', '#f0b232',
    '#e67e22', '#9b59b6', '#1abc9c', '#e74c3c', '#3498db',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}
