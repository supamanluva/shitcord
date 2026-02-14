package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// Event types for WebSocket messages
const (
	EventMessage       = "MESSAGE_CREATE"
	EventMessageEdit   = "MESSAGE_UPDATE"
	EventMessageDelete = "MESSAGE_DELETE"
	EventTyping        = "TYPING_START"
	EventPresence      = "PRESENCE_UPDATE"
	EventVoiceJoin     = "VOICE_STATE_JOIN"
	EventVoiceLeave    = "VOICE_STATE_LEAVE"
	EventWebRTCOffer   = "WEBRTC_OFFER"
	EventWebRTCAnswer  = "WEBRTC_ANSWER"
	EventWebRTCICE     = "WEBRTC_ICE_CANDIDATE"
	EventChannelUpdate = "CHANNEL_UPDATE"
	EventMemberJoin    = "MEMBER_JOIN"
	EventMemberLeave   = "MEMBER_LEAVE"
	EventHeartbeat     = "HEARTBEAT"
	EventHeartbeatAck  = "HEARTBEAT_ACK"
	EventReady         = "READY"
	EventDMCallRing    = "DM_CALL_RING"
	EventDMCallAccept  = "DM_CALL_ACCEPT"
	EventDMCallReject  = "DM_CALL_REJECT"
	EventDMCallEnd     = "DM_CALL_END"
)

// WSMessage represents a WebSocket message envelope
type WSMessage struct {
	Event     string          `json:"event"`
	Data      json.RawMessage `json:"data"`
	ChannelID string          `json:"channel_id,omitempty"`
	ServerID  string          `json:"server_id,omitempty"`
	Timestamp int64           `json:"timestamp"`
}

// Client represents a connected WebSocket client
type Client struct {
	ID       uuid.UUID
	Username string
	Conn     *websocket.Conn
	Hub      *Hub
	Send     chan []byte
	Channels map[string]bool // Subscribed channel IDs
	Servers  map[string]bool // Subscribed server IDs
	mu       sync.RWMutex
}

// Hub manages all WebSocket connections
type Hub struct {
	clients    map[uuid.UUID]*Client
	channels   map[string]map[uuid.UUID]*Client // channelID -> clients
	broadcast  chan *BroadcastMessage
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// BroadcastMessage is a message to be sent to specific targets
type BroadcastMessage struct {
	Message   []byte
	ChannelID string
	ServerID  string
	ExcludeID uuid.UUID // Don't send back to sender
	TargetID  *uuid.UUID // Send to specific user (for WebRTC signaling)
}

// GlobalHub is the singleton hub instance accessible from handlers
var GlobalHub *Hub

// NewHub creates a new WebSocket hub
func NewHub() *Hub {
	h := &Hub{
		clients:    make(map[uuid.UUID]*Client),
		channels:   make(map[string]map[uuid.UUID]*Client),
		broadcast:  make(chan *BroadcastMessage, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
	GlobalHub = h
	return h
}

// Run starts the hub's main event loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("Client connected: %s (%s)", client.Username, client.ID)

			// Send READY event
			readyMsg := WSMessage{
				Event:     EventReady,
				Data:      json.RawMessage(`{"status": "connected"}`),
				Timestamp: time.Now().UnixMilli(),
			}
			data, _ := json.Marshal(readyMsg)
			client.Send <- data

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)

				// Remove from all channels
				for channelID := range client.Channels {
					if ch, ok := h.channels[channelID]; ok {
						delete(ch, client.ID)
						if len(ch) == 0 {
							delete(h.channels, channelID)
						}
					}
				}
			}
			h.mu.Unlock()
			log.Printf("Client disconnected: %s (%s)", client.Username, client.ID)

			// Broadcast offline status
			presenceMsg := WSMessage{
				Event:     EventPresence,
				Timestamp: time.Now().UnixMilli(),
			}
			presenceData, _ := json.Marshal(map[string]interface{}{
				"user_id":  client.ID,
				"username": client.Username,
				"status":   "offline",
			})
			presenceMsg.Data = presenceData
			msgBytes, _ := json.Marshal(presenceMsg)

			h.mu.RLock()
			for _, c := range h.clients {
				select {
				case c.Send <- msgBytes:
				default:
				}
			}
			h.mu.RUnlock()

		case msg := <-h.broadcast:
			// Send to specific user (e.g., WebRTC signaling)
			if msg.TargetID != nil {
				h.mu.RLock()
				if client, ok := h.clients[*msg.TargetID]; ok {
					select {
					case client.Send <- msg.Message:
					default:
					}
				}
				h.mu.RUnlock()
				continue
			}

			// Broadcast to channel
			if msg.ChannelID != "" {
				h.mu.RLock()
				if clients, ok := h.channels[msg.ChannelID]; ok {
					for id, client := range clients {
						if id != msg.ExcludeID {
							select {
							case client.Send <- msg.Message:
							default:
							}
						}
					}
				}
				h.mu.RUnlock()
				continue
			}

			// Broadcast to all clients in a server
			if msg.ServerID != "" {
				h.mu.RLock()
				for id, client := range h.clients {
					if id != msg.ExcludeID {
						client.mu.RLock()
						if client.Servers[msg.ServerID] {
							select {
							case client.Send <- msg.Message:
							default:
							}
						}
						client.mu.RUnlock()
					}
				}
				h.mu.RUnlock()
			}
		}
	}
}

