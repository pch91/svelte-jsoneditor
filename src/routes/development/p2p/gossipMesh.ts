/**
 * Gossip Protocol and Swarm Routing for Serverless WebRTC Full-Mesh Topology.
 *
 * Automatically connects indirect peers by relaying SDP offers and answers
 * over existing RTCDataChannels, scaling from 2 peers to an arbitrary full mesh
 * without requiring additional manual copy-pasting.
 */

import type { WebRtcManager, GossipMessage } from './webrtcManager.js'

export interface GossipMeshConfig {
  webrtc: WebRtcManager
  maxHops?: number
}

export class GossipMesh {
  private webrtc: WebRtcManager
  private maxHops: number
  private seenMessageIds = new Set<string>()

  constructor(config: GossipMeshConfig) {
    this.webrtc = config.webrtc
    this.maxHops = config.maxHops || 3
  }

  /**
   * Generates a unique message ID to prevent infinite gossip loops.
   */
  private makeMessageId(origin: string, target?: string): string {
    return `${origin}-${target || 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  }

  /**
   * Handles an incoming gossip packet routed through an existing DataChannel.
   */
  public handleGossipPacket(fromPeerId: string, message: GossipMessage) {
    if (!message || !message.messageId) return

    // Drop already processed messages (deduplication)
    if (this.seenMessageIds.has(message.messageId)) return
    this.seenMessageIds.add(message.messageId)

    // Keep seen set bounded
    if (this.seenMessageIds.size > 2000) {
      const iter = this.seenMessageIds.values()
      for (let i = 0; i < 500; i++) {
        const next = iter.next()
        if (next.done) break
        this.seenMessageIds.delete(next.value)
      }
    }

    // Exceeded maximum hops
    if (message.hops >= this.maxHops) return

    const isForMe = message.targetPeerId === this.webrtc.localPeerId
    const isBroadcast = !message.targetPeerId

    if (isForMe || isBroadcast) {
      this.processGossipPayload(message)
    }

    // If targeted for someone else or a broadcast, relay to other connected peers (except the sender)
    if (!isForMe || isBroadcast) {
      this.relayGossip(fromPeerId, {
        ...message,
        hops: message.hops + 1
      })
    }
  }

  private processGossipPayload(message: GossipMessage) {
    const { type, originPeerId, payload } = message

    if (type === 'peer-announce') {
      // A new peer announced themselves in the swarm. If we don't have a direct connection,
      // initiate a peer-to-peer connection attempt relayed via the announcer.
      const announcedPeerId = (payload as { peerId?: string })?.peerId
      if (
        announcedPeerId &&
        announcedPeerId !== this.webrtc.localPeerId &&
        !this.hasDirectConnection(announcedPeerId)
      ) {
        // Initiate handshake via relay if local peer ID is lexicographically greater
        // (to prevent simultaneous dual-offers)
        if (this.webrtc.localPeerId > announcedPeerId) {
          this.initiateRelayedOffer(announcedPeerId)
        }
      }
    } else if (type === 'gossip-relay') {
      const data = payload as {
        subType: 'relayed-offer' | 'relayed-answer'
        sdp: string
      }
      if (!data) return

      if (data.subType === 'relayed-offer') {
        this.handleRelayedOffer(originPeerId, data.sdp)
      } else if (data.subType === 'relayed-answer') {
        this.handleRelayedAnswer(originPeerId, data.sdp)
      }
    } else if (type === 'gossip-key') {
      const data = payload as {
        peerId: string
        publicKeyJwk: JsonWebKey
        epoch: string
      }
      if (data && data.peerId && data.publicKeyJwk && data.peerId !== this.webrtc.localPeerId) {
        this.webrtc.crypto
          .deriveSharedSecret(data.peerId, data.publicKeyJwk, data.epoch)
          .catch(() => {})
      }
    }
  }

  /**
   * Relays a gossip packet to all directly connected peers except the sender.
   */
  private relayGossip(senderPeerId: string, message: GossipMessage) {
    const peers = this.webrtc.getPeers()
    for (const p of peers) {
      if (p.peerId !== senderPeerId && p.dataChannelState === 'open') {
        this.webrtc.sendMessage(p.peerId, JSON.stringify(message))
      }
    }
  }

  /**
   * Broadcasts our presence to the whole mesh when we join or connect to a new peer.
   */
  public announcePresence() {
    const message: GossipMessage = {
      type: 'peer-announce',
      originPeerId: this.webrtc.localPeerId,
      messageId: this.makeMessageId(this.webrtc.localPeerId),
      hops: 0,
      payload: {
        peerId: this.webrtc.localPeerId,
        userName: this.webrtc.userName,
        userColor: this.webrtc.userColor
      }
    }
    this.broadcastGossip(message)
  }

  /**
   * Broadcasts our daily public key to all peers in the mesh so indirect peers can establish E2EE secrets.
   */
  public async broadcastDailyKey() {
    try {
      const dailyKey = await this.webrtc.crypto.getOrCreateDailyKeyPair()
      const message: GossipMessage = {
        type: 'gossip-key',
        originPeerId: this.webrtc.localPeerId,
        messageId: this.makeMessageId(this.webrtc.localPeerId, 'key-broadcast'),
        hops: 0,
        payload: {
          peerId: this.webrtc.localPeerId,
          publicKeyJwk: dailyKey.publicKeyJwk,
          epoch: dailyKey.epoch
        }
      }
      this.broadcastGossip(message)
    } catch {
      // Ignored
    }
  }

  private broadcastGossip(message: GossipMessage) {
    this.seenMessageIds.add(message.messageId)
    const peers = this.webrtc.getPeers()
    for (const p of peers) {
      if (p.dataChannelState === 'open') {
        this.webrtc.sendMessage(p.peerId, JSON.stringify(message))
      }
    }
  }

  private hasDirectConnection(peerId: string): boolean {
    const peer = this.webrtc.getPeers().find((p) => p.peerId === peerId)
    return !!peer && (peer.dataChannelState === 'open' || peer.dataChannelState === 'connecting')
  }

  /**
   * Initiates an offer specifically targeted for an indirect peer, relayed across the mesh.
   */
  private async initiateRelayedOffer(targetPeerId: string) {
    try {
      // Create local peer connection for the new direct link
      const offerToken = await this.webrtc.createOfferToken('mesh-room')
      const message: GossipMessage = {
        type: 'gossip-relay',
        originPeerId: this.webrtc.localPeerId,
        targetPeerId,
        messageId: this.makeMessageId(this.webrtc.localPeerId, targetPeerId),
        hops: 0,
        payload: {
          subType: 'relayed-offer',
          sdp: offerToken
        }
      }
      this.broadcastGossip(message)
    } catch {
      // Handshake failed or network dropped
    }
  }

  private async handleRelayedOffer(fromPeerId: string, offerToken: string) {
    try {
      const answerToken = await this.webrtc.acceptOfferToken(offerToken)
      const message: GossipMessage = {
        type: 'gossip-relay',
        originPeerId: this.webrtc.localPeerId,
        targetPeerId: fromPeerId,
        messageId: this.makeMessageId(this.webrtc.localPeerId, fromPeerId),
        hops: 0,
        payload: {
          subType: 'relayed-answer',
          sdp: answerToken
        }
      }
      this.broadcastGossip(message)
    } catch {
      // Failed to accept relayed offer
    }
  }

  private async handleRelayedAnswer(_fromPeerId: string, answerToken: string) {
    try {
      await this.webrtc.acceptAnswerToken(answerToken)
    } catch {
      // Failed to accept relayed answer
    }
  }
}
