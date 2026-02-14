package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"

	"github.com/shitcord/backend/internal/database"
	"github.com/shitcord/backend/internal/handlers"
	"github.com/shitcord/backend/internal/middleware"
	"github.com/shitcord/backend/internal/ws"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, using system environment variables")
	}

	// Connect to database
	if err := database.Connect(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	log.Println("✓ Database connected")

	// Run migrations
	if err := database.Migrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}
	log.Println("✓ Database migrated")

	// Initialize WebSocket hub
	hub := ws.NewHub()
	go hub.Run()
	log.Println("✓ WebSocket hub started")

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:   "Shitcord API v1.0",
		BodyLimit: 50 * 1024 * 1024, // 50MB
	})

	// Global middleware
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "${time} | ${status} | ${latency} | ${method} ${path}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins:     getEnv("ALLOWED_ORIGINS", "http://localhost:5173"),
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		AllowCredentials: true,
	}))

	// Static file serving for uploads
	app.Static("/uploads", "./uploads")

	// API routes
	api := app.Group("/api/v1")

	// Health check
	api.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "Shitcord API",
			"version": "1.0.0",
		})
	})

	// Auth routes (public)
	auth := api.Group("/auth")
	auth.Post("/register", handlers.Register)
	auth.Post("/login", handlers.Login)
	auth.Post("/refresh", handlers.RefreshToken)

	// Protected routes
	protected := api.Group("/", middleware.AuthRequired())

	// User routes
	users := protected.Group("/users")
	users.Get("/me", handlers.GetCurrentUser)
	users.Put("/me", handlers.UpdateCurrentUser)
	users.Get("/me/keys", handlers.GetMyPublicKeys)
	users.Post("/me/keys", handlers.UploadPublicKey)
	users.Get("/:id", handlers.GetUser)
	users.Get("/:id/keys", handlers.GetUserPublicKeys)

	// Server (Guild) routes
	servers := protected.Group("/servers")
	servers.Post("/", handlers.CreateServer)
	servers.Get("/", handlers.GetMyServers)
	servers.Get("/:serverId", handlers.GetServer)
	servers.Put("/:serverId", handlers.UpdateServer)
	servers.Delete("/:serverId", handlers.DeleteServer)
	servers.Post("/:serverId/join", handlers.JoinServer)
	servers.Post("/:serverId/leave", handlers.LeaveServer)
	servers.Get("/:serverId/members", handlers.GetServerMembers)
	servers.Delete("/:serverId/members/:userId", handlers.KickMember)
	servers.Post("/:serverId/invite", handlers.CreateInvite)
	servers.Post("/join/:code", handlers.JoinByInvite)

	// Channel routes
	channels := protected.Group("/servers/:serverId/channels")
	channels.Post("/", handlers.CreateChannel)
	channels.Get("/", handlers.GetChannels)
	channels.Get("/:channelId", handlers.GetChannel)
	channels.Put("/:channelId", handlers.UpdateChannel)
	channels.Delete("/:channelId", handlers.DeleteChannel)

	// Message routes
	messages := protected.Group("/channels/:channelId/messages")
	messages.Get("/", handlers.GetMessages)
	messages.Post("/", handlers.SendMessage)
	messages.Put("/:messageId", handlers.EditMessage)
	messages.Delete("/:messageId", handlers.DeleteMessage)

	// Direct message routes
	dms := protected.Group("/dms")
	dms.Get("/", handlers.GetDMChannels)
	dms.Post("/", handlers.CreateDMChannel)

	// File upload
	protected.Post("/upload", handlers.UploadFile)

	// Voice/Video signaling
	voice := protected.Group("/voice")
	voice.Post("/join/:channelId", handlers.JoinVoiceChannel)
	voice.Post("/leave/:channelId", handlers.LeaveVoiceChannel)

	// WebSocket endpoint
	app.Use("/ws", middleware.AuthWSUpgrade())
	app.Get("/ws", ws.HandleWebSocket(hub))

	// Serve frontend static files
	frontendDir := getEnv("FRONTEND_DIR", "../frontend/dist")
	app.Static("/", frontendDir)

	// SPA catch-all: serve index.html for any non-API/non-file route
	app.Get("/*", func(c *fiber.Ctx) error {
		return c.SendFile(frontendDir + "/index.html")
	})

	// Start server
	port := getEnv("PORT", "8080")
	host := getEnv("HOST", "0.0.0.0")
	addr := fmt.Sprintf("%s:%s", host, port)
	log.Printf("🚀 Shitcord API starting on %s", addr)
	log.Fatal(app.Listen(addr))
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
