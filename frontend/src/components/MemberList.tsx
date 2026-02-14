import { useEffect, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { serverAPI } from '../api/client'
import UserProfilePopup from './UserProfilePopup'
import type { User } from '../types'

export default function MemberList() {
  const { currentServer, members, setMembers, onlineUsers } = useChatStore()
  const [popupUser, setPopupUser] = useState<User | null>(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })

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

  if (!currentServer) return null

  const serverMembers = members[currentServer.id] || []

  const onlineMembers = serverMembers.filter(
    (m) => onlineUsers.has(m.user_id) || m.user?.status === 'online'
  )
  const offlineMembers = serverMembers.filter(
    (m) => !onlineUsers.has(m.user_id) && m.user?.status !== 'online'
  )

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner': return '👑'
      case 'admin': return '⚡'
      case 'moderator': return '🛡️'
      default: return ''
    }
  }

  const handleMemberClick = (e: React.MouseEvent, memberUser: User | undefined) => {
    if (!memberUser) return
    setPopupUser(memberUser)
    setPopupPos({ x: e.clientX - 280, y: e.clientY - 40 })
  }

  return (
    <div className="member-list">
      {/* Online */}
      <div className="member-category">
        Online — {onlineMembers.length}
      </div>
      {onlineMembers.map((member) => (
        <div
          key={member.id}
          className="member-item"
          onClick={(e) => handleMemberClick(e, member.user)}
        >
          <div className="member-avatar" style={{ background: stringToColor(member.user?.username || '') }}>
            {(member.user?.display_name || member.user?.username || '?')[0].toUpperCase()}
            <span className="status-dot online" style={{
              position: 'absolute', bottom: '-1px', right: '-1px',
              width: '10px', height: '10px', borderRadius: '50%',
              border: '2px solid var(--bg-secondary)',
            }} />
          </div>
          <div>
            <div className="member-name">
              {getRoleBadge(member.role)} {member.nickname || member.user?.display_name || member.user?.username}
            </div>
            <div className="member-role">{member.role}</div>
          </div>
        </div>
      ))}

      {/* Offline */}
      {offlineMembers.length > 0 && (
        <>
          <div className="member-category">
            Offline — {offlineMembers.length}
          </div>
          {offlineMembers.map((member) => (
            <div
              key={member.id}
              className="member-item"
              style={{ opacity: 0.5 }}
              onClick={(e) => handleMemberClick(e, member.user)}
            >
              <div className="member-avatar" style={{ background: stringToColor(member.user?.username || '') }}>
                {(member.user?.display_name || member.user?.username || '?')[0].toUpperCase()}
                <span className="status-dot offline" style={{
                  position: 'absolute', bottom: '-1px', right: '-1px',
                  width: '10px', height: '10px', borderRadius: '50%',
                  border: '2px solid var(--bg-secondary)',
                }} />
              </div>
              <div>
                <div className="member-name">
                  {getRoleBadge(member.role)} {member.nickname || member.user?.display_name || member.user?.username}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* User Profile Popup */}
      {popupUser && (
        <UserProfilePopup
          targetUser={popupUser}
          position={popupPos}
          onClose={() => setPopupUser(null)}
        />
      )}
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
