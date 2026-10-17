import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ExtensionBridge } from './extensionBridge.js'

describe('ExtensionBridge', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('defaults isRelayEnabled to false as required', () => {
    expect(ExtensionBridge.isRelayEnabled()).toBe(false)
  })

  it('updates and persists isRelayEnabled preference', () => {
    ExtensionBridge.setRelayEnabled(true)
    expect(ExtensionBridge.isRelayEnabled()).toBe(true)

    ExtensionBridge.setRelayEnabled(false)
    expect(ExtensionBridge.isRelayEnabled()).toBe(false)
  })

  it('returns isInstalled false when extension runtime is unavailable', async () => {
    const status = await ExtensionBridge.checkInstalled()
    expect(status.isInstalled).toBe(false)
  })

  it('detects extension when window.chrome runtime responds successfully', async () => {
    // Mock chrome.runtime.sendMessage
    const mockSendMessage = vi.fn((msg, callback) => {
      if (msg.action === 'PING_EXTENSION') {
        callback({ success: true, version: '1.0.0' })
      }
    })

    // @ts-expect-error Mocking window.chrome
    window.chrome = {
      runtime: {
        sendMessage: mockSendMessage
      }
    }

    const status = await ExtensionBridge.checkInstalled()
    expect(status.isInstalled).toBe(true)
    expect(status.version).toBe('1.0.0')

    // @ts-expect-error cleanup
    delete window.chrome
  })
})
