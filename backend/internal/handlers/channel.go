package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/shitcord/backend/internal/database"
	"github.com/shitcord/backend/internal/middleware"
	"github.com/shitcord/backend/internal/models"
	"github.com/shitcord/backend/internal/ws"
)

type CreateChannelRequest struct {
	Name      string `json:"name"`
	Topic     string `json:"topic"`
	Type      string `json:"type"` // text, voice, video
	Position  int    `json:"position"`
	IsPrivate bool   `json:"is_private"`
}

// CreateChannel creates a new channel in a server
func CreateChannel(c *fiber.Ctx) error {
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

	var req CreateChannelRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if len(req.Name) < 1 || len(req.Name) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Channel name must be between 1 and 100 characters",
		})
	}

	if req.Type == "" {
		req.Type = "text"
	}

	validTypes := map[string]bool{"text": true, "voice": true, "video": true}
	if !validTypes[req.Type] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel type. Must be: text, voice, or video",
		})
	}

	channel := models.Channel{
		ServerID:  serverID,
		Name:      req.Name,
		Topic:     req.Topic,
		Type:      req.Type,
		Position:  req.Position,
		IsPrivate: req.IsPrivate,
	}

	if err := database.DB.Create(&channel).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create channel",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(channel)
}

// GetChannels returns all channels in a server
func GetChannels(c *fiber.Ctx) error {
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

	var channels []models.Channel
	database.DB.Where("server_id = ?", serverID).Order("position asc").Find(&channels)

	return c.JSON(channels)
}

// GetChannel returns a specific channel
func GetChannel(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel ID",
		})
	}

	if !isMember(userID, serverID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "You are not a member of this server",
		})
	}

	var channel models.Channel
	if err := database.DB.Where("id = ? AND server_id = ?", channelID, serverID).First(&channel).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Channel not found",
		})
	}

	return c.JSON(channel)
}

// UpdateChannel updates a channel
func UpdateChannel(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel ID",
		})
	}

	if !hasPermission(userID, serverID, "admin") {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Insufficient permissions",
		})
	}

	type UpdateRequest struct {
		Name      *string `json:"name"`
		Topic     *string `json:"topic"`
		Position  *int    `json:"position"`
		IsPrivate *bool   `json:"is_private"`
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
	if req.Topic != nil {
		updates["topic"] = *req.Topic
	}
	if req.Position != nil {
		updates["position"] = *req.Position
	}
	if req.IsPrivate != nil {
		updates["is_private"] = *req.IsPrivate
	}

	var channel models.Channel
	database.DB.Model(&channel).Where("id = ? AND server_id = ?", channelID, serverID).Updates(updates)
	database.DB.First(&channel, "id = ?", channelID)

	return c.JSON(channel)
}

// DeleteChannel deletes a channel
func DeleteChannel(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	serverID, err := uuid.Parse(c.Params("serverId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid server ID",
		})
	}

	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel ID",
		})
	}

	if !hasPermission(userID, serverID, "admin") {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Insufficient permissions",
		})
	}

	// Delete messages first
	database.DB.Where("channel_id = ?", channelID).Delete(&models.Message{})
	database.DB.Where("id = ? AND server_id = ?", channelID, serverID).Delete(&models.Channel{})

	return c.JSON(fiber.Map{"message": "Channel deleted successfully"})
}

// GetMessages returns messages in a channel with pagination
func GetMessages(c *fiber.Ctx) error {
	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel ID",
		})
	}

	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	if limit > 100 {
		limit = 100
	}
	if limit < 1 {
		limit = 50
	}

	beforeID := c.Query("before")

	query := database.DB.Where("channel_id = ?", channelID).
		Preload("Author").
		Preload("ReplyTo").
		Preload("ReplyTo.Author").
		Order("created_at DESC").
		Limit(limit)

	if beforeID != "" {
		if id, err := uuid.Parse(beforeID); err == nil {
			var beforeMsg models.Message
			if database.DB.First(&beforeMsg, "id = ?", id).Error == nil {
				query = query.Where("created_at < ?", beforeMsg.CreatedAt)
			}
		}
	}

	var messages []models.Message
	query.Find(&messages)

	// Reverse to chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return c.JSON(messages)
}

