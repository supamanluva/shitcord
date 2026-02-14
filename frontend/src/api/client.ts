import axios from 'axios'
import { useAuthStore } from '../stores/authStore'

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 responses by refreshing token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      const refreshToken = useAuthStore.getState().refreshToken
      if (refreshToken) {
        try {
          const response = await axios.post('/api/v1/auth/refresh', {
            refresh_token: refreshToken,
          })
          const { token, refresh_token } = response.data
          useAuthStore.getState().setTokens(token, refresh_token)
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        } catch {
          useAuthStore.getState().logout()
        }
      }
    }
    return Promise.reject(error)
  }
)

export default api

// Auth API
export const authAPI = {
  register: (data: { username: string; email: string; password: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refresh_token: refreshToken }),
}

// User API
export const userAPI = {
  getMe: () => api.get('/users/me'),
  updateMe: (data: Partial<{ display_name: string; avatar_url: string; bio: string; status: string }>) =>
    api.put('/users/me', data),
  getUser: (id: string) => api.get(`/users/${id}`),
  getMyKeys: () => api.get('/users/me/keys'),
  uploadKey: (data: { key_type: string; public_key: string; key_id: number; signature: string }) =>
    api.post('/users/me/keys', data),
  getUserKeys: (id: string) => api.get(`/users/${id}/keys`),
}

// Server API
export const serverAPI = {
  create: (data: { name: string; description?: string; is_private?: boolean }) =>
    api.post('/servers', data),
  getMyServers: () => api.get('/servers'),
  getServer: (id: string) => api.get(`/servers/${id}`),
  updateServer: (id: string, data: Partial<{ name: string; description: string; icon_url: string }>) =>
    api.put(`/servers/${id}`, data),
  deleteServer: (id: string) => api.delete(`/servers/${id}`),
  joinServer: (id: string) => api.post(`/servers/${id}/join`),
  leaveServer: (id: string) => api.post(`/servers/${id}/leave`),
  getMembers: (id: string) => api.get(`/servers/${id}/members`),
  kickMember: (serverId: string, userId: string) =>
    api.delete(`/servers/${serverId}/members/${userId}`),
  createInvite: (id: string, data?: { max_uses?: number }) =>
    api.post(`/servers/${id}/invite`, data),
  joinByInvite: (code: string) => api.post(`/servers/join/${code}`),
}

// Channel API
export const channelAPI = {
  create: (serverId: string, data: { name: string; type?: string; topic?: string }) =>
    api.post(`/servers/${serverId}/channels`, data),
  getChannels: (serverId: string) => api.get(`/servers/${serverId}/channels`),
  getChannel: (serverId: string, channelId: string) =>
    api.get(`/servers/${serverId}/channels/${channelId}`),
  updateChannel: (serverId: string, channelId: string, data: Partial<{ name: string; topic: string }>) =>
    api.put(`/servers/${serverId}/channels/${channelId}`, data),
  deleteChannel: (serverId: string, channelId: string) =>
    api.delete(`/servers/${serverId}/channels/${channelId}`),
}

// Message API
export const messageAPI = {
  getMessages: (channelId: string, params?: { limit?: number; before?: string }) =>
    api.get(`/channels/${channelId}/messages`, { params }),
  sendMessage: (channelId: string, data: { content: string; nonce?: string; encryption_header?: string; reply_to_id?: string; attachment_url?: string; type?: string }) =>
    api.post(`/channels/${channelId}/messages`, data),
  editMessage: (channelId: string, messageId: string, data: { content: string; nonce?: string; encryption_header?: string }) =>
    api.put(`/channels/${channelId}/messages/${messageId}`, data),
  deleteMessage: (channelId: string, messageId: string) =>
    api.delete(`/channels/${channelId}/messages/${messageId}`),
}

// DM API
export const dmAPI = {
  getDMChannels: () => api.get('/dms'),
  createDM: (recipientId: string) => api.post('/dms', { recipient_id: recipientId }),
}

// Upload API
export const uploadAPI = {
  uploadFile: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

// Voice API
export const voiceAPI = {
  joinVoice: (channelId: string) => api.post(`/voice/join/${channelId}`),
  leaveVoice: (channelId: string) => api.post(`/voice/leave/${channelId}`),
}

// Admin API
export const adminAPI = {
  getPendingUsers: () => api.get('/admin/pending-users'),
  getAllUsers: () => api.get('/admin/users'),
  approveUser: (id: string) => api.post(`/admin/approve/${id}`),
  rejectUser: (id: string) => api.post(`/admin/reject/${id}`),
}