// SubscribeChannel adds a client to a channel
func (h *Hub) SubscribeChannel(clientID uuid.UUID, channelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client, ok := h.clients[clientID]
	if !ok {
		return
	}

	if _, ok := h.channels[channelID]; !ok {
		h.channels[channelID] = make(map[uuid.UUID]*Client)
	}
	h.channels[channelID][clientID] = client

	client.mu.Lock()
	client.Channels[channelID] = true
	client.mu.Unlock()
}

// UnsubscribeChannel removes a client from a channel
func (h *Hub) UnsubscribeChannel(clientID uuid.UUID, channelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, ok := h.channels[channelID]; ok {
		delete(clients, clientID)
		if len(clients) == 0 {
			delete(h.channels, channelID)
		}
	}

	if client, ok := h.clients[clientID]; ok {
		client.mu.Lock()
		delete(client.Channels, channelID)
		client.mu.Unlock()
	}
}

// SubscribeServer marks a client as subscribed to a server
func (h *Hub) SubscribeServer(clientID uuid.UUID, serverID string) {
	h.mu.RLock()
	client, ok := h.clients[clientID]
	h.mu.RUnlock()

	if !ok {
		return
	}

	client.mu.Lock()
	client.Servers[serverID] = true
	client.mu.Unlock()
}

// BroadcastToChannel sends a message to all clients in a channel
func (h *Hub) BroadcastToChannel(channelID string, event string, data interface{}, excludeID uuid.UUID) {
	dataBytes, _ := json.Marshal(data)
	msg := WSMessage{
		Event:     event,
		Data:      dataBytes,
		ChannelID: channelID,
		Timestamp: time.Now().UnixMilli(),
	}
	msgBytes, _ := json.Marshal(msg)

	h.broadcast <- &BroadcastMessage{
		Message:   msgBytes,
		ChannelID: channelID,
		ExcludeID: excludeID,
	}
}

// BroadcastToServer sends a message to all clients in a server
func (h *Hub) BroadcastToServer(serverID string, event string, data interface{}, excludeID uuid.UUID) {
	dataBytes, _ := json.Marshal(data)
	msg := WSMessage{
		Event:     event,
		Data:      dataBytes,
		ServerID:  serverID,
		Timestamp: time.Now().UnixMilli(),
	}
	msgBytes, _ := json.Marshal(msg)

	h.broadcast <- &BroadcastMessage{
		Message:  msgBytes,
		ServerID: serverID,
		ExcludeID: excludeID,
	}
}

// SendToUser sends a message to a specific user
func (h *Hub) SendToUser(targetID uuid.UUID, event string, data interface{}) {
	dataBytes, _ := json.Marshal(data)
	msg := WSMessage{
		Event:     event,
		Data:      dataBytes,
		Timestamp: time.Now().UnixMilli(),
	}
	msgBytes, _ := json.Marshal(msg)

	h.broadcast <- &BroadcastMessage{
		Message:  msgBytes,
		TargetID: &targetID,
	}
}

