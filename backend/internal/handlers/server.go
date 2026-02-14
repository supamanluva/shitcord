package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/shitcord/backend/internal/crypto"
	"github.com/shitcord/backend/internal/database"
	"github.com/shitcord/backend/internal/middleware"
	"github.com/shitcord/backend/internal/models"
	"github.com/shitcord/backend/internal/ws"
)

type CreateServerRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsPrivate   bool   `json:"is_private"`
}

// CreateServer creates a new server (guild)
func CreateServer(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var req CreateServerRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if len(req.Name) < 2 || len(req.Name) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Server name must be between 2 and 100 characters",
		})
	}

	server := models.Server{
		Name:        req.Name,
		Description: req.Description,
		OwnerID:     userID,
		InviteCode:  crypto.GenerateInviteCode(),
		IsPrivate:   req.IsPrivate,
	}

	tx := database.DB.Begin()

	if err := tx.Create(&server).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create server",
		})
	}

	// Add owner as member
	member := models.ServerMember{
		ServerID: server.ID,
		UserID:   userID,
		Role:     "owner",
	}
	if err := tx.Create(&member).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to add owner as member",
		})
	}

	// Create default channels
	defaultChannels := []models.Channel{
		{ServerID: server.ID, Name: "general", Type: "text", Position: 0},
		{ServerID: server.ID, Name: "random", Type: "text", Position: 1},
		{ServerID: server.ID, Name: "General Voice", Type: "voice", Position: 2},
	}
	for _, ch := range defaultChannels {
		if err := tx.Create(&ch).Error; err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create default channels",
			})
		}
	}

	tx.Commit()

	// Reload with associations
	database.DB.Preload("Channels").Preload("Owner").First(&server, "id = ?", server.ID)

	return c.Status(fiber.StatusCreated).JSON(server)
}

// GetMyServers returns all servers the user is a member of
func GetMyServers(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var memberships []models.ServerMember
	database.DB.Where("user_id = ?", userID).Find(&memberships)

	serverIDs := make([]uuid.UUID, len(memberships))
	for i, m := range memberships {
		serverIDs[i] = m.ServerID
	}

	var servers []models.Server
	database.DB.Where("id IN ?", serverIDs).Preload("Channels").Find(&servers)

	return c.JSON(servers)
}

// GetServer returns a specific server
func GetServer(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	// Check membership
	if !isMember(userID, serverID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "You are not a member of this server",
		})
	}

	var server models.Server
	if err := database.DB.Preload("Channels").Preload("Owner").First(&server, "id = ?", serverID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Server not found",
		})
	}

	return c.JSON(server)
}

// UpdateServer updates a server's details
func UpdateServer(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	if !hasPermission(userID, serverID, "admin") {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Insufficient permissions",
		})
	}

	type UpdateRequest struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		IconURL     *string `json:"icon_url"`
		IsPrivate   *bool   `json:"is_private"`
	}

	var req UpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.IconURL != nil {
		updates["icon_url"] = *req.IconURL
	}
	if req.IsPrivate != nil {
		updates["is_private"] = *req.IsPrivate
	}

	var server models.Server
	database.DB.Model(&server).Where("id = ?", serverID).Updates(updates)
	database.DB.Preload("Channels").First(&server, "id = ?", serverID)

	return c.JSON(server)
}

// DeleteServer deletes a server (owner only)
func DeleteServer(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	var server models.Server
	if err := database.DB.First(&server, "id = ?", serverID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Server not found",
		})
	}

	if server.OwnerID != userID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Only the server owner can delete the server",
		})
	}

	// Cascade delete
	tx := database.DB.Begin()
	tx.Where("server_id = ?", serverID).Delete(&models.VoiceState{})
	tx.Where("channel_id IN (SELECT id FROM channels WHERE server_id = ?)", serverID).Delete(&models.Message{})
	tx.Where("server_id = ?", serverID).Delete(&models.Channel{})
	tx.Where("server_id = ?", serverID).Delete(&models.ServerMember{})
	tx.Where("server_id = ?", serverID).Delete(&models.Invite{})
	tx.Delete(&server)
	tx.Commit()

	return c.JSON(fiber.Map{"message": "Server deleted successfully"})
}

// JoinServer joins a server by its ID (public servers)
func JoinServer(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	var server models.Server
	if err := database.DB.First(&server, "id = ?", serverID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Server not found",
		})
	}

	if server.IsPrivate {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "This server is private. Use an invite link to join.",
		})
	}

	if isMember(userID, serverID) {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "Already a member of this server",
		})
	}

	member := models.ServerMember{
		ServerID: serverID,
		UserID:   userID,
		Role:     "member",
	}
	database.DB.Create(&member)

	// Broadcast MEMBER_JOIN to existing server members via WebSocket
	database.DB.Preload("User").First(&member, "id = ?", member.ID)
	if ws.GlobalHub != nil {
		ws.GlobalHub.BroadcastToServer(serverID.String(), ws.EventMemberJoin, map[string]interface{}{
			"server_id": serverID,
			"member":    member,
		}, uuid.Nil)
	}

	return c.JSON(fiber.Map{"message": "Joined server successfully"})
}

