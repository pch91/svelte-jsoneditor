/**
 * WebRTC DataChannel Manager for serverless P2P CRDT sync.
 *
 * Establishes and manages direct browser-to-browser DataChannels with STUN NAT traversal.
 * Handles binary transport for Yjs sync steps, awareness states, and gossip routing.
 */

import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import { encoding, decoding } from 'lib0'
import {
  compressPayload,
  decompressPayload,
  type SignalingPayload
} from './sdpToken.js'
import { P2PCryptoEngine } from './p2pCrypto.js'

export const MSG_SYNC = 0
export const MSG_AWARENESS = 1
export const MSG_GOSSIP = 2
export const MSG_PING = 3
export const MSG_PONG = 4

export interface PeerInfo {
  peerId: string
  userName: string
  color: string
  connectionState: RTCPeerConnectionState
  dataChannelState: RTCDataChannelState
  latencyMs?: number
  connectedAt: number
  roomId?: string
  folderId?: number | string
  folderName?: string
  isE2ee?: boolean
  sasFingerprint?: string
  epoch?: string
}

export interface GossipMessage {
  type: 'gossip-relay' | 'peer-announce' | 'peer-leave' | 'gossip-key'
  originPeerId: string
  targetPeerId?: string
  payload?: unknown
  messageId: string
  hops: number
}

export type ConnectionStateChangeCallback = (state: {
  status: 'offline' | 'connecting' | 'connected'
  peers: PeerInfo[]
}) => void

export interface WebRtcManagerConfig {
  localPeerId: string
  userName: string
  userColor: string
  iceServers?: RTCIceServer[]
  onSyncMessage?: (peerId: string, decoder: decoding.Decoder, roomId?: string, folderId?: number | string) => void
  onAwarenessMessage?: (peerId: string, update: Uint8Array, roomId?: string, folderId?: number | string) => void
  onGossipMessage?: (fromPeerId: string, message: GossipMessage) => void
  onStatusChange?: ConnectionStateChangeCallback
  onKicked?: (reason?: string) => void
  onDataChannelOpen?: (peerId: string, roomId?: string, folderId?: number | string) => void
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
]

export class WebRtcManager {
  public localPeerId: string
  public userName: string
  public userColor: string
  private iceServers: RTCIceServer[]

  private peers = new Map<
    string,
    {
      pc: RTCPeerConnection
      dc?: RTCDataChannel
      info: PeerInfo
      lastPing?: number
    }
  >()

  // Pending connection waiting for remote answer
  private pendingOfferPc: RTCPeerConnection | null = null
  private pendingOfferDc: RTCDataChannel | null = null
  private pendingRoomId: string = 'default-room'
  private pendingFolderId?: number | string
  private pendingFolderName?: string
  private pendingGroupName?: string

  private bannedPeerIds = new Set<string>()
  private syncEnabled = true
  public crypto: P2PCryptoEngine = new P2PCryptoEngine()
  private onSyncMessage?: (peerId: string, decoder: decoding.Decoder, roomId?: string, folderId?: number | string) => void
  private onAwarenessMessage?: (peerId: string, update: Uint8Array, roomId?: string, folderId?: number | string) => void
  private onGossipMessage?: (fromPeerId: string, message: GossipMessage) => void
  private onStatusChange?: ConnectionStateChangeCallback
  private onKicked?: (reason?: string) => void
  private onDataChannelOpen?: (peerId: string, roomId?: string, folderId?: number | string) => void

  constructor(config: WebRtcManagerConfig) {
    this.localPeerId = config.localPeerId
    this.userName = config.userName
    this.userColor = config.userColor
    this.iceServers = config.iceServers || DEFAULT_ICE_SERVERS
    this.onSyncMessage = config.onSyncMessage
    this.onAwarenessMessage = config.onAwarenessMessage
    this.onGossipMessage = config.onGossipMessage
    this.onStatusChange = config.onStatusChange
    this.onKicked = config.onKicked
    this.onDataChannelOpen = config.onDataChannelOpen
  }

