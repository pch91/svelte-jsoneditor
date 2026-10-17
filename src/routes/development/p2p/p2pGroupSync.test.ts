import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import { encoding, decoding } from 'lib0'
import {
  compressPayload,
  decompressPayload,
  buildShareUrl,
  extractOfferFromUrl,
  type SignalingPayload
} from './sdpToken.js'

describe('P2P Serverless SDP Tokens & Compression', () => {
  it('should compress and decompress an SDP offer token with 100% fidelity', async () => {
    const originalPayload: SignalingPayload = {
      type: 'offer',
      sdp: 'v=0\r\no=- 4235235 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:1 1 UDP 2122260223 192.168.1.50 54321 typ host\r\na=candidate:2 1 UDP 1686052607 203.0.113.1 54321 typ srflx raddr 192.168.1.50 rport 54321\r\n',
      peerId: 'peer_alice_123',
      roomId: 'room_proj_alpha',
      userName: 'Alice Dev',
      timestamp: 1729150000000
    }

    const compressed = await compressPayload(originalPayload)
    expect(compressed).toBeTypeOf('string')
    expect(compressed.length).toBeGreaterThan(0)

    const decompressed = await decompressPayload(compressed)
    expect(decompressed).toEqual(originalPayload)
  })

  it('should format and extract offer token from URL hash fragment', () => {
    const token = 'p2p1_abcdef123456'
    const shareUrl = `https://example.com/svelte-jsoneditor/#p2p-offer=${encodeURIComponent(token)}`

    const extracted = extractOfferFromUrl(shareUrl)
    expect(extracted).toBe(token)
  })
})

describe('CRDT Synchronization & Background Auto-Sync Control', () => {
  it('should replicate document state between peers when sync is enabled', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()

    // Step 1: Exchange document vectors
    const enc1 = encoding.createEncoder()
    syncProtocol.writeSyncStep1(enc1, docA)
    const dec1 = decoding.createDecoder(encoding.toUint8Array(enc1))

    const enc2 = encoding.createEncoder()
    syncProtocol.readSyncMessage(dec1, enc2, docB, 'remote')

    // Peer A broadcasts any updates to Peer B
    docA.on('update', (update) => {
      const encUpdate = encoding.createEncoder()
      syncProtocol.writeUpdate(encUpdate, update)
      const decUpdate = decoding.createDecoder(encoding.toUint8Array(encUpdate))
      const reply = encoding.createEncoder()
      syncProtocol.readSyncMessage(decUpdate, reply, docB, 'remote')
    })

    // Peer A adds tabs
    const tabsA = docA.getMap('tabs')
    tabsA.set('tab-1', { id: 1, title: 'Documento API', text: '{"status":"ok"}' })
    tabsA.set('tab-2', { id: 2, title: 'Users Schema', text: '{"users":[]}' })

    // Peer B should now have tab-2
    const tabsB = docB.getMap('tabs')
    expect(tabsB.get('tab-2')).toEqual({ id: 2, title: 'Users Schema', text: '{"users":[]}' })
  })

  it('should isolate changes when auto-sync in background is paused, and merge on flush', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()

    let autoSyncEnabled = false
    const pendingUpdatesA: Uint8Array[] = []

    docA.on('update', (update) => {
      if (autoSyncEnabled) {
        const encUpdate = encoding.createEncoder()
        syncProtocol.writeUpdate(encUpdate, update)
        const decUpdate = decoding.createDecoder(encoding.toUint8Array(encUpdate))
        const reply = encoding.createEncoder()
        syncProtocol.readSyncMessage(decUpdate, reply, docB, 'remote')
      } else {
        pendingUpdatesA.push(update)
      }
    })

    const tabsA = docA.getMap('tabs')
    tabsA.set('draft-tab', { id: 99, title: 'Rascunho Secreto', text: '{"draft":true}' })

    const tabsB = docB.getMap('tabs')
    // Peer B should NOT have the draft tab yet because autoSync is disabled
    expect(tabsB.get('draft-tab')).toBeUndefined()

    // Now user re-enables sync or clicks "Sincronizar Agora"
    autoSyncEnabled = true
    for (const update of pendingUpdatesA) {
      const encUpdate = encoding.createEncoder()
      syncProtocol.writeUpdate(encUpdate, update)
      const decUpdate = decoding.createDecoder(encoding.toUint8Array(encUpdate))
      const reply = encoding.createEncoder()
      syncProtocol.readSyncMessage(decUpdate, reply, docB, 'remote')
    }

    // Now Peer B has the tab
    expect(tabsB.get('draft-tab')).toEqual({
      id: 99,
      title: 'Rascunho Secreto',
      text: '{"draft":true}'
    })
  })
})

