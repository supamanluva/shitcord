package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/shitcord/backend/internal/database"
	"github.com/shitcord/backend/internal/models"
)

// GetPendingUsers returns all users awaiting approval
func GetPendingUsers(c *fiber.Ctx) error {
	var users []models.User
	if err := database.DB.Where("is_approved = ?", false).Order("created_at ASC").Find(&users).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch pending users",
		})
	}

	return c.JSON(users)
}

// GetAllUsers returns all users (for admin overview)
func GetAllUsers(c *fiber.Ctx) error {
	var users []models.User
	if err := database.DB.Order("created_at ASC").Find(&users).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch users",
		})
	}

	return c.JSON(users)
}

// ApproveUser approves a pending user
func ApproveUser(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	var user models.User
	if err := database.DB.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	if user.IsApproved {
		return c.JSON(fiber.Map{"message": "User already approved"})
	}

	database.DB.Model(&user).Update("is_approved", true)

	return c.JSON(fiber.Map{
		"message": "User approved successfully",
		"user":    user,
	})
}

// RejectUser deletes a pending user (reject registration)
func RejectUser(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	var user models.User
	if err := database.DB.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	// Hard delete — they can re-register
	database.DB.Unscoped().Delete(&user)

	return c.JSON(fiber.Map{
		"message": "User rejected and deleted",
	})
}