// LeaveServer leaves a server
func LeaveServer(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	var server models.Server
	if err := database.DB.First(&server, "id = ?", serverID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Server not found",
		})
	}

	if server.OwnerID == userID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Server owner cannot leave. Transfer ownership or delete the server.",
		})
	}

	database.DB.Where("server_id = ? AND user_id = ?", serverID, userID).Delete(&models.ServerMember{})

	return c.JSON(fiber.Map{"message": "Left server successfully"})
}

// GetServerMembers returns all members of a server
func GetServerMembers(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	if !isMember(userID, serverID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "You are not a member of this server",
		})
	}

	var members []models.ServerMember
	database.DB.Where("server_id = ?", serverID).Preload("User").Find(&members)

	return c.JSON(members)
}

// KickMember removes a member from the server
func KickMember(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	targetID, err := uuid.Parse(c.Params("userId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	if !hasPermission(userID, serverID, "moderator") {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Insufficient permissions",
		})
	}

	// Can't kick the owner
	var server models.Server
	database.DB.First(&server, "id = ?", serverID)
	if server.OwnerID == targetID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Cannot kick the server owner",
		})
	}

	database.DB.Where("server_id = ? AND user_id = ?", serverID, targetID).Delete(&models.ServerMember{})

	return c.JSON(fiber.Map{"message": "Member kicked successfully"})
}

// CreateInvite creates an invite link for a server
func CreateInvite(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	if !isMember(userID, serverID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "You are not a member of this server",
		})
	}

	type InviteRequest struct {
		MaxUses   int    `json:"max_uses"`
		ExpiresIn string `json:"expires_in"` // e.g., "24h", "7d"
	}

	var req InviteRequest
	c.BodyParser(&req)

	invite := models.Invite{
		Code:      crypto.GenerateInviteCode(),
		ServerID:  serverID,
		CreatorID: userID,
		MaxUses:   req.MaxUses,
	}

	database.DB.Create(&invite)

	return c.Status(fiber.StatusCreated).JSON(invite)
}

// JoinByInvite joins a server using an invite code
func JoinByInvite(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	code := c.Params("code")

	var serverID uuid.UUID
	var foundInvite bool

	// First, try to find an explicit invite in the invites table
	var invite models.Invite
	if err := database.DB.Where("code = ?", code).First(&invite).Error; err == nil {
		// Check if invite has expired or reached max uses
		if invite.MaxUses > 0 && invite.Uses >= invite.MaxUses {
			return c.Status(fiber.StatusGone).JSON(fiber.Map{
				"error": "This invite has reached its maximum number of uses",
			})
		}

		if invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()) {
			return c.Status(fiber.StatusGone).JSON(fiber.Map{
				"error": "This invite has expired",
			})
		}

		serverID = invite.ServerID
		foundInvite = true
	} else {
		// Fallback: check the server's built-in invite_code field
		var server models.Server
		if err := database.DB.Where("invite_code = ?", code).First(&server).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Invalid invite code",
			})
		}
		serverID = server.ID
	}

	if isMember(userID, serverID) {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "Already a member of this server",
		})
	}

	member := models.ServerMember{
		ServerID: serverID,
		UserID:   userID,
		Role:     "member",
	}
	database.DB.Create(&member)

	// Increment uses on the invite if it came from the invites table
	if foundInvite {
		database.DB.Model(&invite).Update("uses", invite.Uses+1)
	}

	// Load the full server with channels for the response
	var server models.Server
	database.DB.Preload("Channels").Preload("Owner").First(&server, "id = ?", serverID)

	// Broadcast MEMBER_JOIN to existing server members via WebSocket
	var user models.User
	database.DB.First(&user, "id = ?", userID)
	database.DB.Preload("User").First(&member, "id = ?", member.ID)
	if ws.GlobalHub != nil {
		ws.GlobalHub.BroadcastToServer(serverID.String(), ws.EventMemberJoin, map[string]interface{}{
			"server_id": serverID,
			"member":    member,
		}, uuid.Nil)
	}

	return c.JSON(fiber.Map{
		"message": "Joined server successfully",
		"server":  server,
	})
}

// Helper functions

func isMember(userID, serverID uuid.UUID) bool {
	var count int64
	database.DB.Model(&models.ServerMember{}).
		Where("user_id = ? AND server_id = ?", userID, serverID).
		Count(&count)
	return count > 0
}

func hasPermission(userID, serverID uuid.UUID, minRole string) bool {
	var member models.ServerMember
	if err := database.DB.Where("user_id = ? AND server_id = ?", userID, serverID).First(&member).Error; err != nil {
		return false
	}

	roleHierarchy := map[string]int{
		"owner":     4,
		"admin":     3,
		"moderator": 2,
		"member":    1,
	}

	userLevel := roleHierarchy[member.Role]
	requiredLevel := roleHierarchy[minRole]

	return userLevel >= requiredLevel
}
