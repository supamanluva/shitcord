package handlers

import (
	"os"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/shitcord/backend/internal/database"
	"github.com/shitcord/backend/internal/middleware"
	"github.com/shitcord/backend/internal/models"
)

type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token        string      `json:"token"`
	RefreshToken string      `json:"refresh_token"`
	User         models.User `json:"user"`
}

// Register creates a new user account
func Register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate input
	if len(req.Username) < 3 || len(req.Username) > 32 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Username must be between 3 and 32 characters",
		})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Password must be at least 8 characters",
		})
	}
	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Email is required",
		})
	}

	// Check if user exists
	var existing models.User
	if err := database.DB.Where("email = ? OR username = ?", req.Email, req.Username).First(&existing).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "Username or email already taken",
		})
	}

	// Hash password with bcrypt (cost 12)
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to hash password",
		})
	}

	user := models.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: string(hash),
		DisplayName:  req.Username,
		Status:       "online",
	}

	if err := database.DB.Create(&user).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create user",
		})
	}

	// Generate tokens
	token, refreshToken, err := generateTokenPair(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
	})
}

// Login authenticates a user and returns a JWT
func Login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	var user models.User
	if err := database.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	// Update status
	database.DB.Model(&user).Update("status", "online")

	token, refreshToken, err := generateTokenPair(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	return c.JSON(AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
	})
}

// RefreshToken generates a new token pair from a refresh token
func RefreshToken(c *fiber.Ctx) error {
	type RefreshRequest struct {
		RefreshToken string `json:"refresh_token"`
	}

	var req RefreshRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "default-dev-secret-change-in-production"
	}

	token, err := jwt.ParseWithClaims(req.RefreshToken, &middleware.TokenClaims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid refresh token",
		})
	}

	claims, ok := token.Claims.(*middleware.TokenClaims)
	if !ok || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid refresh token",
		})
	}

	var user models.User
	if err := database.DB.First(&user, "id = ?", claims.UserID).Error; err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	newToken, newRefresh, err := generateTokenPair(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate tokens",
		})
	}

	return c.JSON(AuthResponse{
		Token:        newToken,
		RefreshToken: newRefresh,
		User:         user,
	})
}

func generateTokenPair(user models.User) (string, string, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "default-dev-secret-change-in-production"
	}

	expiryHours := 72
	if h, err := strconv.Atoi(os.Getenv("JWT_EXPIRY_HOURS")); err == nil {
		expiryHours = h
	}

	// Access token
	claims := middleware.TokenClaims{
		UserID:   user.ID,
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(expiryHours) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "shitcord",
			Subject:   user.ID.String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", "", err
	}

	// Refresh token (longer expiry)
	refreshClaims := middleware.TokenClaims{
		UserID:   user.ID,
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)), // 30 days
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "shitcord-refresh",
			Subject:   user.ID.String(),
		},
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshString, err := refreshToken.SignedString([]byte(secret))
	if err != nil {
		return "", "", err
	}

	return tokenString, refreshString, nil
}

// GetCurrentUser returns the authenticated user's profile
func GetCurrentUser(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var user models.User
	if err := database.DB.First(&user, "id = ?", userID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	return c.JSON(user)
}

// UpdateCurrentUser updates the authenticated user's profile
func UpdateCurrentUser(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	type UpdateRequest struct {
		DisplayName *string `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
		Bio         *string `json:"bio"`
		Status      *string `json:"status"`
	}

	var req UpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	updates := map[string]interface{}{}
	if req.DisplayName != nil {
		updates["display_name"] = *req.DisplayName
	}
	if req.AvatarURL != nil {
		updates["avatar_url"] = *req.AvatarURL
	}
	if req.Bio != nil {
		updates["bio"] = *req.Bio
	}
	if req.Status != nil {
		validStatuses := map[string]bool{"online": true, "offline": true, "idle": true, "dnd": true}
		if !validStatuses[*req.Status] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid status. Must be: online, offline, idle, dnd",
			})
		}
		updates["status"] = *req.Status
	}

	if len(updates) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No fields to update",
		})
	}

	var user models.User
	if err := database.DB.Model(&user).Where("id = ?", userID).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update user",
		})
	}

	database.DB.First(&user, "id = ?", userID)
	return c.JSON(user)
}

// GetUser returns a user's public profile
func GetUser(c *fiber.Ctx) error {
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

	// Return limited public info
	return c.JSON(fiber.Map{
		"id":           user.ID,
		"username":     user.Username,
		"display_name": user.DisplayName,
		"avatar_url":   user.AvatarURL,
		"status":       user.Status,
		"bio":          user.Bio,
	})
}

// GetMyPublicKeys returns the current user's encryption keys
func GetMyPublicKeys(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	var keys []models.UserPublicKey
	database.DB.Where("user_id = ? AND is_active = true", userID).Find(&keys)

	return c.JSON(keys)
}

// UploadPublicKey stores a new public key for E2E encryption
func UploadPublicKey(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	type KeyUpload struct {
		KeyType   string `json:"key_type"`
		PublicKey string `json:"public_key"`
		KeyID     int    `json:"key_id"`
		Signature string `json:"signature"`
	}

	var req KeyUpload
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	validTypes := map[string]bool{"identity": true, "signed_prekey": true, "one_time_prekey": true}
	if !validTypes[req.KeyType] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid key type",
		})
	}

	key := models.UserPublicKey{
		UserID:    userID,
		KeyType:   req.KeyType,
		PublicKey: req.PublicKey,
		KeyID:     req.KeyID,
		Signature: req.Signature,
		IsActive:  true,
	}

	// Deactivate old keys of same type (except one_time_prekeys)
	if req.KeyType != "one_time_prekey" {
		database.DB.Model(&models.UserPublicKey{}).
			Where("user_id = ? AND key_type = ?", userID, req.KeyType).
			Update("is_active", false)
	}

	if err := database.DB.Create(&key).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to upload key",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(key)
}

// GetUserPublicKeys returns another user's public encryption keys
func GetUserPublicKeys(c *fiber.Ctx) error {
	userID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	var keys []models.UserPublicKey
	database.DB.Where("user_id = ? AND is_active = true", userID).Find(&keys)

	return c.JSON(keys)
}