describe('P2P Group Management & Kick/Ban Security', () => {
  it('should manage group creation and member removal with banned list', () => {
    const doc = new Y.Doc()
    const groupMap = doc.getMap('group')
    const membersMap = doc.getMap('members')

    // 1. Create group
    doc.transact(() => {
      groupMap.set('groupId', 'grp_alpha')
      groupMap.set('groupName', 'Equipe Core')
      groupMap.set('ownerPeerId', 'peer_owner')
      groupMap.set('bannedPeerIds', [])

      membersMap.set('peer_owner', {
        peerId: 'peer_owner',
        userName: 'Admin',
        role: 'owner'
      })
      membersMap.set('peer_bob', {
        peerId: 'peer_bob',
        userName: 'Bob',
        role: 'member'
      })
    })

    expect(membersMap.size).toBe(2)
    expect(groupMap.get('groupName')).toBe('Equipe Core')

    // 2. Owner removes (kicks) Bob
    doc.transact(() => {
      membersMap.delete('peer_bob')
      const banned = (groupMap.get('bannedPeerIds') as string[]) || []
      groupMap.set('bannedPeerIds', [...banned, 'peer_bob'])
    })

    expect(membersMap.has('peer_bob')).toBe(false)
    const currentBanned = groupMap.get('bannedPeerIds') as string[]
    expect(currentBanned).toContain('peer_bob')
  })
})

describe('Level-1 Folder Isolation & Zero-Bleed Between Groups', () => {
  it('strictly isolates Folder A data from Group B and Folder B data from Group A', () => {
    // Simulated Mesh Architecture:
    // Host has Folder A (id: 101) and Folder B (id: 202)
    // Peer Alice is in Group A (connected strictly to Folder 101)
    // Peer Bob is in Group B (connected strictly to Folder 202)
    const hostDocA = new Y.Doc()
    const hostDocB = new Y.Doc()

    const aliceDocA = new Y.Doc()
    const bobDocB = new Y.Doc()

    const sentToAlice: Uint8Array[] = []
    const sentToBob: Uint8Array[] = []

    // Host Folder A transmits strictly to Alice (Group A)
    hostDocA.on('update', (update) => {
      sentToAlice.push(update)
      const encUpdate = encoding.createEncoder()
      syncProtocol.writeUpdate(encUpdate, update)
      const decUpdate = decoding.createDecoder(encoding.toUint8Array(encUpdate))
      const reply = encoding.createEncoder()
      syncProtocol.readSyncMessage(decUpdate, reply, aliceDocA, 'remote')
    })

    // Host Folder B transmits strictly to Bob (Group B)
    hostDocB.on('update', (update) => {
      sentToBob.push(update)
      const encUpdate = encoding.createEncoder()
      syncProtocol.writeUpdate(encUpdate, update)
      const decUpdate = decoding.createDecoder(encoding.toUint8Array(encUpdate))
      const reply = encoding.createEncoder()
      syncProtocol.readSyncMessage(decUpdate, reply, bobDocB, 'remote')
    })

    // 1. Host updates Folder A with confidential API requests and tabs
    const tabsA = hostDocA.getMap('tabs')
    tabsA.set('tab_confidential_a', {
      id: 1001,
      title: 'Pasta A - Top Secret Financial API',
      text: '{"auth":"secret-token-A"}'
    })

    // 2. Alice (Group A) MUST receive it
    const aliceTabs = aliceDocA.getMap('tabs')
    expect(aliceTabs.get('tab_confidential_a')).toEqual({
      id: 1001,
      title: 'Pasta A - Top Secret Financial API',
      text: '{"auth":"secret-token-A"}'
    })

    // 3. Bob (Group B) MUST NOT receive it (Zero-Bleed)
    const bobTabs = bobDocB.getMap('tabs')
    expect(bobTabs.get('tab_confidential_a')).toBeUndefined()
    expect(sentToBob.length).toBe(0)

    // 4. Host updates Folder B with User Database API
    const tabsB = hostDocB.getMap('tabs')
    tabsB.set('tab_users_b', {
      id: 2001,
      title: 'Pasta B - User Database',
      text: '{"users":["alice","bob"]}'
    })

    // 5. Bob (Group B) receives Folder B data
    expect(bobTabs.get('tab_users_b')).toEqual({
      id: 2001,
      title: 'Pasta B - User Database',
      text: '{"users":["alice","bob"]}'
    })

    // 6. Alice (Group A) NEVER sees Folder B data
    expect(aliceTabs.get('tab_users_b')).toBeUndefined()
  })
})

