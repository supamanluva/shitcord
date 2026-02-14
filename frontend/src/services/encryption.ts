/**
 * Shitcord E2E Encryption Service
 * 
 * Uses the Web Crypto API to provide end-to-end encryption for messages.
 * Implements a simplified Signal Protocol-inspired key exchange:
 * 
 * 1. Each user generates an identity key pair (ECDH P-256)
 * 2. Users exchange public keys via the server
 * 3. A shared secret is derived using ECDH
 * 4. Messages are encrypted using AES-256-GCM with the derived key
 * 
 * For group channels, a channel key is generated and distributed
 * to all members encrypted with their individual shared secrets.
 */

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const ECDH_CURVE = 'P-256'

export interface KeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
}

export interface ExportedKeyPair {
  publicKey: string  // Base64-encoded
  privateKey: string // Base64-encoded
}

export interface EncryptedMessage {
  ciphertext: string  // Base64-encoded
  nonce: string       // Base64-encoded IV
  header: string      // Key exchange metadata
}

class EncryptionService {
  private identityKeyPair: KeyPair | null = null
  private sharedSecrets: Map<string, CryptoKey> = new Map() // userId -> derived AES key
  private channelKeys: Map<string, CryptoKey> = new Map()   // channelId -> AES key

  /**
   * Generate a new identity key pair for the user
   */
  async generateIdentityKeyPair(): Promise<ExportedKeyPair> {
    this.identityKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      true,
      ['deriveKey', 'deriveBits']
    ) as KeyPair

    const publicKeyBuffer = await crypto.subtle.exportKey('spki', this.identityKeyPair.publicKey)
    const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', this.identityKeyPair.privateKey)

    const exported: ExportedKeyPair = {
      publicKey: bufferToBase64(publicKeyBuffer),
      privateKey: bufferToBase64(privateKeyBuffer),
    }

    // Store in IndexedDB for persistence
    await this.storeKeyPair(exported)

