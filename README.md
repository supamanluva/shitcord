# 💩 Shitcord

A secure, encrypted communication platform inspired by Discord. Built with a Go backend and React frontend, featuring end-to-end encryption for all messages and peer-to-peer encrypted voice/video calls.

## Features

### 💬 Text Chat
- **End-to-end encrypted messages** using AES-256-GCM
- Real-time messaging via WebSockets
- Message replies, editing, and deletion
- Typing indicators
- Message history with infinite scroll

### 🔊 Voice & Video Calls
- **Peer-to-peer encrypted** audio/video via WebRTC (DTLS-SRTP)
- Voice channels with multiple participants
- Video calls with camera toggle
- Mute/unmute controls
- Echo cancellation and noise suppression

### 🏠 Servers & Channels
- Create and manage servers (guilds)
- Text, voice, and video channels
- Role-based permissions (owner, admin, moderator, member)
- Invite system with shareable codes
- Member management and moderation

### 🔒 Security
- **E2E Encryption**: Messages encrypted client-side using Web Crypto API (AES-256-GCM + ECDH key exchange)
- **Transport Security**: All API calls over HTTPS, WebSocket over WSS
- **Voice/Video Encryption**: WebRTC DTLS-SRTP (peer-to-peer, never decrypted on server)
- **Password Security**: bcrypt with cost factor 12
- **JWT Authentication**: Short-lived access tokens + refresh tokens
- **Server-side encryption**: AES-256-GCM for data at rest
- **CORS protection** and security headers

### 👤 User System
- Registration and login
- User profiles with avatars, bios, and display names
- Online/offline/idle/DND status
- Direct messages

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   React     │────▶│   Go API     │────▶│ PostgreSQL  │
│   Frontend  │     │   (Fiber)    │     │  Database   │
│   (Vite)    │◀────│              │◀────│             │
└─────────────┘     └──────────────┘     └─────────────┘
       │                    │
       │  WebSocket         │ WebSocket Hub
       │  Connection        │ (Real-time events)
       │◀──────────────────▶│
       │
       │  WebRTC (P2P)
       │◀──────────────────▶ Other Clients
```

### Backend (Go)
- **Framework**: Fiber v2 (fast HTTP framework)
- **Database**: PostgreSQL with GORM
- **Auth**: JWT (access + refresh tokens)
- **Real-time**: WebSocket hub for events
- **WebRTC Signaling**: ICE candidate relay via WebSocket
- **Encryption**: AES-256-GCM server-side, key management for E2E

### Frontend (React + TypeScript)
- **Build Tool**: Vite
- **State Management**: Zustand
- **HTTP Client**: Axios with interceptors
- **E2E Encryption**: Web Crypto API (ECDH + AES-256-GCM)
- **Voice/Video**: WebRTC with adapter
- **Styling**: Custom CSS (dark theme)

## Getting Started

### Prerequisites
- Docker & Docker Compose
- OR: Go 1.22+, Node.js 20+, PostgreSQL 16+

### Quick Start (Docker)

```bash
# Clone the repo
git clone https://github.com/your-username/shitcord.git
cd shitcord

# Generate secure secrets
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)

# Start all services
docker compose up -d

# Open in browser
open http://localhost
```

### Development Setup

#### Backend
```bash
cd backend

# Copy environment file
cp .env.example .env
# Edit .env with your database credentials

# Install dependencies
go mod tidy

# Run the server
go run cmd/server/main.go
```

#### Frontend
```bash
cd frontend

# Install dependencies
npm install

# Start dev server (proxies API to localhost:8080)
npm run dev
```

#### Database
```bash
# Start PostgreSQL (if not using Docker)
# Create database
createdb shitcord

# The backend auto-migrates on startup
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/refresh` | Refresh token |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/me` | Get current user |
| PUT | `/api/v1/users/me` | Update profile |
| GET | `/api/v1/users/:id` | Get user profile |
| POST | `/api/v1/users/me/keys` | Upload E2E public key |
| GET | `/api/v1/users/:id/keys` | Get user's public keys |

### Servers
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/servers` | Create server |
| GET | `/api/v1/servers` | Get my servers |
| GET | `/api/v1/servers/:id` | Get server details |
| PUT | `/api/v1/servers/:id` | Update server |
| DELETE | `/api/v1/servers/:id` | Delete server |
| POST | `/api/v1/servers/:id/join` | Join server |
| POST | `/api/v1/servers/:id/leave` | Leave server |
| GET | `/api/v1/servers/:id/members` | Get members |
| POST | `/api/v1/servers/:id/invite` | Create invite |
| POST | `/api/v1/servers/join/:code` | Join by invite |

### Channels
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/servers/:id/channels` | Create channel |
| GET | `/api/v1/servers/:id/channels` | Get channels |
| PUT | `/api/v1/servers/:id/channels/:cid` | Update channel |
| DELETE | `/api/v1/servers/:id/channels/:cid` | Delete channel |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/channels/:id/messages` | Get messages |
| POST | `/api/v1/channels/:id/messages` | Send message |
| PUT | `/api/v1/channels/:id/messages/:mid` | Edit message |
| DELETE | `/api/v1/channels/:id/messages/:mid` | Delete message |

### WebSocket Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `READY` | Server → Client | Connection established |
| `MESSAGE_CREATE` | Both | New message |
| `MESSAGE_UPDATE` | Server → Client | Message edited |
| `MESSAGE_DELETE` | Server → Client | Message deleted |
| `TYPING_START` | Both | User typing |
| `PRESENCE_UPDATE` | Server → Client | User status change |
| `WEBRTC_OFFER` | Client → Client | WebRTC offer |
| `WEBRTC_ANSWER` | Client → Client | WebRTC answer |
| `WEBRTC_ICE_CANDIDATE` | Client → Client | ICE candidate |
| `HEARTBEAT` | Client → Server | Keep-alive |

## Encryption Details

### Message Encryption (E2E)
1. Each user generates an **ECDH P-256 key pair** on registration
2. Public keys are shared via the server
3. For DMs: A **shared secret** is derived via ECDH
4. For channels: A **channel key** (AES-256) is generated and distributed
5. Messages are encrypted with **AES-256-GCM** using a random 96-bit IV
6. The server only stores ciphertext — it cannot read messages

### Voice/Video Encryption
- WebRTC connections use **DTLS-SRTP** by default
- Audio/video streams are **peer-to-peer** — they never pass through the server
- The server only relays signaling data (offers, answers, ICE candidates)

## License

MIT
