package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
)

// ServerEncrypt encrypts data at rest using AES-256-GCM
// This is for server-side encryption of metadata. E2E message content
// is encrypted client-side before reaching the server.
func ServerEncrypt(plaintext []byte) ([]byte, []byte, error) {
	key, err := getServerKey()
	if err != nil {
		return nil, nil, err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}

	ciphertext := aesGCM.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

// ServerDecrypt decrypts server-side encrypted data
func ServerDecrypt(ciphertext, nonce []byte) ([]byte, error) {
	key, err := getServerKey()
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

// GenerateRandomBytes generates cryptographically secure random bytes
func GenerateRandomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return b, err
}

// GenerateInviteCode generates a random invite code
func GenerateInviteCode() string {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	rand.Read(b)
	for i := range b {
		b[i] = charset[b[i]%byte(len(charset))]
	}
	return string(b)
}

func getServerKey() ([]byte, error) {
	keyHex := os.Getenv("ENCRYPTION_KEY")
	if keyHex == "" {
		return nil, errors.New("ENCRYPTION_KEY environment variable not set")
	}

	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, errors.New("invalid ENCRYPTION_KEY format: must be hex-encoded")
	}

	if len(key) != 32 {
		return nil, errors.New("ENCRYPTION_KEY must be 32 bytes (64 hex characters)")
	}

	return key, nil
}
