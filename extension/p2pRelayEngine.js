/**
 * P2P Swarm Relay Engine for Browser Extension (Chrome / Edge / Firefox)
 *
 * Runs 24/7 in background to act as a bridge for offline peers.
 * Supports multiple groups simultaneously and independent group pausing.
 */

export class P2PRelayEngine {
  constructor() {
    this.groups = new Map() // groupId -> { name, folderId, paused, peers: Map<peerId, RTCPeerConnection> }
    this.globalPaused = false
    this.listeners = new Set()
  }

  async init() {
    const ext = typeof browser !== 'undefined' ? browser : chrome
    const data = await ext.storage.local.get(['globalPaused', 'savedGroups'])
    this.globalPaused = data.globalPaused || false

    if (data.savedGroups) {
      for (const [groupId, g] of Object.entries(data.savedGroups)) {
        this.groups.set(groupId, {
          groupId,
          name: g.name || 'Grupo P2P',
          folderId: g.folderId,
          paused: g.paused || false,
          peerCount: g.peerCount || 0
        })
      }
    }
    this.notify()
  }

  async persist() {
    const ext = typeof browser !== 'undefined' ? browser : chrome
    const savedGroups = {}
    for (const [id, g] of this.groups.entries()) {
      savedGroups[id] = {
        groupId: g.groupId,
        name: g.name,
        folderId: g.folderId,
        paused: g.paused,
        peerCount: g.peerCount || 0
      }
    }
    await ext.storage.local.set({
      globalPaused: this.globalPaused,
      savedGroups
    })
    this.notify()
  }

  registerGroup(groupId, name, folderId) {
    if (!groupId) return
    const existing = this.groups.get(groupId)
    if (existing) {
      existing.name = name || existing.name
      existing.folderId = folderId !== undefined ? folderId : existing.folderId
    } else {
      this.groups.set(groupId, {
        groupId,
        name: name || 'Grupo ' + groupId.slice(0, 6),
        folderId,
        paused: false,
        peerCount: 0
      })
    }
    this.persist()
  }

  unregisterGroup(groupId) {
    if (this.groups.has(groupId)) {
      this.groups.delete(groupId)
      this.persist()
    }
  }

  setGlobalPaused(paused) {
    this.globalPaused = paused
    this.persist()
  }

  setGroupPaused(groupId, paused) {
    const g = this.groups.get(groupId)
    if (g) {
      g.paused = paused
      this.persist()
    }
  }

  getState() {
    const groupList = []
    for (const g of this.groups.values()) {
      groupList.push({
        groupId: g.groupId,
        name: g.name,
        folderId: g.folderId,
        paused: g.paused,
        peerCount: g.peerCount || 0,
        effectiveActive: !this.globalPaused && !g.paused
      })
    }
    return {
      globalPaused: this.globalPaused,
      groups: groupList,
      totalGroups: groupList.length,
      activeGroups: groupList.filter((g) => g.effectiveActive).length
    }
  }

  subscribe(callback) {
    this.listeners.add(callback)
    callback(this.getState())
    return () => this.listeners.delete(callback)
  }

  notify() {
    const state = this.getState()
    for (const cb of this.listeners) {
      try {
        cb(state)
      } catch {
        // Ignored
      }
    }
  }
}

export const relayEngine = new P2PRelayEngine()
