package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User represents a Shitcord user account
type User struct {
	ID           uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	Username     string         `gorm:"uniqueIndex;size:32;not null" json:"username"`
	Email        string         `gorm:"uniqueIndex;size:255;not null" json:"email"`
	PasswordHash string         `gorm:"not null" json:"-"`
	DisplayName  string         `gorm:"size:64" json:"display_name"`
	AvatarURL    string         `gorm:"size:512" json:"avatar_url"`
	Status       string         `gorm:"size:16;default:'offline'" json:"status"` // online, offline, idle, dnd
	Bio          string         `gorm:"size:512" json:"bio"`
	PublicKey    string         `gorm:"type:text" json:"public_key"` // E2E encryption public key
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	// Relations
	OwnedServers []Server       `gorm:"foreignKey:OwnerID" json:"-"`
	Memberships  []ServerMember `gorm:"foreignKey:UserID" json:"-"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}

// UserPublicKey stores encryption keys for users (supports key rotation)
type UserPublicKey struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	KeyType     string    `gorm:"size:32;not null" json:"key_type"`     // identity, signed_prekey, one_time_prekey
	PublicKey   string    `gorm:"type:text;not null" json:"public_key"` // Base64-encoded public key
	KeyID       int       `gorm:"not null" json:"key_id"`              // Key identifier for rotation
	Signature   string    `gorm:"type:text" json:"signature"`          // Signature for signed prekeys
	IsActive    bool      `gorm:"default:true" json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (k *UserPublicKey) BeforeCreate(tx *gorm.DB) error {
	if k.ID == uuid.Nil {
		k.ID = uuid.New()
	}
	return nil
}

// Server represents a server (like a Discord guild)
type Server struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	Name        string         `gorm:"size:100;not null" json:"name"`
	Description string         `gorm:"size:1024" json:"description"`
	IconURL     string         `gorm:"size:512" json:"icon_url"`
	OwnerID     uuid.UUID      `gorm:"type:uuid;not null" json:"owner_id"`
	InviteCode  string         `gorm:"uniqueIndex;size:16" json:"invite_code"`
	IsPrivate   bool           `gorm:"default:false" json:"is_private"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`

	// Relations
	Owner    User           `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Members  []ServerMember `gorm:"foreignKey:ServerID" json:"members,omitempty"`
	Channels []Channel      `gorm:"foreignKey:ServerID" json:"channels,omitempty"`
}

func (s *Server) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// ServerMember represents a user's membership in a server
type ServerMember struct {
	ID       uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	ServerID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_server_user" json:"server_id"`
	UserID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_server_user" json:"user_id"`
	Role     string    `gorm:"size:32;default:'member'" json:"role"` // owner, admin, moderator, member
	Nickname string    `gorm:"size:64" json:"nickname"`
	JoinedAt time.Time `json:"joined_at"`

	Server Server `gorm:"foreignKey:ServerID" json:"-"`
	User   User   `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (m *ServerMember) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.JoinedAt.IsZero() {
		m.JoinedAt = time.Now()
	}
	return nil
}

// Channel represents a channel within a server
type Channel struct {
	ID        uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	ServerID  uuid.UUID      `gorm:"type:uuid;not null;index" json:"server_id"`
	Name      string         `gorm:"size:100;not null" json:"name"`
	Topic     string         `gorm:"size:1024" json:"topic"`
	Type      string         `gorm:"size:16;default:'text'" json:"type"` // text, voice, video
	Position  int            `gorm:"default:0" json:"position"`
	IsPrivate bool           `gorm:"default:false" json:"is_private"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Server   Server    `gorm:"foreignKey:ServerID" json:"-"`
	Messages []Message `gorm:"foreignKey:ChannelID" json:"-"`
}

func (c *Channel) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

// DMChannel represents a direct message channel between two users
type DMChannel struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	User1ID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_dm_users" json:"user1_id"`
	User2ID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_dm_users" json:"user2_id"`
	CreatedAt time.Time `json:"created_at"`

	User1    User      `gorm:"foreignKey:User1ID" json:"user1,omitempty"`
	User2    User      `gorm:"foreignKey:User2ID" json:"user2,omitempty"`
	Messages []Message `gorm:"foreignKey:ChannelID" json:"-"`
}

func (d *DMChannel) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}

// Message represents a chat message (content is E2E encrypted)
type Message struct {
	ID               uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	ChannelID        uuid.UUID      `gorm:"type:uuid;not null;index" json:"channel_id"`
	AuthorID         uuid.UUID      `gorm:"type:uuid;not null" json:"author_id"`
	Content          string         `gorm:"type:text;not null" json:"content"`                    // Encrypted content
	Nonce            string         `gorm:"type:text" json:"nonce"`                               // Encryption nonce
	EncryptionHeader string         `gorm:"type:text" json:"encryption_header"`                   // Key exchange header
	Type             string         `gorm:"size:16;default:'text'" json:"type"`                   // text, image, file, system
	AttachmentURL    string         `gorm:"size:512" json:"attachment_url,omitempty"`
	ReplyToID        *uuid.UUID     `gorm:"type:uuid" json:"reply_to_id,omitempty"`
	IsEdited         bool           `gorm:"default:false" json:"is_edited"`
	IsPinned         bool           `gorm:"default:false" json:"is_pinned"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`

	Author  User     `gorm:"foreignKey:AuthorID" json:"author,omitempty"`
	ReplyTo *Message `gorm:"foreignKey:ReplyToID" json:"reply_to,omitempty"`
}

func (m *Message) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

// VoiceState tracks users in voice/video channels
type VoiceState struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"`
	ChannelID   uuid.UUID `gorm:"type:uuid;not null" json:"channel_id"`
	ServerID    uuid.UUID `gorm:"type:uuid;not null" json:"server_id"`
	IsMuted     bool      `gorm:"default:false" json:"is_muted"`
	IsDeafened  bool      `gorm:"default:false" json:"is_deafened"`
	IsStreaming bool      `gorm:"default:false" json:"is_streaming"`
	JoinedAt    time.Time `json:"joined_at"`

	User    User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Channel Channel `gorm:"foreignKey:ChannelID" json:"-"`
}

func (v *VoiceState) BeforeCreate(tx *gorm.DB) error {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	if v.JoinedAt.IsZero() {
		v.JoinedAt = time.Now()
	}
	return nil
}

// Invite represents a server invite link
type Invite struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	Code      string     `gorm:"uniqueIndex;size:16;not null" json:"code"`
	ServerID  uuid.UUID  `gorm:"type:uuid;not null" json:"server_id"`
	CreatorID uuid.UUID  `gorm:"type:uuid;not null" json:"creator_id"`
	MaxUses   int        `gorm:"default:0" json:"max_uses"`  // 0 = unlimited
	Uses      int        `gorm:"default:0" json:"uses"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`

	Server  Server `gorm:"foreignKey:ServerID" json:"server,omitempty"`
	Creator User   `gorm:"foreignKey:CreatorID" json:"creator,omitempty"`
}

func (i *Invite) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
}
