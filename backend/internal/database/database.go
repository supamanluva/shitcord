package database

import (
	"fmt"
	"log"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/shitcord/backend/internal/models"
)

var DB *gorm.DB

// Connect establishes a connection to the database
func Connect() error {
	dbDriver := getEnv("DB_DRIVER", "sqlite")

	var dialector gorm.Dialector

	switch dbDriver {
	case "postgres":
		dsn := fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			getEnv("DB_HOST", "localhost"),
			getEnv("DB_PORT", "5432"),
			getEnv("DB_USER", "shitcord"),
			getEnv("DB_PASSWORD", ""),
			getEnv("DB_NAME", "shitcord"),
			getEnv("DB_SSLMODE", "disable"),
		)
		dialector = postgres.Open(dsn)
	default:
		dbPath := getEnv("DB_PATH", "./shitcord.db")
		log.Printf("Using SQLite database at %s", dbPath)
		dialector = sqlite.Open(dbPath)
	}

	var err error
	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	return nil
}

// Migrate runs auto-migrations for all models
func Migrate() error {
	return DB.AutoMigrate(
		&models.User{},
		&models.UserPublicKey{},
		&models.Server{},
		&models.ServerMember{},
		&models.Channel{},
		&models.DMChannel{},
		&models.Message{},
		&models.VoiceState{},
		&models.Invite{},
	)
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
