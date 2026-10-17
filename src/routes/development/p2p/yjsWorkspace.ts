/**
 * Yjs CRDT Workspace Sync and Persistence Layer.
 *
 * Implements mathematically conflict-free real-time replication using Yjs,
 * incremental offline persistence via y-indexeddb, and collaborator presence/awareness.
 */

import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import { encoding, decoding } from 'lib0'
import { WebRtcManager, MSG_SYNC, MSG_AWARENESS, type PeerInfo } from './webrtcManager.js'
import { GossipMesh } from './gossipMesh.js'
import type { StoredWorkspace, StoredWorkspaceTab, StoredPrimaryTab } from '../workspaceStorage.js'

export interface UserPresence {
  clientId: number
  peerId: string
  userName: string
  color: string
  cursor?: { x: number; y: number }
  activeTabId?: number
  activePrimaryTabId?: number
  activeNodeId?: string
  lastSeen: number
}

export interface GroupMember {
  peerId: string
  userName: string
  color: string
  role: 'owner' | 'member'
  joinedAt: number
  lastSeen: number
  isLocal?: boolean
}

export interface GroupInfo {
  groupId: string
  groupName: string
  ownerPeerId: string
  isOwner: boolean
  createdAt: number
  bannedPeerIds: string[]
  members: GroupMember[]
  autoSync: boolean
}

export interface P2PWorkspaceState {
  status: 'offline' | 'connecting' | 'connected'
  peerCount: number
  peers: PeerInfo[]
  presences: UserPresence[]
  persistedLocally: boolean
  autoSync: boolean
  group: GroupInfo | null
}

const USER_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f97316', // orange
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#6366f1', // indigo
  '#eab308' // amber
]

function getRandomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
}

function getRandomPeerId(): string {
  return 'peer_' + Math.random().toString(36).slice(2, 10)
}

export class YjsWorkspaceManager {
  public ydoc: Y.Doc
  public persistence: IndexeddbPersistence | null = null
  public awareness: awarenessProtocol.Awareness
  public webrtc: WebRtcManager
  public gossip: GossipMesh

  public localPeerId: string
  public userName: string
  public userColor: string

  private remoteChangeCallbacks = new Set<(ws: StoredWorkspace) => void>()
  private remoteFolderChangeCallbacks = new Set<
    (
      folderId: number | string,
      data: { primaryTab?: StoredPrimaryTab; tabs: StoredWorkspaceTab[] }
    ) => void
  >()
  private presenceCallbacks = new Set<(presences: UserPresence[]) => void>()
  private statusCallbacks = new Set<(state: P2PWorkspaceState) => void>()
  private groupCallbacks = new Set<(info: GroupInfo | null) => void>()
  private folderGroupCallbacks = new Map<string, Set<(info: GroupInfo | null) => void>>()
  private kickCallbacks = new Set<(reason: string) => void>()

  private folderDocs = new Map<string, Y.Doc>()
  private folderPersistences = new Map<string, IndexeddbPersistence>()
  private folderAutoSync = new Map<string, boolean>()

  private isSyncingFromLocal = false
  private persistedLocally = false

  constructor() {
    this.localPeerId = this.loadOrGeneratePeerId()
    this.userName = this.loadOrGenerateUserName()
    this.userColor = this.loadOrGenerateUserColor()

    // Create Yjs CRDT Document
    this.ydoc = new Y.Doc({ guid: 'svelte-jsoneditor-workspace' })

    // Setup Awareness
    this.awareness = new awarenessProtocol.Awareness(this.ydoc)
    this.updateLocalAwareness({})

    // Setup WebRTC Transport
    this.webrtc = new WebRtcManager({
      localPeerId: this.localPeerId,
      userName: this.userName,
      userColor: this.userColor,
      onSyncMessage: (peerId, decoder, _roomId, folderId) => {
        if (folderId !== undefined) {
          this.handleRemoteFolderSyncMessage(peerId, decoder, folderId)
        } else {
          this.handleRemoteSyncMessage(peerId, decoder)
        }
      },
      onAwarenessMessage: (_peerId, update) => this.handleRemoteAwarenessMessage(update),
      onGossipMessage: (fromPeerId, message) => this.gossip.handleGossipPacket(fromPeerId, message),
      onStatusChange: () => this.emitStateChange(),
      onKicked: (reason) => this.handleKicked(reason),
      onDataChannelOpen: (peerId, roomId, folderId) =>
        this.onPeerDataChannelOpened(peerId, roomId, folderId)
    })

    // Setup Gossip Swarm
    this.gossip = new GossipMesh({
      webrtc: this.webrtc
    })

    // Setup Incremental Offline IndexedDB Persistence
    if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      try {
        this.persistence = new IndexeddbPersistence('svelte-jsoneditor-crdt', this.ydoc)
        this.persistence.on('synced', () => {
          this.persistedLocally = true
          this.emitStateChange()
        })
      } catch {
        // Fallback for storage restricted environments
      }
    }

