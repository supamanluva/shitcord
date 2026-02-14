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
import { useMobile } from '../hooks/useMobile'

export default function MainLayout() {
  const { setServers, currentServer, currentChannel, currentDMChannel, activeDMCall, incomingCall, setCurrentChannel, setCurrentDMChannel } = useChatStore()
  const { user } = useAuthStore()
  const isMobile = useMobile()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // On mobile, show sidebar by default when no channel is selected
  // mobileView: 'sidebar' | 'chat'
  const hasActiveChat = !!(currentChannel || currentDMChannel || activeDMCall)
  const [mobileView, setMobileView] = useState<'sidebar' | 'chat'>(hasActiveChat ? 'chat' : 'sidebar')

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), [])

  // When a channel/DM is selected on mobile, switch to chat view
  useEffect(() => {
    if (isMobile && (currentChannel || currentDMChannel)) {
      setMobileView('chat')
    }
  }, [currentChannel, currentDMChannel, isMobile])

  // Mobile back: go back to sidebar view and clear selection
  const handleMobileBack = useCallback(() => {
    setMobileView('sidebar')
  }, [])

  useEffect(() => {
    const loadServers = async () => {
      try {
        const { data } = await serverAPI.getMyServers()
        setServers(data)
      } catch (err) {
        console.error('Failed to load servers:', err)
      }
    }
    loadServers()
    wsService.connect()
    return () => { wsService.disconnect() }
  }, [setServers])

  useEffect(() => {
    if (currentServer) {
      wsService.subscribeServer(currentServer.id)
    }
  }, [currentServer])

  useEffect(() => {
    if (currentChannel) {
      wsService.subscribeChannel(currentChannel.id)
      return () => { wsService.unsubscribeChannel(currentChannel.id) }
    }
  }, [currentChannel])

  useEffect(() => {
    if (currentDMChannel) {
      wsService.subscribeChannel(currentDMChannel.id)
      return () => { wsService.unsubscribeChannel(currentDMChannel.id) }
    }
  }, [currentDMChannel])

  // Non-mobile: close drawer sidebar when channel selected
  useEffect(() => {
    closeMobileSidebar()
  }, [currentChannel, currentDMChannel, closeMobileSidebar])

  const isVoiceChannel = currentChannel?.type === 'voice' || currentChannel?.type === 'video'

  // ==========================================
  // MOBILE LAYOUT: show either sidebar OR chat, never both
  // ==========================================
  if (isMobile) {
    // Sidebar view
    if (mobileView === 'sidebar' || (!currentChannel && !currentDMChannel && !activeDMCall)) {
      return (
        <div className="main-layout mobile-layout">
          <ServerList />
          {currentServer ? <ChannelSidebar /> : <DMSidebar />}
          {incomingCall && <IncomingCallModal />}
        </div>
      )
    }

    // Chat view
    return (
      <div className="main-layout mobile-layout mobile-chat-view">
        {currentServer ? (
          <>
            {currentChannel ? (
              isVoiceChannel ? (
                <VoiceChannel onMobileMenuToggle={handleMobileBack} />
              ) : (
                <ChatArea onMobileMenuToggle={handleMobileBack} />
              )
            ) : (
              <div className="chat-area">
                <div className="chat-header">
                  <button className="mobile-back-btn" onClick={handleMobileBack}>← Back</button>
                </div>
                <div className="empty-state">
                  <div className="emoji">👈</div>
                  <h3>Select a channel</h3>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {activeDMCall ? (
              <DMCallView />
            ) : currentDMChannel ? (
              <ChatArea onMobileMenuToggle={handleMobileBack} />
            ) : (
              <div className="chat-area" style={{ flex: 1 }}>
                <div className="chat-header">
                  <button className="mobile-back-btn" onClick={handleMobileBack}>← Back</button>
                </div>
                <div className="empty-state">
                  <div className="emoji">💩</div>
                  <h3>Welcome to Shitcord!</h3>
                </div>
              </div>
            )}
          </>
        )}
        {incomingCall && <IncomingCallModal />}
      </div>
    )
  }

  // ==========================================
  // DESKTOP LAYOUT: sidebar + chat side by side (existing behavior)
  // ==========================================
  return (
    <div className="main-layout">
      {mobileSidebarOpen && (
        <div className="mobile-sidebar-backdrop" onClick={closeMobileSidebar} />
      )}

      <div className={`mobile-sidebar-container ${mobileSidebarOpen ? 'open' : ''}`}>
        <ServerList />
        {currentServer ? <ChannelSidebar /> : <DMSidebar />}
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

      {incomingCall && <IncomingCallModal />}
    </div>
  )
}
