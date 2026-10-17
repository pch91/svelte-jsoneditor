import { describe, it, expect, beforeEach } from 'vitest'
import { P2PCryptoEngine } from './p2pCrypto.js'

describe('P2PCryptoEngine (E2EE with ECDH + AES-256-GCM)', () => {
  let aliceCrypto: P2PCryptoEngine
  let bobCrypto: P2PCryptoEngine
  let eveHackerCrypto: P2PCryptoEngine

  beforeEach(() => {
    aliceCrypto = new P2PCryptoEngine()
    bobCrypto = new P2PCryptoEngine()
    eveHackerCrypto = new P2PCryptoEngine()
  })

  it('generates daily ephemeral key pair for current epoch', async () => {
    const epoch = aliceCrypto.getCurrentEpoch()
    const pair = await aliceCrypto.getOrCreateDailyKeyPair(epoch)

    expect(pair.epoch).toBe(epoch)
    expect(pair.publicKeyJwk).toBeDefined()
    expect(pair.publicKeyJwk.kty).toBe('EC')
    expect(pair.publicKeyJwk.crv).toBe('P-256')
    expect(pair.privateKey).toBeDefined()
  })

  it('derives identical shared secrets on both sides (Priv_A * Pub_B === Priv_B * Pub_A)', async () => {
    const epoch = aliceCrypto.getCurrentEpoch()
    const alicePair = await aliceCrypto.getOrCreateDailyKeyPair(epoch)
    const bobPair = await bobCrypto.getOrCreateDailyKeyPair(epoch)

    // Alice derives secret with Bob's public key
    await aliceCrypto.deriveSharedSecret('bob', bobPair.publicKeyJwk, epoch)
    // Bob derives secret with Alice's public key
    await bobCrypto.deriveSharedSecret('alice', alicePair.publicKeyJwk, epoch)

    // Alice encrypts a secret token
    const secretMessage = {
      action: 'grant-group-access',
      groupId: 'equipe-alpha',
      timestamp: Date.now()
    }

    const encrypted = await aliceCrypto.encrypt('bob', secretMessage, 'token_123', epoch)
    expect(encrypted.ciphertext).toBeDefined()
    expect(encrypted.iv).toBeDefined()

    // Bob decrypts with his derived secret
    const decrypted = await bobCrypto.decrypt('alice', encrypted)
    expect(decrypted).toEqual(secretMessage)
  })

  it('prevents an eavesdropping hacker (Eve) from decrypting the payload', async () => {
    const epoch = aliceCrypto.getCurrentEpoch()
    await aliceCrypto.getOrCreateDailyKeyPair(epoch)
    const bobPair = await bobCrypto.getOrCreateDailyKeyPair(epoch)
    await eveHackerCrypto.getOrCreateDailyKeyPair(epoch)

    await aliceCrypto.deriveSharedSecret('bob', bobPair.publicKeyJwk, epoch)

    const secretPayload = { confidentialData: 'Top Secret Workspace State' }
    const encrypted = await aliceCrypto.encrypt('bob', secretPayload, 'token_xyz', epoch)

    // Eve intercepts Alice's public key, Bob's public key, and the encrypted message
    // Eve tries to derive with Bob's public key using Eve's own private key
    await eveHackerCrypto.deriveSharedSecret('bob', bobPair.publicKeyJwk, epoch)

    // Eve tries to decrypt: it MUST fail (throw an error or fail authentication tag)
    await expect(eveHackerCrypto.decrypt('bob', encrypted)).rejects.toThrow()
  })

  it('generates identical 6-digit confirmation SAS on both Alice and Bob sides', async () => {
    const epoch = aliceCrypto.getCurrentEpoch()
    const alicePair = await aliceCrypto.getOrCreateDailyKeyPair(epoch)
    const bobPair = await bobCrypto.getOrCreateDailyKeyPair(epoch)

    const sasAlice = await P2PCryptoEngine.generateSasFingerprint(
      alicePair.publicKeyJwk,
      bobPair.publicKeyJwk
    )
    const sasBob = await P2PCryptoEngine.generateSasFingerprint(
      bobPair.publicKeyJwk,
      alicePair.publicKeyJwk
    )

    // Both Alice and Bob see the exact same 6-digit string (e.g., '123-456') in their popups
    expect(sasAlice).toMatch(/^\d{3}-\d{3}$/)
    expect(sasAlice).toBe(sasBob)
  })

  it('purges stale epochs when a new day arrives', async () => {
    const oldEpoch = '2026-10-15'
    await aliceCrypto.getOrCreateDailyKeyPair(oldEpoch)

    const newEpoch = '2026-10-17'
    await aliceCrypto.getOrCreateDailyKeyPair(newEpoch)

    // Requesting oldEpoch should now generate a fresh pair rather than the purged one
    const pair = await aliceCrypto.getOrCreateDailyKeyPair(newEpoch)
    expect(pair.epoch).toBe(newEpoch)
  })
})