    return exported
  }

  /**
   * Load stored identity key pair from IndexedDB
   */
  async loadIdentityKeyPair(): Promise<boolean> {
    const stored = await this.retrieveKeyPair()
    if (!stored) return false

    try {
      const publicKeyBuffer = base64ToBuffer(stored.publicKey)
      const privateKeyBuffer = base64ToBuffer(stored.privateKey)

      const publicKey = await crypto.subtle.importKey(
        'spki',
        publicKeyBuffer,
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        true,
        []
      )

      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        privateKeyBuffer,
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        true,
        ['deriveKey', 'deriveBits']
      )

      this.identityKeyPair = { publicKey, privateKey }
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the public key as Base64 string for sharing
   */
  async getPublicKeyBase64(): Promise<string | null> {
    if (!this.identityKeyPair) return null
    const buffer = await crypto.subtle.exportKey('spki', this.identityKeyPair.publicKey)
    return bufferToBase64(buffer)
  }

  /**
   * Derive a shared secret with another user using ECDH
   */
  async deriveSharedSecret(userId: string, theirPublicKeyBase64: string): Promise<void> {
    if (!this.identityKeyPair) throw new Error('No identity key pair loaded')

    const theirPublicKeyBuffer = base64ToBuffer(theirPublicKeyBase64)
    const theirPublicKey = await crypto.subtle.importKey(
      'spki',
      theirPublicKeyBuffer,
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      false,
      []
    )

    const sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: theirPublicKey },
      this.identityKeyPair.privateKey,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    )

    this.sharedSecrets.set(userId, sharedKey)
  }

  /**
   * Generate a random channel key for group encryption
   */
  async generateChannelKey(channelId: string): Promise<string> {
    const key = await crypto.subtle.generateKey(
      { name: ALGORITHM, length: KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    )

    this.channelKeys.set(channelId, key as CryptoKey)

    const exported = await crypto.subtle.exportKey('raw', key as CryptoKey)
    return bufferToBase64(exported)
  }

  /**
   * Import a channel key received from another user
   */
  async importChannelKey(channelId: string, keyBase64: string): Promise<void> {
    const keyBuffer = base64ToBuffer(keyBase64)
    const key = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    )

    this.channelKeys.set(channelId, key)
  }

  /**
   * Encrypt a message for a specific channel
   */
  async encryptMessage(content: string, channelId: string): Promise<EncryptedMessage> {
    const key = this.channelKeys.get(channelId)
    if (!key) {
      // No channel key yet - send plaintext with a flag
      // In production, you'd always require a key
      return {
        ciphertext: btoa(encodeURIComponent(content)),
        nonce: '',
        header: 'plaintext',
      }
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      data
    )

    return {
      ciphertext: bufferToBase64(ciphertext),
      nonce: bufferToBase64(iv.buffer),
      header: 'e2e-aes-256-gcm',
    }
  }

  /**
   * Decrypt a message from a channel
   */
  async decryptMessage(encrypted: EncryptedMessage, channelId: string): Promise<string> {
    if (encrypted.header === 'plaintext' || !encrypted.nonce) {
      try {
        return decodeURIComponent(atob(encrypted.ciphertext))
      } catch {
        return encrypted.ciphertext
      }
    }

    const key = this.channelKeys.get(channelId)
    if (!key) {
      return '[Encrypted message - key not available]'
    }

    try {
      const ciphertext = base64ToBuffer(encrypted.ciphertext)
      const iv = base64ToBuffer(encrypted.nonce)

      const plaintext = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv: new Uint8Array(iv) },
        key,
        ciphertext
      )

      const decoder = new TextDecoder()
      return decoder.decode(plaintext)
    } catch {
      return '[Decryption failed]'
    }
  }

  /**
   * Encrypt a message for a direct message (user-to-user)
   */
  async encryptDM(content: string, recipientId: string): Promise<EncryptedMessage> {
    const key = this.sharedSecrets.get(recipientId)
    if (!key) {
      return {
        ciphertext: btoa(encodeURIComponent(content)),
        nonce: '',
        header: 'plaintext',
      }
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      data
    )

    return {
      ciphertext: bufferToBase64(ciphertext),
      nonce: bufferToBase64(iv.buffer),
      header: 'e2e-dm-aes-256-gcm',
    }
  }

  /**
   * Decrypt a direct message
   */
  async decryptDM(encrypted: EncryptedMessage, senderId: string): Promise<string> {
    if (encrypted.header === 'plaintext' || !encrypted.nonce) {
      try {
        return decodeURIComponent(atob(encrypted.ciphertext))
      } catch {
        return encrypted.ciphertext
      }
    }

    const key = this.sharedSecrets.get(senderId)
    if (!key) {
      return '[Encrypted DM - key not available]'
    }

    try {
      const ciphertext = base64ToBuffer(encrypted.ciphertext)
      const iv = base64ToBuffer(encrypted.nonce)

      const plaintext = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv: new Uint8Array(iv) },
        key,
        ciphertext
      )

      const decoder = new TextDecoder()
      return decoder.decode(plaintext)
    } catch {
      return '[DM Decryption failed]'
    }
  }

  // IndexedDB helpers for key persistence
  private async storeKeyPair(keyPair: ExportedKeyPair): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('shitcord-keys', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys')
        }
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('keys', 'readwrite')
        tx.objectStore('keys').put(keyPair, 'identity')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  }

  private async retrieveKeyPair(): Promise<ExportedKeyPair | null> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('shitcord-keys', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys')
        }
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('keys', 'readonly')
        const getReq = tx.objectStore('keys').get('identity')
        getReq.onsuccess = () => resolve(getReq.result || null)
        getReq.onerror = () => reject(getReq.error)
      }
      request.onerror = () => reject(request.error)
    })
  }
}

// Utility functions
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// Singleton instance
export const encryptionService = new EncryptionService()