// HandleWebSocket returns the WebSocket handler
func HandleWebSocket(hub *Hub) fiber.Handler {
	return websocket.New(func(c *websocket.Conn) {
		userID, _ := c.Locals("userID").(uuid.UUID)
		username, _ := c.Locals("username").(string)

		client := &Client{
			ID:       userID,
			Username: username,
			Conn:     c,
			Hub:      hub,
			Send:     make(chan []byte, 256),
			Channels: make(map[string]bool),
			Servers:  make(map[string]bool),
		}

		hub.register <- client

		// Write pump
		go func() {
			defer c.Close()
			for msg := range client.Send {
				if err := c.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			}
		}()

		// Read pump
		for {
			_, msgBytes, err := c.ReadMessage()
			if err != nil {
				hub.unregister <- client
				return
			}

			var msg WSMessage
			if err := json.Unmarshal(msgBytes, &msg); err != nil {
				continue
			}

			handleClientMessage(hub, client, &msg)
		}
	})
}

// handleClientMessage processes incoming WebSocket messages from clients
func handleClientMessage(hub *Hub, client *Client, msg *WSMessage) {
	switch msg.Event {
	case EventHeartbeat:
		// Respond with heartbeat ACK
		ack := WSMessage{
			Event:     EventHeartbeatAck,
			Data:      json.RawMessage(`{}`),
			Timestamp: time.Now().UnixMilli(),
		}
		data, _ := json.Marshal(ack)
		client.Send <- data

	case "SUBSCRIBE_CHANNEL":
		var payload struct {
			ChannelID string `json:"channel_id"`
		}
		json.Unmarshal(msg.Data, &payload)
		if payload.ChannelID != "" {
			hub.SubscribeChannel(client.ID, payload.ChannelID)
		}

	case "UNSUBSCRIBE_CHANNEL":
		var payload struct {
			ChannelID string `json:"channel_id"`
		}
		json.Unmarshal(msg.Data, &payload)
		if payload.ChannelID != "" {
			hub.UnsubscribeChannel(client.ID, payload.ChannelID)
		}

	case "SUBSCRIBE_SERVER":
		var payload struct {
			ServerID string `json:"server_id"`
		}
		json.Unmarshal(msg.Data, &payload)
		if payload.ServerID != "" {
			hub.SubscribeServer(client.ID, payload.ServerID)
		}

	case EventTyping:
		// Broadcast typing indicator to channel
		var payload struct {
			ChannelID string `json:"channel_id"`
		}
		json.Unmarshal(msg.Data, &payload)
		if payload.ChannelID != "" {
			hub.BroadcastToChannel(payload.ChannelID, EventTyping, map[string]interface{}{
				"user_id":    client.ID,
				"username":   client.Username,
				"channel_id": payload.ChannelID,
			}, client.ID)
		}

	case EventWebRTCOffer, EventWebRTCAnswer, EventWebRTCICE:
		// Relay WebRTC signaling to target user
		var payload struct {
			TargetUserID string      `json:"target_user_id"`
			Signal       interface{} `json:"signal"`
			ChannelID    string      `json:"channel_id"`
		}
		json.Unmarshal(msg.Data, &payload)

		targetID, err := uuid.Parse(payload.TargetUserID)
		if err != nil {
			return
		}

		hub.SendToUser(targetID, msg.Event, map[string]interface{}{
			"from_user_id": client.ID,
			"from_username": client.Username,
			"signal":       payload.Signal,
			"channel_id":   payload.ChannelID,
		})

	case EventDMCallRing, EventDMCallAccept, EventDMCallReject, EventDMCallEnd:
		// Relay DM call events to target user
		var payload struct {
			TargetUserID string `json:"target_user_id"`
			DMChannelID  string `json:"dm_channel_id"`
			CallType     string `json:"call_type"` // audio or video
		}
		json.Unmarshal(msg.Data, &payload)

		targetID, err := uuid.Parse(payload.TargetUserID)
		if err != nil {
			return
		}

		hub.SendToUser(targetID, msg.Event, map[string]interface{}{
			"from_user_id":  client.ID,
			"from_username": client.Username,
			"dm_channel_id": payload.DMChannelID,
			"call_type":     payload.CallType,
		})
	}
}
