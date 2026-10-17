/**
 * Universal Background Service Worker / Event Page
 * Supports Chrome, Edge (via chrome.offscreen) and Firefox (direct execution).
 */

const ext = typeof browser !== 'undefined' ? browser : chrome

// Ensure offscreen document for WebRTC on Chromium (Chrome & Edge)
async function ensureOffscreenDocument() {
  if (typeof ext.offscreen === 'undefined') {
    // Firefox supports WebRTC directly in background; offscreen not required.
    return
  }

  try {
    const existingContexts = await ext.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    })
    if (existingContexts && existingContexts.length > 0) {
      return
    }
  } catch {
    // Older Chromium fallback
  }

  try {
    await ext.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WEB_RTC'],
      justification: 'P2P Swarm relay for real-time WebRTC background sync'
    })
  } catch (err) {
    // Already created or not permitted
  }
}

// Initialize on install or startup
ext.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument()
})

ext.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument()
})

// Communication bridge with the Web App and the Extension Popup
ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse)
  return true // Async response
})

// Listen to messages from the external Svelte-JSONEditor web app
if (ext.runtime.onMessageExternal) {
  ext.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse)
    return true
  })
}

async function handleMessage(message) {
  if (!message || !message.action) return { success: false, error: 'Invalid action' }

  const storage = await ext.storage.local.get(['globalPaused', 'savedGroups'])
  const savedGroups = storage.savedGroups || {}
  let globalPaused = storage.globalPaused || false

  switch (message.action) {
    case 'PING_EXTENSION':
      return { success: true, installed: true, version: '1.0.0' }

    case 'GET_STATUS':
      return {
        success: true,
        globalPaused,
        groups: Object.values(savedGroups)
      }

    case 'REGISTER_GROUP':
      if (message.groupId) {
        savedGroups[message.groupId] = {
          groupId: message.groupId,
          name: message.name || 'Grupo ' + message.groupId.slice(0, 6),
          folderId: message.folderId,
          paused: false,
          updatedAt: Date.now()
        }
        await ext.storage.local.set({ savedGroups })
      }
      return { success: true, groups: Object.values(savedGroups) }

    case 'TOGGLE_GLOBAL_PAUSE':
      globalPaused = !globalPaused
      await ext.storage.local.set({ globalPaused })
      return { success: true, globalPaused }

    case 'TOGGLE_GROUP_PAUSE':
      if (message.groupId && savedGroups[message.groupId]) {
        savedGroups[message.groupId].paused = !savedGroups[message.groupId].paused
        await ext.storage.local.set({ savedGroups })
      }
      return { success: true, groups: Object.values(savedGroups) }

    default:
      return { success: false, error: 'Unknown action: ' + message.action }
  }
}
