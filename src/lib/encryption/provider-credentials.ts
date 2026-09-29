import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export type EncryptedCredential = {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

function readEncryptionKey() {
  const encoded = process.env.ENCRYPTION_KEY
  if (!encoded) throw new Error("ENCRYPTION_KEY is required")
  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes")
  return key
}

export function encryptCredential(plaintext: string): EncryptedCredential {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", readEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }
}

export function decryptCredential(payload: EncryptedCredential) {
  if (payload.version !== 1) throw new Error("Unsupported credential version")
  const decipher = createDecipheriv("aes-256-gcm", readEncryptionKey(), Buffer.from(payload.iv, "base64"))
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

export function maskCredential(_credential?: string | null) {
  return "••••••••••••"
}