  public getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).map((p) => p.info)
  }

  public getConnectedPeerCount(): number {
    return Array.from(this.peers.values()).filter(
      (p) => p.dc?.readyState === 'open'
    ).length
  }

  private notifyStatusChange() {
    if (!this.onStatusChange) return
    const peerList = this.getPeers()
    const openCount = peerList.filter(
      (p) => p.dataChannelState === 'open'
    ).length

    const status =
      openCount > 0 ? 'connected' : this.pendingOfferPc ? 'connecting' : 'offline'

    this.onStatusChange({
      status,
      peers: peerList
    })
  }

  /**
   * Helper to wait for ICE candidates gathering to finish.
   */
  private waitForIceGathering(
    pc: RTCPeerConnection,
    timeoutMs = 2500
  ): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve()
        return
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          pc.removeEventListener('icegatheringstatechange', checkState)
          resolve()
        }
      }

      pc.addEventListener('icegatheringstatechange', checkState)

      timeoutHandle = setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState)
        resolve() // Resolve anyway with current candidates gathered so far
      }, timeoutMs)
    })
  }

  /**
   * Creates an SDP Offer for inviting a new peer or joining a room.
   * Returns a compressed SDP Token string.
   */
  public async createOfferToken(
    roomId = 'default-room',
    folderId?: number | string,
    folderName?: string,
    groupName?: string
  ): Promise<string> {
    if (this.pendingOfferPc) {
      this.pendingOfferPc.close()
      this.pendingOfferPc = null
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pendingOfferPc = pc
    this.pendingRoomId = roomId
    this.pendingFolderId = folderId
    this.pendingFolderName = folderName
    this.pendingGroupName = groupName

    const dc = pc.createDataChannel('p2p-sync', {
      ordered: true
    })
    dc.binaryType = 'arraybuffer'
    this.pendingOfferDc = dc

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    await this.waitForIceGathering(pc)

    const dailyKey = await this.crypto.getOrCreateDailyKeyPair()

    const payload: SignalingPayload = {
      type: 'offer',
      sdp: pc.localDescription?.sdp || '',
      peerId: this.localPeerId,
      roomId,
      folderId,
      folderName,
      groupName,
      userName: this.userName,
      timestamp: Date.now(),
      publicKeyJwk: dailyKey.publicKeyJwk,
      epoch: dailyKey.epoch
    }

    this.notifyStatusChange()
    return await compressPayload(payload)
  }

  /**
   * Accepts an incoming SDP Offer token and creates an SDP Answer token.
   */
  public async acceptOfferToken(offerToken: string): Promise<string> {
    const payload = await decompressPayload(offerToken)
    if (payload.type !== 'offer') {
      throw new Error(`Invalid token type: expected 'offer', got '${payload.type}'`)
    }

    const remotePeerId = payload.peerId
    if (remotePeerId === this.localPeerId) {
      throw new Error('Não é possível conectar a si mesmo (mesmo PeerId)')
    }
    if (this.bannedPeerIds.has(remotePeerId)) {
      throw new Error('Peer foi removido ou banido do grupo.')
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })

    let sasFingerprint: string | undefined
    let isE2ee = false
    const myDailyKey = await this.crypto.getOrCreateDailyKeyPair()

    if (payload.publicKeyJwk) {
      try {
        await this.crypto.deriveSharedSecret(remotePeerId, payload.publicKeyJwk, payload.epoch)
        sasFingerprint = await P2PCryptoEngine.generateSasFingerprint(
          myDailyKey.publicKeyJwk,
          payload.publicKeyJwk
        )
        isE2ee = true
      } catch (err) {
        console.warn('Falha ao derivar segredo E2EE com par remoto:', err)
      }
    }

    const peerInfo: PeerInfo = {
      peerId: remotePeerId,
      userName: payload.userName || 'Peer ' + remotePeerId.slice(0, 4),
      color: '#' + remotePeerId.slice(0, 6),
      connectionState: pc.connectionState,
      dataChannelState: 'connecting',
      connectedAt: Date.now(),
      roomId: payload.roomId,
      folderId: payload.folderId,
      folderName: payload.folderName,
      isE2ee,
      sasFingerprint,
      epoch: payload.epoch
    }

    this.peers.set(remotePeerId, { pc, info: peerInfo })

    pc.ondatachannel = (event) => {
      const dc = event.channel
      dc.binaryType = 'arraybuffer'
      this.setupDataChannel(remotePeerId, dc)
    }

    this.setupPeerConnectionEvents(remotePeerId, pc)

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: payload.sdp })
    )

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    await this.waitForIceGathering(pc)

    const answerPayload: SignalingPayload = {
      type: 'answer',
      sdp: pc.localDescription?.sdp || '',
      peerId: this.localPeerId,
      targetPeerId: remotePeerId,
      roomId: payload.roomId,
      folderId: payload.folderId,
      folderName: payload.folderName,
      groupName: payload.groupName,
      userName: this.userName,
      timestamp: Date.now(),
      publicKeyJwk: myDailyKey.publicKeyJwk,
      epoch: myDailyKey.epoch,
      sasFingerprint
    }

    this.notifyStatusChange()
    return await compressPayload(answerPayload)
  }

  /**
   * Completes the handshake by accepting an SDP Answer token.
   */
  public async acceptAnswerToken(answerToken: string): Promise<void> {
    const payload = await decompressPayload(answerToken)
    if (payload.type !== 'answer') {
      throw new Error(`Invalid token type: expected 'answer', got '${payload.type}'`)
    }

    if (!this.pendingOfferPc || !this.pendingOfferDc) {
      throw new Error('Nenhuma oferta pendente encontrada para aplicar esta resposta')
    }

    const remotePeerId = payload.peerId
    const pc = this.pendingOfferPc
    const dc = this.pendingOfferDc

    const boundRoomId = payload.roomId || this.pendingRoomId
    const boundFolderId = payload.folderId ?? this.pendingFolderId
    const boundFolderName = payload.folderName ?? this.pendingFolderName

    this.pendingOfferPc = null
    this.pendingOfferDc = null

    let sasFingerprint = payload.sasFingerprint
    let isE2ee = false

    if (payload.publicKeyJwk) {
      try {
        const myDailyKey = await this.crypto.getOrCreateDailyKeyPair()
        await this.crypto.deriveSharedSecret(remotePeerId, payload.publicKeyJwk, payload.epoch)
        sasFingerprint = await P2PCryptoEngine.generateSasFingerprint(
          myDailyKey.publicKeyJwk,
          payload.publicKeyJwk
        )
        isE2ee = true
      } catch (err) {
        console.warn('Falha ao derivar segredo E2EE com par remoto:', err)
      }
    }

    const peerInfo: PeerInfo = {
      peerId: remotePeerId,
      userName: payload.userName || 'Peer ' + remotePeerId.slice(0, 4),
      color: '#' + remotePeerId.slice(0, 6),
      connectionState: pc.connectionState,
      dataChannelState: dc.readyState,
      connectedAt: Date.now(),
      roomId: boundRoomId,
      folderId: boundFolderId,
      folderName: boundFolderName,
      isE2ee,
      sasFingerprint,
      epoch: payload.epoch
    }

    this.peers.set(remotePeerId, { pc, dc, info: peerInfo })
    this.setupDataChannel(remotePeerId, dc)
    this.setupPeerConnectionEvents(remotePeerId, pc)

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
    )

    this.notifyStatusChange()
  }

  /**
   * Internal WebRTC data channel events binding.
   */
  private setupDataChannel(peerId: string, dc: RTCDataChannel) {
    const entry = this.peers.get(peerId)
    if (entry) {
      entry.dc = dc
      entry.info.dataChannelState = dc.readyState
    }

    dc.onopen = () => {
      if (entry) {
        entry.info.dataChannelState = 'open'
      }
      this.notifyStatusChange()
      this.startPingInterval(peerId)
      if (this.onDataChannelOpen) {
        this.onDataChannelOpen(peerId, entry?.info.roomId, entry?.info.folderId)
      }
    }

    dc.onclose = () => {
      if (entry) {
        entry.info.dataChannelState = 'closed'
      }
      this.notifyStatusChange()
    }

    dc.onerror = () => {
      if (entry) {
        entry.info.dataChannelState = 'closed'
      }
      this.notifyStatusChange()
    }

    dc.onmessage = (event) => {
      this.handleIncomingMessage(peerId, event.data)
    }
  }

  private setupPeerConnectionEvents(peerId: string, pc: RTCPeerConnection) {
    const entry = this.peers.get(peerId)

    pc.onconnectionstatechange = () => {
      if (entry) {
        entry.info.connectionState = pc.connectionState
      }
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        this.peers.delete(peerId)
      }
      this.notifyStatusChange()
    }
  }

  /**
   * Processes incoming binary and control packets from a peer.
   */
  private handleIncomingMessage(peerId: string, data: ArrayBuffer | string) {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'ping') {
          this.sendMessage(peerId, JSON.stringify({ type: 'pong', sentAt: parsed.sentAt }))
          return
        }
        if (parsed.type === 'pong') {
          const entry = this.peers.get(peerId)
          if (entry && parsed.sentAt) {
            entry.info.latencyMs = Math.round(Date.now() - parsed.sentAt)
            this.notifyStatusChange()
          }
          return
        }
        if (parsed.type === 'gossip-relay' && this.onGossipMessage) {
          this.onGossipMessage(peerId, parsed as GossipMessage)
          return
        }
        if (parsed.type === 'kick') {
          if (parsed.targetPeerId === this.localPeerId) {
            this.destroy()
            if (this.onKicked) {
              this.onKicked(parsed.reason || 'Você foi removido do grupo pelo administrador.')
            }
            return
          }
          if (parsed.targetPeerId) {
            this.banPeer(parsed.targetPeerId)
            const entry = this.peers.get(parsed.targetPeerId)
            if (entry) {
              entry.pc.close()
              this.peers.delete(parsed.targetPeerId)
              this.notifyStatusChange()
            }
          }
          return
        }
        if (parsed.type === 'peer-left') {
          const leavingId = parsed.peerId
          if (leavingId) {
            const entry = this.peers.get(leavingId)
            if (entry) {
              entry.pc.close()
              this.peers.delete(leavingId)
              this.notifyStatusChange()
            }
          }
          return
        }
      } catch {
        // Not a JSON string
      }
      return
    }

    const entry = this.peers.get(peerId)
    const uint8 = new Uint8Array(data)
    if (uint8.length === 0) return

    const msgType = uint8[0]
    const content = uint8.subarray(1)
    const decoder = decoding.createDecoder(content)

    switch (msgType) {
      case MSG_SYNC:
        if (!this.syncEnabled) {
          // Auto-sync in background is currently paused by the user
          return
        }
        if (this.onSyncMessage) {
          this.onSyncMessage(peerId, decoder, entry?.info.roomId, entry?.info.folderId)
        }
        break
      case MSG_AWARENESS:
        if (this.onAwarenessMessage) {
          this.onAwarenessMessage(peerId, content, entry?.info.roomId, entry?.info.folderId)
        }
        break
      case MSG_GOSSIP:
        if (this.onGossipMessage) {
          try {
            const textDecoder = new TextDecoder()
            const gossipText = textDecoder.decode(content)
            this.onGossipMessage(peerId, JSON.parse(gossipText))
          } catch {
            // Malformed gossip packet
          }
        }
        break
    }
  }

  private startPingInterval(peerId: string) {
    const interval = setInterval(() => {
      const entry = this.peers.get(peerId)
      if (!entry || entry.dc?.readyState !== 'open') {
        clearInterval(interval)
        return
      }
      entry.lastPing = Date.now()
      this.sendMessage(peerId, JSON.stringify({ type: 'ping', sentAt: entry.lastPing }))
    }, 10000)
  }

  /**
   * Broadcasts a binary buffer to all connected peers.
   */
  public broadcastBinary(messageType: number, buffer: Uint8Array) {
    const packet = new Uint8Array(buffer.length + 1)
    packet[0] = messageType
    packet.set(buffer, 1)

    for (const [, { dc }] of this.peers) {
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(packet.buffer)
        } catch {
          // Channel error or buffer full
        }
      }
    }
  }

  /**
   * Broadcasts a binary buffer strictly to peers connected to a specific folder.
   * Completely isolated: no packets bleed into other groups or folders.
   */
  public broadcastBinaryToFolder(
    folderId: number | string,
    messageType: number,
    buffer: Uint8Array
  ) {
    const packet = new Uint8Array(buffer.length + 1)
    packet[0] = messageType
    packet.set(buffer, 1)

    for (const [, { dc, info }] of this.peers) {
      if (String(info.folderId) === String(folderId) && dc && dc.readyState === 'open') {
        try {
          dc.send(packet.buffer)
        } catch {
          // Channel error or buffer full
        }
      }
    }
  }

  /**
   * Broadcasts a binary buffer strictly to peers connected to a specific room.
   */
  public broadcastBinaryToRoom(roomId: string, messageType: number, buffer: Uint8Array) {
    const packet = new Uint8Array(buffer.length + 1)
    packet[0] = messageType
    packet.set(buffer, 1)

    for (const [, { dc, info }] of this.peers) {
      if (info.roomId === roomId && dc && dc.readyState === 'open') {
        try {
          dc.send(packet.buffer)
        } catch {
          // Channel error or buffer full
        }
      }
    }
  }

  /**
   * Returns list of peers participating in a specific folder.
   */
  public getPeersForFolder(folderId: number | string): PeerInfo[] {
    return Array.from(this.peers.values())
      .filter((p) => String(p.info.folderId) === String(folderId))
      .map((p) => p.info)
  }

  /**
   * Returns list of peers participating in a specific room.
   */
  public getPeersForRoom(roomId: string): PeerInfo[] {
    return Array.from(this.peers.values())
      .filter((p) => p.info.roomId === roomId)
      .map((p) => p.info)
  }

  /**
   * Sends a binary buffer to a specific peer.
   */
  public sendBinaryTo(peerId: string, messageType: number, buffer: Uint8Array) {
    const entry = this.peers.get(peerId)
    if (entry && entry.dc && entry.dc.readyState === 'open') {
      const packet = new Uint8Array(buffer.length + 1)
      packet[0] = messageType
      packet.set(buffer, 1)
      try {
        entry.dc.send(packet.buffer)
      } catch {
        // Channel error
      }
    }
  }

  /**
   * Sends a text message to a specific peer.
   */
  public sendMessage(peerId: string, message: string) {
    const entry = this.peers.get(peerId)
    if (entry && entry.dc && entry.dc.readyState === 'open') {
      try {
        entry.dc.send(message)
      } catch {
        // Channel error
      }
    }
  }

  public isSyncEnabled(): boolean {
    return this.syncEnabled
  }

  public setSyncEnabled(enabled: boolean): void {
    this.syncEnabled = enabled
    this.notifyStatusChange()
  }

  public banPeer(peerId: string) {
    this.bannedPeerIds.add(peerId)
  }

  public unbanPeer(peerId: string) {
    this.bannedPeerIds.delete(peerId)
  }

  public isPeerBanned(peerId: string): boolean {
    return this.bannedPeerIds.has(peerId)
  }

  /**
   * Kicks/deletes a peer from the group.
   * Sends kick signal, closes connection, and bans the peer from reconnecting.
   */
  public kickPeer(peerId: string, reason = 'Removido pelo criador do grupo') {
    this.banPeer(peerId)

    // Notify all peers about the kick
    const kickMsg = JSON.stringify({
      type: 'kick',
      targetPeerId: peerId,
      reason,
      fromPeerId: this.localPeerId
    })

    for (const [, { dc }] of this.peers) {
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(kickMsg)
        } catch {
          // Channel error
        }
      }
    }

    const entry = this.peers.get(peerId)
    if (entry) {
      entry.pc.close()
      this.peers.delete(peerId)
      this.notifyStatusChange()
    }
  }

  /**
   * Leaves the active group session, notifying peers and tearing down connections.
   */
  public leaveGroup() {
    const leaveMsg = JSON.stringify({
      type: 'peer-left',
      peerId: this.localPeerId
    })

    for (const [, { dc }] of this.peers) {
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(leaveMsg)
        } catch {
          // Channel error
        }
      }
    }

    this.destroy()
  }

  /**
   * Closes all connections and resets state.
   */
  public destroy() {
    if (this.pendingOfferPc) {
      this.pendingOfferPc.close()
      this.pendingOfferPc = null
    }
    for (const [, { pc }] of this.peers) {
      pc.close()
    }
    this.peers.clear()
    this.notifyStatusChange()
  }
}