    this.bindYjsEvents()
    this.bindAwarenessEvents()
  }

  private loadOrGeneratePeerId(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('jsoneditor_p2p_peer_id')
      if (stored) return stored
      const generated = getRandomPeerId()
      localStorage.setItem('jsoneditor_p2p_peer_id', generated)
      return generated
    }
    return getRandomPeerId()
  }

  private loadOrGenerateUserName(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('jsoneditor_p2p_user_name')
      if (stored) return stored
      const generated = 'Dev ' + Math.floor(100 + Math.random() * 900)
      localStorage.setItem('jsoneditor_p2p_user_name', generated)
      return generated
    }
    return 'Dev ' + Math.floor(100 + Math.random() * 900)
  }

  private loadOrGenerateUserColor(): string {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('jsoneditor_p2p_user_color')
      if (stored) return stored
      const generated = getRandomColor()
      localStorage.setItem('jsoneditor_p2p_user_color', generated)
      return generated
    }
    return getRandomColor()
  }

  public setUserName(name: string) {
    this.userName = name.trim() || 'Dev'
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('jsoneditor_p2p_user_name', this.userName)
    }
    this.webrtc.userName = this.userName
    this.syncProfileToGroups()
    this.updateLocalAwareness({})
    this.emitStateChange()
  }

  public setUserColor(color: string) {
    this.userColor = color
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('jsoneditor_p2p_user_color', this.userColor)
    }
    this.webrtc.userColor = this.userColor
    this.syncProfileToGroups()
    this.updateLocalAwareness({})
    this.emitStateChange()
  }

  /**
   * Synchronizes user's current profile (name and color) across all active folder groups
   * and broadcasts the update to peers via Yjs CRDT and awareness.
   */
  private syncProfileToGroups() {
    for (const [folderId, doc] of this.folderDocs.entries()) {
      const yMembers = doc.getMap('members')
      const existing = yMembers.get(this.localPeerId) as GroupMember | undefined
      if (existing) {
        doc.transact(() => {
          yMembers.set(this.localPeerId, {
            ...existing,
            userName: this.userName,
            color: this.userColor,
            lastSeen: Date.now()
          })
        }, 'local-profile-sync')
        this.notifyFolderGroupChange(folderId)
      }
    }

    const rootMembers = this.ydoc.getMap('members')
    const rootExisting = rootMembers.get(this.localPeerId) as GroupMember | undefined
    if (rootExisting) {
      this.ydoc.transact(() => {
        rootMembers.set(this.localPeerId, {
          ...rootExisting,
          userName: this.userName,
          color: this.userColor,
          lastSeen: Date.now()
        })
      }, 'local-profile-sync')
      this.notifyGroupChange()
    }
  }

  /**
   * Sets up Yjs Document update listeners and broadcasts incremental CRDT updates.
   */
  private bindYjsEvents() {
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      // If the update was generated locally (not received from a remote peer or local snapshot sync)
      if (origin !== 'remote') {
        if (this.webrtc.isSyncEnabled()) {
          const encoder = encoding.createEncoder()
          syncProtocol.writeUpdate(encoder, update)
          this.webrtc.broadcastBinary(MSG_SYNC, encoding.toUint8Array(encoder))
        }
      }

      // Check if local peer was banned in group
      const yGroup = this.ydoc.getMap('group')
      const banned = (yGroup.get('bannedPeerIds') as string[]) || []
      if (banned.includes(this.localPeerId)) {
        this.handleKicked('Você foi removido do grupo pelo administrador.')
        return
      }

      // If updated from remote peer, notify subscribers to refresh reactive views
      if (origin === 'remote' && !this.isSyncingFromLocal) {
        const snapshot = this.exportWorkspaceSnapshot()
        for (const cb of this.remoteChangeCallbacks) {
          cb(snapshot)
        }
      }

      this.notifyGroupChange()
    })
  }

  /**
   * Binds awareness state updates and broadcasts presence to peers.
   */
  private bindAwarenessEvents() {
    this.awareness.on(
      'change',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changedClients = added.concat(updated, removed)
        const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
        this.webrtc.broadcastBinary(MSG_AWARENESS, update)

        this.notifyPresenceChange()
      }
    )
  }

  public updateLocalAwareness(patch: {
    cursor?: { x: number; y: number }
    activeTabId?: number
    activePrimaryTabId?: number
    activeNodeId?: string
  }) {
    const current = this.awareness.getLocalState() || {}
    this.awareness.setLocalState({
      ...current,
      user: {
        peerId: this.localPeerId,
        userName: this.userName,
        color: this.userColor
      },
      ...patch,
      lastSeen: Date.now()
    })
  }

  public getActivePresences(): UserPresence[] {
    const presences: UserPresence[] = []
    const states = this.awareness.getStates()

    for (const [clientId, state] of states) {
      if (clientId === this.ydoc.clientID) continue // Skip local user in remote list
      const u = state.user as { peerId?: string; userName?: string; color?: string } | undefined
      if (u) {
        presences.push({
          clientId,
          peerId: u.peerId || String(clientId),
          userName: u.userName || 'Peer',
          color: u.color || '#3b82f6',
          cursor: state.cursor,
          activeTabId: state.activeTabId,
          activePrimaryTabId: state.activePrimaryTabId,
          activeNodeId: state.activeNodeId,
          lastSeen: state.lastSeen || Date.now()
        })
      }
    }

    return presences
  }

  private notifyPresenceChange() {
    const list = this.getActivePresences()
    for (const cb of this.presenceCallbacks) {
      cb(list)
    }
  }

  private emitStateChange() {
    const peers = this.webrtc.getPeers()
    const openPeers = peers.filter((p) => p.dataChannelState === 'open')
    const status = openPeers.length > 0 ? 'connected' : peers.length > 0 ? 'connecting' : 'offline'

    const state: P2PWorkspaceState = {
      status,
      peerCount: openPeers.length,
      peers,
      presences: this.getActivePresences(),
      persistedLocally: this.persistedLocally,
      autoSync: this.webrtc.isSyncEnabled(),
      group: this.getGroupInfo()
    }

    for (const cb of this.statusCallbacks) {
      cb(state)
    }
  }

  /**
   * Handles remote Yjs binary sync protocol messages for global workspace.
   */
  private handleRemoteSyncMessage(peerId: string, decoder: decoding.Decoder) {
    const encoder = encoding.createEncoder()
    syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, 'remote')
    if (encoding.length(encoder) > 0) {
      this.webrtc.sendBinaryTo(peerId, MSG_SYNC, encoding.toUint8Array(encoder))
    }
  }

  /**
   * Handles remote Yjs binary sync protocol messages strictly scoped to a folder.
   * Completely isolated: incoming updates apply only to this folder's doc.
   */
  private handleRemoteFolderSyncMessage(
    peerId: string,
    decoder: decoding.Decoder,
    folderId: number | string
  ) {
    const doc = this.getFolderDoc(folderId)
    const encoder = encoding.createEncoder()
    syncProtocol.readSyncMessage(decoder, encoder, doc, 'remote')
    if (encoding.length(encoder) > 0) {
      this.webrtc.sendBinaryTo(peerId, MSG_SYNC, encoding.toUint8Array(encoder))
    }
  }

  /**
   * Handles remote awareness updates.
   */
  private handleRemoteAwarenessMessage(update: Uint8Array) {
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, 'remote')
  }

  /**
   * Initial synchronization handshake when a DataChannel opens.
   */
  public onPeerDataChannelOpened(peerId: string, roomId?: string, folderId?: number | string) {
    if (folderId !== undefined) {
      // Handshake strictly for the shared folder
      const doc = this.getFolderDoc(folderId)
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, doc)
      this.webrtc.sendBinaryTo(peerId, MSG_SYNC, encoding.toUint8Array(encoder))
    } else {
      // 1. Send Sync Step 1 to exchange missing document vectors
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, this.ydoc)
      this.webrtc.sendBinaryTo(peerId, MSG_SYNC, encoding.toUint8Array(encoder))
    }

    // 2. Send local awareness state
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
      this.ydoc.clientID
    ])
    this.webrtc.sendBinaryTo(peerId, MSG_AWARENESS, awarenessUpdate)

    // 3. Announce in gossip mesh
    this.gossip.announcePresence()
    this.emitStateChange()
  }

  /**
   * Imports a complete StoredWorkspace snapshot into Yjs CRDT maps transactionally.
   */
  public importWorkspaceSnapshot(workspace: StoredWorkspace) {
    this.isSyncingFromLocal = true
    try {
      this.ydoc.transact(() => {
        const yMeta = this.ydoc.getMap('meta')
        yMeta.set('version', workspace.version)
        yMeta.set('nextTabId', workspace.nextTabId)
        if (workspace.nextPrimaryTabId !== undefined) {
          yMeta.set('nextPrimaryTabId', workspace.nextPrimaryTabId)
        }
        if (workspace.nextPaneId !== undefined) {
          yMeta.set('nextPaneId', workspace.nextPaneId)
        }
        if (workspace.nextNodeId !== undefined) {
          yMeta.set('nextNodeId', workspace.nextNodeId)
        }
        if (workspace.activePrimaryTabId !== undefined) {
          yMeta.set('activePrimaryTabId', workspace.activePrimaryTabId)
        }
        if (workspace.layout) {
          yMeta.set('layout', JSON.stringify(workspace.layout))
        }
        if (workspace.splitDir) {
          yMeta.set('splitDir', workspace.splitDir)
        }

        const yTabs = this.ydoc.getMap('tabs')
        yTabs.clear()
        for (const tab of workspace.tabs) {
          yTabs.set(String(tab.id), tab)
        }

        const yPrimaryTabs = this.ydoc.getMap('primaryTabs')
        yPrimaryTabs.clear()
        if (workspace.primaryTabs) {
          for (const pTab of workspace.primaryTabs) {
            yPrimaryTabs.set(String(pTab.id), pTab)
          }
        }

        const yPanes = this.ydoc.getMap('panes')
        if (workspace.panePrimaryMap) {
          yPanes.set('panePrimaryMap', workspace.panePrimaryMap)
        }
        if (workspace.paneActivePrimaryMap) {
          yPanes.set('paneActivePrimaryMap', workspace.paneActivePrimaryMap)
        }
      }, 'local-import')
    } finally {
      this.isSyncingFromLocal = false
    }
  }

  /**
   * Exports the current Yjs CRDT maps into a consistent StoredWorkspace snapshot.
   */
  public exportWorkspaceSnapshot(): StoredWorkspace {
    const yMeta = this.ydoc.getMap('meta')
    const yTabs = this.ydoc.getMap('tabs')
    const yPrimaryTabs = this.ydoc.getMap('primaryTabs')
    const yPanes = this.ydoc.getMap('panes')

    const tabs: StoredWorkspaceTab[] = []
    yTabs.forEach((val) => {
      if (val) tabs.push(val as StoredWorkspaceTab)
    })
    tabs.sort((a, b) => a.id - b.id)

    const primaryTabs: StoredPrimaryTab[] = []
    yPrimaryTabs.forEach((val) => {
      if (val) primaryTabs.push(val as StoredPrimaryTab)
    })
    primaryTabs.sort((a, b) => a.id - b.id)

    const rawLayout = yMeta.get('layout') as string | undefined
    let layout = undefined
    if (rawLayout) {
      try {
        layout = JSON.parse(rawLayout)
      } catch {
        // Ignored
      }
    }

    return {
      version: (yMeta.get('version') as 1 | 2 | 3) || 3,
      tabs: tabs.length > 0 ? tabs : [],
      primaryTabs: primaryTabs.length > 0 ? primaryTabs : undefined,
      activePrimaryTabId: yMeta.get('activePrimaryTabId') as number | undefined,
      panePrimaryMap: yPanes.get('panePrimaryMap') as Record<number, number[]> | undefined,
      paneActivePrimaryMap: yPanes.get('paneActivePrimaryMap') as
        | Record<number, number>
        | undefined,
      layout,
      nextTabId: (yMeta.get('nextTabId') as number) || 1,
      nextPrimaryTabId: yMeta.get('nextPrimaryTabId') as number | undefined,
      nextPaneId: yMeta.get('nextPaneId') as number | undefined,
      nextNodeId: yMeta.get('nextNodeId') as number | undefined,
      splitDir: yMeta.get('splitDir') as 'vertical' | 'horizontal' | undefined
    }
  }

  /**
   * Synchronizes an individual spatial flow graph into CRDT.
   */
  public updateFlowGraph(
    spatialFlowId: string,
    flowData: { nodes: unknown; connections: unknown }
  ) {
    const yFlows = this.ydoc.getMap('flows')
    yFlows.set(spatialFlowId, flowData)
  }

  public subscribeRemoteChanges(cb: (ws: StoredWorkspace) => void): () => void {
    this.remoteChangeCallbacks.add(cb)
    return () => this.remoteChangeCallbacks.delete(cb)
  }

  public subscribePresence(cb: (presences: UserPresence[]) => void): () => void {
    this.presenceCallbacks.add(cb)
    cb(this.getActivePresences())
    return () => this.presenceCallbacks.delete(cb)
  }

  public subscribeStatus(cb: (state: P2PWorkspaceState) => void): () => void {
    this.statusCallbacks.add(cb)
    this.emitStateChange()
    return () => this.statusCallbacks.delete(cb)
  }

  private handleKicked(reason?: string) {
    const finalReason = reason || 'Você foi removido do grupo pelo administrador.'
    for (const cb of this.kickCallbacks) {
      cb(finalReason)
    }
    this.leaveGroup(false)
  }

  public isAutoSyncEnabled(): boolean {
    return this.webrtc.isSyncEnabled()
  }

  public setAutoSyncEnabled(enabled: boolean): void {
    this.webrtc.setSyncEnabled(enabled)
    if (enabled) {
      this.flushPendingSync()
    }
    this.emitStateChange()
    this.notifyGroupChange()
  }

  /**
   * Forces a full synchronization step with all connected peers immediately.
   */
  public flushPendingSync(): void {
    const peers = this.webrtc.getPeers()
    for (const p of peers) {
      if (p.dataChannelState === 'open') {
        const encoder = encoding.createEncoder()
        syncProtocol.writeSyncStep1(encoder, this.ydoc)
        this.webrtc.sendBinaryTo(p.peerId, MSG_SYNC, encoding.toUint8Array(encoder))
      }
    }
    // Broadcast full document state to mesh
    const update = Y.encodeStateAsUpdate(this.ydoc)
    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, update)
    this.webrtc.broadcastBinary(MSG_SYNC, encoding.toUint8Array(encoder))
  }

  /**
   * Creates a new collaborative group with the local user as the Owner/Host.
   */
  public createGroup(groupName: string): GroupInfo {
    const cleanName = groupName.trim() || 'Equipe'
    const groupId = 'grp_' + Math.random().toString(36).slice(2, 9)

    this.ydoc.transact(() => {
      const yGroup = this.ydoc.getMap('group')
      yGroup.set('groupId', groupId)
      yGroup.set('groupName', cleanName)
      yGroup.set('ownerPeerId', this.localPeerId)
      yGroup.set('createdAt', Date.now())
      yGroup.set('bannedPeerIds', [])

      const yMembers = this.ydoc.getMap('members')
      yMembers.clear()
      const ownerMember: GroupMember = {
        peerId: this.localPeerId,
        userName: this.userName,
        color: this.userColor,
        role: 'owner',
        joinedAt: Date.now(),
        lastSeen: Date.now()
      }
      yMembers.set(this.localPeerId, ownerMember)
    }, 'local-create-group')

    this.notifyGroupChange()
    this.emitStateChange()
    return this.getGroupInfo()!
  }

  /**
   * Registers current user as a member in the active group.
   */
  public joinGroup(groupId: string, groupName?: string) {
    this.ydoc.transact(() => {
      const yGroup = this.ydoc.getMap('group')
      if (!yGroup.get('groupId')) {
        yGroup.set('groupId', groupId)
        if (groupName) yGroup.set('groupName', groupName)
      }

      const yMembers = this.ydoc.getMap('members')
      const member: GroupMember = {
        peerId: this.localPeerId,
        userName: this.userName,
        color: this.userColor,
        role: 'member',
        joinedAt: Date.now(),
        lastSeen: Date.now()
      }
      yMembers.set(this.localPeerId, member)
    }, 'local-join-group')

    this.notifyGroupChange()
    this.emitStateChange()
  }

  /**
   * Leaves the group and resets local collaborative session.
   */
  public leaveGroup(notifyPeers = true) {
    if (notifyPeers) {
      this.ydoc.transact(() => {
        const yMembers = this.ydoc.getMap('members')
        yMembers.delete(this.localPeerId)
      }, 'local-leave-group')
      this.webrtc.leaveGroup()
    }

    this.ydoc.transact(() => {
      const yGroup = this.ydoc.getMap('group')
      yGroup.clear()
      const yMembers = this.ydoc.getMap('members')
      yMembers.clear()
    }, 'local-clear-group')

    this.notifyGroupChange()
    this.emitStateChange()
  }

  /**
   * Kicks/deletes a member from the group.
   * Only permitted for the group owner.
   */
  public kickMember(peerId: string, reason = 'Removido pelo criador do grupo') {
    const group = this.getGroupInfo()
    if (!group || !group.isOwner) {
      throw new Error('Apenas o criador do grupo pode remover membros.')
    }

    if (peerId === this.localPeerId) {
      throw new Error('Você não pode remover a si mesmo do próprio grupo.')
    }

    this.ydoc.transact(() => {
      const yMembers = this.ydoc.getMap('members')
      yMembers.delete(peerId)

      const yGroup = this.ydoc.getMap('group')
      const banned = (yGroup.get('bannedPeerIds') as string[]) || []
      if (!banned.includes(peerId)) {
        yGroup.set('bannedPeerIds', [...banned, peerId])
      }
    }, 'local-kick-member')

    this.webrtc.kickPeer(peerId, reason)
    this.notifyGroupChange()
    this.emitStateChange()
  }

  /**
   * Returns current active group information and member list.
   */
  public getGroupInfo(): GroupInfo | null {
    const yGroup = this.ydoc.getMap('group')
    const groupId = yGroup.get('groupId') as string | undefined
    if (!groupId) return null

    const groupName = (yGroup.get('groupName') as string) || 'Equipe'
    const ownerPeerId = (yGroup.get('ownerPeerId') as string) || ''
    const createdAt = (yGroup.get('createdAt') as number) || Date.now()
    const bannedPeerIds = (yGroup.get('bannedPeerIds') as string[]) || []

    const yMembers = this.ydoc.getMap('members')
    const members: GroupMember[] = []
    yMembers.forEach((val) => {
      if (val) {
        const m = val as GroupMember
        const isLocal = m.peerId === this.localPeerId
        members.push({
          ...m,
          userName: isLocal ? this.userName : m.userName,
          color: isLocal ? this.userColor : m.color,
          isLocal
        })
      }
    })

    // If local user is in group but not yet listed in members map, include them
    if (!members.some((m) => m.peerId === this.localPeerId)) {
      members.push({
        peerId: this.localPeerId,
        userName: this.userName,
        color: this.userColor,
        role: this.localPeerId === ownerPeerId ? 'owner' : 'member',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        isLocal: true
      })
    }

    return {
      groupId,
      groupName,
      ownerPeerId,
      isOwner: this.localPeerId === ownerPeerId,
      createdAt,
      bannedPeerIds,
      members,
      autoSync: this.webrtc.isSyncEnabled()
    }
  }

  private notifyGroupChange() {
    const info = this.getGroupInfo()
    for (const cb of this.groupCallbacks) {
      cb(info)
    }
  }

  public subscribeGroup(cb: (info: GroupInfo | null) => void): () => void {
    this.groupCallbacks.add(cb)
    cb(this.getGroupInfo())
    return () => this.groupCallbacks.delete(cb)
  }

  public onKicked(cb: (reason: string) => void): () => void {
    this.kickCallbacks.add(cb)
    return () => this.kickCallbacks.delete(cb)
  }

  public getFolderDoc(folderId: number | string): Y.Doc {
    const key = String(folderId)
    const existing = this.folderDocs.get(key)
    if (existing) return existing

    const doc = new Y.Doc({ guid: `svelte-jsoneditor-folder-${key}` })
    this.folderDocs.set(key, doc)

    if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      try {
        const persistence = new IndexeddbPersistence(`svelte-jsoneditor-folder-crdt-${key}`, doc)
        this.folderPersistences.set(key, persistence)
      } catch {
        // Fallback for restricted storage environments
      }
    }

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') {
        const autoSync = this.folderAutoSync.get(key) ?? this.webrtc.isSyncEnabled()
        if (autoSync) {
          const encoder = encoding.createEncoder()
          syncProtocol.writeUpdate(encoder, update)
          this.webrtc.broadcastBinaryToFolder(folderId, MSG_SYNC, encoding.toUint8Array(encoder))
        }
      }

      const yGroup = doc.getMap('group')
      const banned = (yGroup.get('bannedPeerIds') as string[]) || []
      if (banned.includes(this.localPeerId)) {
        this.handleKicked('Você foi removido do grupo da pasta pelo administrador.')
        this.leaveFolderGroup(folderId, false)
        return
      }

      if (origin === 'remote') {
        const snapshot = this.exportFolderSnapshot(folderId)
        if (snapshot) {
          for (const cb of this.remoteFolderChangeCallbacks) {
            cb(folderId, snapshot)
          }
        }
      }

      this.notifyFolderGroupChange(folderId)
    })

    return doc
  }

  public getFolderGroup(folderId: number | string): GroupInfo | null {
    const key = String(folderId)
    const doc = this.getFolderDoc(folderId)
    const yGroup = doc.getMap('group')
    const groupId = yGroup.get('groupId') as string | undefined
    if (!groupId) return null

    const groupName = (yGroup.get('groupName') as string) || 'Equipe'
    const ownerPeerId = (yGroup.get('ownerPeerId') as string) || ''
    const createdAt = (yGroup.get('createdAt') as number) || Date.now()
    const bannedPeerIds = (yGroup.get('bannedPeerIds') as string[]) || []

    const yMembers = doc.getMap('members')
    const members: GroupMember[] = []
    yMembers.forEach((val) => {
      if (val) {
        const m = val as GroupMember
        const isLocal = m.peerId === this.localPeerId
        members.push({
          ...m,
          userName: isLocal ? this.userName : m.userName,
          color: isLocal ? this.userColor : m.color,
          isLocal
        })
      }
    })

    if (!members.some((m) => m.peerId === this.localPeerId)) {
      members.push({
        peerId: this.localPeerId,
        userName: this.userName,
        color: this.userColor,
        role: this.localPeerId === ownerPeerId ? 'owner' : 'member',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        isLocal: true
      })
    }

    const autoSync = this.folderAutoSync.get(key) ?? this.webrtc.isSyncEnabled()

    return {
      groupId,
      groupName,
      ownerPeerId,
      isOwner: this.localPeerId === ownerPeerId,
      createdAt,
      bannedPeerIds,
      members,
      autoSync
    }
  }

  public createFolderGroup(
    folderId: number | string,
    folderName: string,
    groupName: string
  ): GroupInfo {
    const cleanName = groupName.trim() || 'Equipe'
    const groupId = 'grp_' + Math.random().toString(36).slice(2, 9)
    const doc = this.getFolderDoc(folderId)

    doc.transact(() => {
      const yGroup = doc.getMap('group')
      yGroup.set('groupId', groupId)
      yGroup.set('groupName', cleanName)
      yGroup.set('folderId', folderId)
      yGroup.set('folderName', folderName)
      yGroup.set('ownerPeerId', this.localPeerId)
      yGroup.set('createdAt', Date.now())
      yGroup.set('bannedPeerIds', [])

      const yMembers = doc.getMap('members')
      yMembers.clear()
      const ownerMember: GroupMember = {
        peerId: this.localPeerId,
        userName: this.userName,
        color: this.userColor,
        role: 'owner',
        joinedAt: Date.now(),
        lastSeen: Date.now()
      }
      yMembers.set(this.localPeerId, ownerMember)
    }, 'local-create-folder-group')

    this.notifyFolderGroupChange(folderId)
    this.emitStateChange()
    return this.getFolderGroup(folderId)!
  }

  public joinFolderGroup(
    folderId: number | string,
    groupId: string,
    groupName?: string,
    folderName?: string
  ) {
    const doc = this.getFolderDoc(folderId)
    doc.transact(() => {
      const yGroup = doc.getMap('group')
      if (!yGroup.get('groupId')) {
        yGroup.set('groupId', groupId)
        if (groupName) yGroup.set('groupName', groupName)
        if (folderName) yGroup.set('folderName', folderName)
        yGroup.set('folderId', folderId)
      }

      const yMembers = doc.getMap('members')
      const member: GroupMember = {
        peerId: this.localPeerId,
        userName: this.userName,
        color: this.userColor,
        role: 'member',
        joinedAt: Date.now(),
        lastSeen: Date.now()
      }
      yMembers.set(this.localPeerId, member)
    }, 'local-join-folder-group')

    this.notifyFolderGroupChange(folderId)
    this.emitStateChange()
  }

  public leaveFolderGroup(folderId: number | string, notifyPeers = true) {
    const doc = this.getFolderDoc(folderId)
    if (notifyPeers) {
      doc.transact(() => {
        const yMembers = doc.getMap('members')
        yMembers.delete(this.localPeerId)
      }, 'local-leave-folder-group')
    }

    doc.transact(() => {
      const yGroup = doc.getMap('group')
      yGroup.clear()
      const yMembers = doc.getMap('members')
      yMembers.clear()
    }, 'local-clear-folder-group')

    this.notifyFolderGroupChange(folderId)
    this.emitStateChange()
  }

  public kickFolderMember(
    folderId: number | string,
    peerId: string,
    reason = 'Removido pelo criador da pasta'
  ) {
    const group = this.getFolderGroup(folderId)
    if (!group || !group.isOwner) {
      throw new Error('Apenas o criador do grupo da pasta pode remover membros.')
    }

    if (peerId === this.localPeerId) {
      throw new Error('Você não pode remover a si mesmo da própria pasta.')
    }

    const doc = this.getFolderDoc(folderId)
    doc.transact(() => {
      const yMembers = doc.getMap('members')
      yMembers.delete(peerId)

      const yGroup = doc.getMap('group')
      const banned = (yGroup.get('bannedPeerIds') as string[]) || []
      if (!banned.includes(peerId)) {
        yGroup.set('bannedPeerIds', [...banned, peerId])
      }
    }, 'local-kick-folder-member')

    this.webrtc.kickPeer(peerId, reason)
    this.notifyFolderGroupChange(folderId)
    this.emitStateChange()
  }

  public syncLocalFolder(
    folderId: number | string,
    primaryTab: StoredPrimaryTab,
    tabs: StoredWorkspaceTab[]
  ) {
    const doc = this.getFolderDoc(folderId)
    doc.transact(() => {
      const yPrimary = doc.getMap('primaryTab')
      yPrimary.set('id', primaryTab.id)
      yPrimary.set('title', primaryTab.title)
      yPrimary.set('subTabIds', primaryTab.subTabIds)
      yPrimary.set('activeSubTabId', primaryTab.activeSubTabId)
      if (primaryTab.requestState) {
        yPrimary.set('requestState', primaryTab.requestState)
      }
      if (primaryTab.flowGroups) {
        yPrimary.set('flowGroups', primaryTab.flowGroups)
      }
      if (primaryTab.spatialFlows) {
        yPrimary.set('spatialFlows', primaryTab.spatialFlows)
      }
      if (primaryTab.activeSpatialFlowId) {
        yPrimary.set('activeSpatialFlowId', primaryTab.activeSpatialFlowId)
      }

      const yTabs = doc.getMap('tabs')
      yTabs.clear()
      for (const t of tabs) {
        yTabs.set(String(t.id), t)
      }
    }, 'local-folder-sync')
  }

  public exportFolderSnapshot(folderId: number | string): {
    primaryTab?: StoredPrimaryTab
    tabs: StoredWorkspaceTab[]
  } | null {
    const key = String(folderId)
    if (!this.folderDocs.has(key)) return null
    const doc = this.folderDocs.get(key)!
    const yPrimary = doc.getMap('primaryTab')
    const yTabs = doc.getMap('tabs')

    const tabs: StoredWorkspaceTab[] = []
    yTabs.forEach((val) => {
      if (val) tabs.push(val as StoredWorkspaceTab)
    })
    tabs.sort((a, b) => a.id - b.id)

    const id = yPrimary.get('id') as number | undefined
    if (id === undefined && tabs.length === 0) return null

    const pTab: StoredPrimaryTab = {
      id: (id ?? Number(folderId)) || 1,
      title: (yPrimary.get('title') as string) || 'Pasta Compartilhada',
      subTabIds: (yPrimary.get('subTabIds') as number[]) || tabs.map((t) => t.id),
      activeSubTabId: (yPrimary.get('activeSubTabId') as number) || tabs[0]?.id || 1,
      requestState: yPrimary.get('requestState') as StoredPrimaryTab['requestState'],
      flowGroups: yPrimary.get('flowGroups') as StoredPrimaryTab['flowGroups'],
      spatialFlows: yPrimary.get('spatialFlows') as StoredPrimaryTab['spatialFlows'],
      activeSpatialFlowId: yPrimary.get('activeSpatialFlowId') as string | undefined
    }

    return {
      primaryTab: pTab,
      tabs
    }
  }

  public subscribeRemoteFolderChanges(
    cb: (
      folderId: number | string,
      data: { primaryTab?: StoredPrimaryTab; tabs: StoredWorkspaceTab[] }
    ) => void
  ): () => void {
    this.remoteFolderChangeCallbacks.add(cb)
    return () => this.remoteFolderChangeCallbacks.delete(cb)
  }

  public subscribeFolderGroup(
    folderId: number | string,
    cb: (info: GroupInfo | null) => void
  ): () => void {
    const key = String(folderId)
    if (!this.folderGroupCallbacks.has(key)) {
      this.folderGroupCallbacks.set(key, new Set())
    }
    this.folderGroupCallbacks.get(key)!.add(cb)
    cb(this.getFolderGroup(folderId))
    return () => {
      this.folderGroupCallbacks.get(key)?.delete(cb)
    }
  }

  private notifyFolderGroupChange(folderId: number | string) {
    const key = String(folderId)
    const info = this.getFolderGroup(folderId)
    const set = this.folderGroupCallbacks.get(key)
    if (set) {
      for (const cb of set) {
        cb(info)
      }
    }
    this.emitStateChange()
  }

  public isFolderAutoSyncEnabled(folderId: number | string): boolean {
    return this.folderAutoSync.get(String(folderId)) ?? this.webrtc.isSyncEnabled()
  }

  public setFolderAutoSyncEnabled(folderId: number | string, enabled: boolean): void {
    this.folderAutoSync.set(String(folderId), enabled)
    if (enabled) {
      this.flushFolderSync(folderId)
    }
    this.notifyFolderGroupChange(folderId)
    this.emitStateChange()
  }

  public flushFolderSync(folderId: number | string): void {
    const doc = this.getFolderDoc(folderId)
    const peers = this.webrtc.getPeersForFolder(folderId)
    for (const p of peers) {
      if (p.dataChannelState === 'open') {
        const encoder = encoding.createEncoder()
        syncProtocol.writeSyncStep1(encoder, doc)
        this.webrtc.sendBinaryTo(p.peerId, MSG_SYNC, encoding.toUint8Array(encoder))
      }
    }
    const update = Y.encodeStateAsUpdate(doc)
    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, update)
    this.webrtc.broadcastBinaryToFolder(folderId, MSG_SYNC, encoding.toUint8Array(encoder))
  }

  public destroy() {
    this.webrtc.destroy()
    if (this.persistence) {
      this.persistence.destroy()
    }
    for (const p of this.folderPersistences.values()) {
      p.destroy()
    }
    for (const doc of this.folderDocs.values()) {
      doc.destroy()
    }
    this.ydoc.destroy()
  }
}

// Global Singleton for easy cross-component access in Svelte
let instance: YjsWorkspaceManager | null = null

export function getYjsWorkspace(): YjsWorkspaceManager {
  if (!instance) {
    instance = new YjsWorkspaceManager()
  }
  return instance
}
