package handlers

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// UploadFile handles file uploads and returns the URL
func UploadFile(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	// 50MB limit
	if file.Size > 50*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large. Maximum size is 50MB",
		})
	}

	// Validate extension
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
		".mp4": true, ".webm": true, ".mov": true,
		".mp3": true, ".ogg": true, ".wav": true, ".flac": true,
		".pdf": true, ".txt": true, ".md": true, ".csv": true,
		".zip": true, ".tar": true, ".gz": true, ".7z": true, ".rar": true,
		".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".pptx": true,
		".json": true, ".xml": true, ".yaml": true, ".yml": true,
		".go": true, ".py": true, ".js": true, ".ts": true, ".rs": true,
		".c": true, ".cpp": true, ".h": true, ".java": true, ".rb": true,
		".svg": true, ".ico": true, ".bmp": true, ".tiff": true,
	}

	if !allowedExts[ext] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("File type '%s' is not allowed", ext),
		})
	}

	// Create uploads directory structure: uploads/YYYY/MM/
	now := time.Now()
	dir := fmt.Sprintf("./uploads/%d/%02d", now.Year(), now.Month())
	if err := os.MkdirAll(dir, 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create upload directory",
		})
	}

	// Generate unique filename
	id := uuid.New().String()
	filename := fmt.Sprintf("%s%s", id, ext)
	path := filepath.Join(dir, filename)

	// Save the file
	if err := c.SaveFile(file, path); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	// Determine file type category
	fileType := "file"
	imageExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".svg": true, ".bmp": true, ".ico": true}
	videoExts := map[string]bool{".mp4": true, ".webm": true, ".mov": true}
	audioExts := map[string]bool{".mp3": true, ".ogg": true, ".wav": true, ".flac": true}

	if imageExts[ext] {
		fileType = "image"
	} else if videoExts[ext] {
		fileType = "video"
	} else if audioExts[ext] {
		fileType = "audio"
	}

	// Return the URL (strip leading ./)
	url := "/" + strings.TrimPrefix(path, "./")

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"url":           url,
		"filename":      file.Filename,
		"size":          file.Size,
		"type":          fileType,
		"content_type":  file.Header.Get("Content-Type"),
	})
}
