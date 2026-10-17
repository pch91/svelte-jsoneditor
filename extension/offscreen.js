/**
 * Offscreen Document Script (Chromium WebRTC Runner)
 */
import { relayEngine } from './p2pRelayEngine.js'

const ext = typeof browser !== 'undefined' ? browser : chrome

async function start() {
  await relayEngine.init()

  // Heartbeat to keep the relay awake and synchronized with storage changes
  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.globalPaused) {
        relayEngine.setGlobalPaused(changes.globalPaused.newValue)
      }
      if (changes.savedGroups) {
        relayEngine.init()
      }
    }
  })

  // Listen for relayed messages or group changes
  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'PING_OFFSCREEN') {
      sendResponse({ alive: true, state: relayEngine.getState() })
    }
  })
}

start().catch(console.error)