// SendMessage sends a new message to a channel
func SendMessage(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel ID",
		})
	}

	type SendRequest struct {
		Content          string     `json:"content"`
		Nonce            string     `json:"nonce"`
		EncryptionHeader string     `json:"encryption_header"`
		Type             string     `json:"type"`
		AttachmentURL    string     `json:"attachment_url"`
		ReplyToID        *uuid.UUID `json:"reply_to_id"`
	}

	var req SendRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Content == "" && req.AttachmentURL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Message content cannot be empty",
		})
	}

	if req.Type == "" {
		req.Type = "text"
	}

	msg := models.Message{
		ChannelID:        channelID,
		AuthorID:         userID,
		Content:          req.Content,
		Nonce:            req.Nonce,
		EncryptionHeader: req.EncryptionHeader,
		Type:             req.Type,
		AttachmentURL:    req.AttachmentURL,
		ReplyToID:        req.ReplyToID,
	}

	if err := database.DB.Create(&msg).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to send message",
		})
	}

	// Reload with author
	database.DB.Preload("Author").Preload("ReplyTo").Preload("ReplyTo.Author").First(&msg, "id = ?", msg.ID)

	// Broadcast to all subscribers of this channel via WebSocket
	if ws.GlobalHub != nil {
		ws.GlobalHub.BroadcastToChannel(channelID.String(), ws.EventMessage, msg, userID)
	}

	return c.Status(fiber.StatusCreated).JSON(msg)
}

// EditMessage edits an existing message
func EditMessage(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	messageID, err := uuid.Parse(c.Params("messageId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid message ID",
		})
	}

	var msg models.Message
	if err := database.DB.First(&msg, "id = ?", messageID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Message not found",
		})
	}

	if msg.AuthorID != userID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "You can only edit your own messages",
		})
	}

	type EditRequest struct {
		Content          string `json:"content"`
		Nonce            string `json:"nonce"`
		EncryptionHeader string `json:"encryption_header"`
	}

	var req EditRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	database.DB.Model(&msg).Updates(map[string]interface{}{
		"content":           req.Content,
		"nonce":             req.Nonce,
		"encryption_header": req.EncryptionHeader,
		"is_edited":         true,
	})

	database.DB.Preload("Author").First(&msg, "id = ?", msg.ID)

	// Broadcast edit to all subscribers of this channel via WebSocket
	if ws.GlobalHub != nil {
		ws.GlobalHub.BroadcastToChannel(msg.ChannelID.String(), ws.EventMessageEdit, msg, userID)
	}

	return c.JSON(msg)
}

// DeleteMessage deletes a message
func DeleteMessage(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	messageID, err := uuid.Parse(c.Params("messageId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid message ID",
		})
	}

	var msg models.Message
	if err := database.DB.First(&msg, "id = ?", messageID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Message not found",
		})
	}

	// Authors can delete their own messages, admins can delete any
	if msg.AuthorID != userID {
		// Check if user is admin/mod in the channel's server
		var channel models.Channel
		if err := database.DB.First(&channel, "id = ?", msg.ChannelID).Error; err == nil {
			if !hasPermission(userID, channel.ServerID, "moderator") {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "Insufficient permissions",
				})
			}
		}
	}

	channelIDStr := msg.ChannelID.String()
	messageIDStr := msg.ID.String()
	database.DB.Delete(&msg)

	// Broadcast delete to all subscribers of this channel via WebSocket
	if ws.GlobalHub != nil {
		ws.GlobalHub.BroadcastToChannel(channelIDStr, ws.EventMessageDelete, map[string]interface{}{
			"message_id": messageIDStr,
			"channel_id": channelIDStr,
		}, userID)
	}

	return c.JSON(fiber.Map{"message": "Message deleted successfully"})
}

// GetDMChannels returns all DM channels for the current user
func GetDMChannels(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var dms []models.DMChannel
	database.DB.Where("user1_id = ? OR user2_id = ?", userID, userID).
		Preload("User1").Preload("User2").
		Find(&dms)

	return c.JSON(dms)
}

// CreateDMChannel creates a direct message channel between two users
func CreateDMChannel(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	type DMRequest struct {
		RecipientID uuid.UUID `json:"recipient_id"`
	}

	var req DMRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.RecipientID == userID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Cannot create a DM with yourself",
		})
	}

	// Check if DM already exists
	var existing models.DMChannel
	err := database.DB.Where(
		"(user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)",
		userID, req.RecipientID, req.RecipientID, userID,
	).First(&existing).Error

	if err == nil {
		database.DB.Preload("User1").Preload("User2").First(&existing, "id = ?", existing.ID)
		return c.JSON(existing)
	}

	dm := models.DMChannel{
		User1ID: userID,
		User2ID: req.RecipientID,
	}

	if err := database.DB.Create(&dm).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create DM channel",
		})
	}

	database.DB.Preload("User1").Preload("User2").First(&dm, "id = ?", dm.ID)

	return c.Status(fiber.StatusCreated).JSON(dm)
}
