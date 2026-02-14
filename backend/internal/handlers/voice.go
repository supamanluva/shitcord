package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/shitcord/backend/internal/database"
	"github.com/shitcord/backend/internal/middleware"
	"github.com/shitcord/backend/internal/models"
	"github.com/shitcord/backend/internal/ws"
)

// JoinVoiceChannel adds a user to a voice channel
func JoinVoiceChannel(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel ID",
		})
	}

	var channel models.Channel
	if err := database.DB.First(&channel, "id = ?", channelID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Channel not found",
		})
	}

	if channel.Type != "voice" && channel.Type != "video" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "This is not a voice/video channel",
		})
	}

	if !isMember(userID, channel.ServerID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "You are not a member of this server",
		})
	}

	// Remove from any existing voice channel
	database.DB.Where("user_id = ?", userID).Delete(&models.VoiceState{})

	voiceState := models.VoiceState{
		UserID:    userID,
		ChannelID: channelID,
		ServerID:  channel.ServerID,
	}

	if err := database.DB.Create(&voiceState).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to join voice channel",
		})
	}

	// Reload voice state with user info
	database.DB.Preload("User").First(&voiceState, "id = ?", voiceState.ID)

	// Get all participants
	var participants []models.VoiceState
	database.DB.Where("channel_id = ?", channelID).Preload("User").Find(&participants)

	// Broadcast VOICE_STATE_JOIN to the channel so existing participants learn about the new joiner
	if ws.GlobalHub != nil {
		ws.GlobalHub.BroadcastToChannel(channelID.String(), ws.EventVoiceJoin, map[string]interface{}{
			"channel_id":  channelID,
			"server_id":   channel.ServerID,
			"voice_state": voiceState,
		}, userID)
	}

	return c.JSON(fiber.Map{
		"voice_state":  voiceState,
		"participants": participants,
	})
}

// LeaveVoiceChannel removes a user from a voice channel
func LeaveVoiceChannel(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	channelID, err := uuid.Parse(c.Params("channelId"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid channel ID",
		})
	}

	database.DB.Where("user_id = ? AND channel_id = ?", userID, channelID).Delete(&models.VoiceState{})

	// Broadcast VOICE_STATE_LEAVE to the channel
	if ws.GlobalHub != nil {
		ws.GlobalHub.BroadcastToChannel(channelID.String(), ws.EventVoiceLeave, map[string]interface{}{
			"channel_id": channelID,
			"user_id":    userID,
		}, userID)
	}

	return c.JSON(fiber.Map{"message": "Left voice channel"})
}
