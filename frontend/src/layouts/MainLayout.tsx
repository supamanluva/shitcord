import { useEffect, useState, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import ServerList from '../components/ServerList'
import ChannelSidebar from '../components/ChannelSidebar'
import DMSidebar from '../components/DMSidebar'
import ChatArea from '../components/ChatArea'
import MemberList from '../components/MemberList'
import VoiceChannel from '../components/VoiceChannel'
import IncomingCallModal from '../components/IncomingCallModal'
import DMCallView from '../components/DMCallView'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { serverAPI } from '../api/client'
import { wsService } from '../services/websocket'

export default function MainLayout() {
  const { setServers, currentServer, currentChannel, currentDMChannel, activeDMCall, incomingCall } = useChatStore()
  const { user } = useAuthStore()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), [])

  useEffect(() => {
    // Load user's servers
    const loadServers = async () => {
      try {
        const { data } = await serverAPI.getMyServers()
        setServers(data)
      } catch (err) {
        console.error('Failed to load servers:', err)
      }
    }
    loadServers()

    // Connect WebSocket
    wsService.connect()

    return () => {
      wsService.disconnect()
    }
  }, [setServers])

  // Subscribe to current server for events
  useEffect(() => {
    if (currentServer) {
      wsService.subscribeServer(currentServer.id)
    }
  }, [currentServer])

  // Subscribe to current channel
  useEffect(() => {
    if (currentChannel) {
      wsService.subscribeChannel(currentChannel.id)
      return () => {
        wsService.unsubscribeChannel(currentChannel.id)
      }
    }
  }, [currentChannel])

  // Subscribe to DM channel for events
  useEffect(() => {
    if (currentDMChannel) {
      wsService.subscribeChannel(currentDMChannel.id)
      return () => {
        wsService.unsubscribeChannel(currentDMChannel.id)
      }
    }
  }, [currentDMChannel])

  // Close mobile sidebar when a channel or DM is selected
  useEffect(() => {
    closeMobileSidebar()
  }, [currentChannel, currentDMChannel, closeMobileSidebar])

  const isVoiceChannel = currentChannel?.type === 'voice' || currentChannel?.type === 'video'

  return (
    <div className="main-layout">
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div className="mobile-sidebar-backdrop" onClick={closeMobileSidebar} />
      )}

      <div className={`mobile-sidebar-container ${mobileSidebarOpen ? 'open' : ''}`}>
        <ServerList />
        {currentServer ? (
          <ChannelSidebar />
        ) : (
          <DMSidebar />
        )}
      </div>

      {currentServer ? (
        <>
          {currentChannel ? (
            isVoiceChannel ? (
              <VoiceChannel onMobileMenuToggle={() => setMobileSidebarOpen((v) => !v)} />
            ) : (
              <>
                <ChatArea onMobileMenuToggle={() => setMobileSidebarOpen((v) => !v)} />
                <Routes>
                  <Route path="*" element={<MemberList />} />
                </Routes>
              </>
            )
          ) : (
            <div className="chat-area">
              <div className="chat-header">
                <button className="mobile-menu-btn" onClick={() => setMobileSidebarOpen((v) => !v)}>☰</button>
              </div>
              <div className="empty-state">
                <div className="emoji">👈</div>
                <h3>Select a channel</h3>
                <p>Pick a channel from the sidebar to start chatting</p>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {activeDMCall ? (
            <DMCallView />
          ) : currentDMChannel ? (
            <ChatArea onMobileMenuToggle={() => setMobileSidebarOpen((v) => !v)} />
          ) : (
            <div className="chat-area" style={{ flex: 1 }}>
              <div className="chat-header">
                <button className="mobile-menu-btn" onClick={() => setMobileSidebarOpen((v) => !v)}>☰</button>
              </div>
              <div className="empty-state">
                <div className="emoji">💩</div>
                <h3>Welcome to Shitcord{user ? `, ${user.display_name || user.username}` : ''}!</h3>
                <p>Select a conversation or start a new one.</p>
                <p style={{ marginTop: '16px', fontSize: '0.8rem', color: 'var(--accent-success)' }}>
                  🔒 All messages are end-to-end encrypted
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Global: Incoming call modal */}
      {incomingCall && <IncomingCallModal />}
    </div>
  )
}
