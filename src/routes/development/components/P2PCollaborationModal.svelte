<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import {
    getYjsWorkspace,
    type P2PWorkspaceState,
    type GroupInfo,
    type GroupMember
  } from '../p2p/yjsWorkspace.js'
  import {
    buildShareUrl,
    generateSvgQrCode,
    extractOfferFromUrl,
    decompressPayload,
    type SignalingPayload
  } from '../p2p/sdpToken.js'
  import type { PeerInfo } from '../p2p/webrtcManager.js'
  import { P2PCryptoEngine } from '../p2p/p2pCrypto.js'
  import { ExtensionBridge } from '../p2p/extensionBridge.js'

  export let open = false
  export let onClose: () => void = () => {}
  export let prefillOfferToken: string = ''
  export let primaryTabs: {
    id: number
    title: string
    p2pGroupId?: string
    p2pGroupName?: string
  }[] = []
  export let activePrimaryTabId: number = 1
  export let onJoinFolderGroup:
    | ((folderId: number, groupId: string, groupName: string, folderName?: string) => void)
    | undefined = undefined
  export let onUpdatePrimaryTab:
    | ((tabId: number, patch: { p2pGroupId?: string; p2pGroupName?: string }) => void)
    | undefined = undefined
  export let onCreateFolderFromShare:
    | ((folderName: string, groupId: string, groupName: string) => number)
    | undefined = undefined

  const workspace = getYjsWorkspace()

  type ModalTab = 'group' | 'invite' | 'join' | 'settings'
  let activeTab: ModalTab = 'group'

  let selectedFolderId: number = activePrimaryTabId

  // Sincroniza selectedFolderId estritamente com a aba ativa sempre que o modal abre ou a aba primária muda
  let prevModalOpen = false
  let prevActiveTabId = activePrimaryTabId

  $: if (open && !prevModalOpen) {
    prevModalOpen = true
    if (activePrimaryTabId) {
      selectedFolderId = activePrimaryTabId
      refreshFolderState(selectedFolderId)
    }
  } else if (!open && prevModalOpen) {
    prevModalOpen = false
  }

  $: if (activePrimaryTabId !== prevActiveTabId) {
    prevActiveTabId = activePrimaryTabId
    selectedFolderId = activePrimaryTabId
    refreshFolderState(selectedFolderId)
  }

  $: if (selectedFolderId && !primaryTabs.some((p) => p.id === selectedFolderId)) {
    selectedFolderId = activePrimaryTabId || primaryTabs[0]?.id || 1
    refreshFolderState(selectedFolderId)
  }

  $: currentFolder = primaryTabs.find((p) => p.id === selectedFolderId) || primaryTabs[0]

  let p2pState: P2PWorkspaceState = {
    status: 'offline',
    peerCount: 0,
    peers: [],
    presences: [],
    persistedLocally: false,
    autoSync: true,
    group: null
  }

  let groupInfo: GroupInfo | null = null
  let folderAutoSync = true
  let folderPeers: PeerInfo[] = []

  // Local user settings
  let localUserName = workspace.userName
  let localUserColor = workspace.userColor

  // Group creation form
  let newGroupName = 'Equipe Alpha'

  // Invitation workflow
  let generatedOfferToken = ''
  let directShareUrl = ''
  let qrCodeSvg = ''
  let isGeneratingOffer = false
  let answerTokenInput = ''
  let isConnectingAnswer = false
  let inviteCopySuccess = false
  let linkCopySuccess = false
  let connectionSuccess = false
  let connectionError = ''

  // Joining workflow
  let joinOfferTokenInput = ''
  let joinPayloadPreview: SignalingPayload | null = null
  let joinTargetMode: 'current' | 'new' = 'current'
  let generatedAnswerToken = ''
  let isGeneratingAnswer = false
  let answerCopySuccess = false
  let joinError = ''

  // Manual sync feedback
  let isFlushingSync = false
  let flushSuccess = false

  // Member kick confirmation
  let memberToKick: GroupMember | null = null

  // Background extension relay bridge (Default: disabled)
  let extensionRelayEnabled = ExtensionBridge.isRelayEnabled()
  let showExtensionInstallDialog = false
  let isCheckingExtension = false

  let unsubStatus: (() => void) | null = null
  let unsubFolderGroup: (() => void) | null = null

  function refreshFolderState(fId: number) {
    if (unsubFolderGroup) {
      unsubFolderGroup()
      unsubFolderGroup = null
    }
    unsubFolderGroup = workspace.subscribeFolderGroup(fId, (info) => {
      groupInfo = info
    })
    groupInfo = workspace.getFolderGroup(fId)
    folderAutoSync = workspace.isFolderAutoSyncEnabled(fId)
    folderPeers = workspace.webrtc.getPeersForFolder(fId)
    const folder = primaryTabs.find((p) => p.id === fId)
    newGroupName = folder?.title ? `Equipe ${folder.title}` : 'Equipe Alpha'
  }

  $: if (selectedFolderId) {
    refreshFolderState(selectedFolderId)
  }

  onMount(() => {
    unsubStatus = workspace.subscribeStatus((state) => {
      p2pState = state
      if (selectedFolderId) {
        folderPeers = workspace.webrtc.getPeersForFolder(selectedFolderId)
      }
    })

    if (selectedFolderId) {
      refreshFolderState(selectedFolderId)
    }

    if (prefillOfferToken) {
      joinOfferTokenInput = prefillOfferToken
      activeTab = 'join'
    }
  })

  onDestroy(() => {
    if (unsubStatus) unsubStatus()
    if (unsubFolderGroup) unsubFolderGroup()
  })

  $: if (open && prefillOfferToken && joinOfferTokenInput !== prefillOfferToken) {
    joinOfferTokenInput = prefillOfferToken
    activeTab = 'join'
  }

  function handleFolderChange() {
    refreshFolderState(selectedFolderId)
    generatedOfferToken = ''
    directShareUrl = ''
    qrCodeSvg = ''
    answerTokenInput = ''
  }

  let previewSasFingerprint = ''

  $: if (joinOfferTokenInput.trim()) {
    inspectJoinToken(joinOfferTokenInput.trim())
  } else {
    joinPayloadPreview = null
    previewSasFingerprint = ''
  }

  async function inspectJoinToken(raw: string) {
    try {
      let token = raw
      const extracted = extractOfferFromUrl(raw)
      if (extracted) token = extracted
      const payload = await decompressPayload(token)
      if (payload.type === 'offer') {
        joinPayloadPreview = payload
        if (payload.publicKeyJwk) {
          try {
            const myDailyKey = await workspace.webrtc.crypto.getOrCreateDailyKeyPair()
            previewSasFingerprint = await P2PCryptoEngine.generateSasFingerprint(
              myDailyKey.publicKeyJwk,
              payload.publicKeyJwk
            )
          } catch {
            previewSasFingerprint = ''
          }
        } else {
          previewSasFingerprint = ''
        }
      } else {
        joinPayloadPreview = null
        previewSasFingerprint = ''
      }
    } catch {
      joinPayloadPreview = null
      previewSasFingerprint = ''
    }
  }

  function handleSaveProfile() {
    if (localUserName.trim()) {
      workspace.setUserName(localUserName.trim())
    }
    workspace.setUserColor(localUserColor)
    if (selectedFolderId) {
      refreshFolderState(selectedFolderId)
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim() || !selectedFolderId) return
    const folderTitle = currentFolder?.title || `Pasta ${selectedFolderId}`
    const created = workspace.createFolderGroup(selectedFolderId, folderTitle, newGroupName.trim())
    groupInfo = created
    if (onUpdatePrimaryTab) {
      onUpdatePrimaryTab(selectedFolderId, {
        p2pGroupId: created.groupId,
        p2pGroupName: created.groupName
      })
    }
    if (extensionRelayEnabled) {
      ExtensionBridge.registerGroup(created.groupId, created.groupName, selectedFolderId)
    }
    await generateInviteOffer()
  }

  function handleLeaveGroup() {
    if (
      confirm(
        `Tem certeza de que deseja sair do grupo da pasta "${currentFolder?.title || selectedFolderId}"?`
      )
    ) {
      workspace.leaveFolderGroup(selectedFolderId)
      if (onUpdatePrimaryTab) {
        onUpdatePrimaryTab(selectedFolderId, {
          p2pGroupId: undefined,
          p2pGroupName: undefined
        })
      }
      groupInfo = null
      generatedOfferToken = ''
      directShareUrl = ''
      qrCodeSvg = ''
      answerTokenInput = ''
    }
  }

  function handleToggleAutoSync() {
    const nextState = !folderAutoSync
    workspace.setFolderAutoSyncEnabled(selectedFolderId, nextState)
    folderAutoSync = nextState
  }

  async function handleToggleExtensionRelay() {
    if (extensionRelayEnabled) {
      extensionRelayEnabled = false
      ExtensionBridge.setRelayEnabled(false)
    } else {
      isCheckingExtension = true
      const status = await ExtensionBridge.checkInstalled()
      isCheckingExtension = false
      if (!status.isInstalled) {
        showExtensionInstallDialog = true
      } else {
        extensionRelayEnabled = true
        ExtensionBridge.setRelayEnabled(true)
        if (groupInfo) {
          ExtensionBridge.registerGroup(groupInfo.groupId, groupInfo.groupName, selectedFolderId)
        }
      }
    }
  }

  function handleManualSync() {
    isFlushingSync = true
    workspace.flushFolderSync(selectedFolderId)
    setTimeout(() => {
      isFlushingSync = false
      flushSuccess = true
      setTimeout(() => {
        flushSuccess = false
      }, 2500)
    }, 600)
  }

  function confirmKick(member: GroupMember) {
    memberToKick = member
  }

  function executeKick() {
    if (!memberToKick || !selectedFolderId) return
    try {
      workspace.kickFolderMember(selectedFolderId, memberToKick.peerId)
      memberToKick = null
      groupInfo = workspace.getFolderGroup(selectedFolderId)
    } catch (err) {
      alert((err as Error).message)
    }
  }

  function cancelKick() {
    memberToKick = null
  }

  async function generateInviteOffer() {
    isGeneratingOffer = true
    connectionError = ''
    try {
      const roomId = groupInfo?.groupId || 'default-room'
      const folderTitle = currentFolder?.title || `Pasta ${selectedFolderId}`
      const token = await workspace.webrtc.createOfferToken(
        roomId,
        selectedFolderId,
        folderTitle,
        groupInfo?.groupName || newGroupName
      )
      generatedOfferToken = token
      directShareUrl = buildShareUrl(token)
      qrCodeSvg = generateSvgQrCode(directShareUrl, 180)
    } catch (err) {
      connectionError = 'Erro ao gerar convite: ' + (err as Error).message
    } finally {
      isGeneratingOffer = false
    }
  }

  async function copyToClipboard(text: string, type: 'token' | 'link' | 'answer') {
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'token') {
        inviteCopySuccess = true
        setTimeout(() => (inviteCopySuccess = false), 2500)
      } else if (type === 'link') {
        linkCopySuccess = true
        setTimeout(() => (linkCopySuccess = false), 2500)
      } else if (type === 'answer') {
        answerCopySuccess = true
        setTimeout(() => (answerCopySuccess = false), 2500)
      }
    } catch {
      // Fallback
    }
  }

  async function handleAcceptAnswer() {
    if (!answerTokenInput.trim()) return
    isConnectingAnswer = true
    connectionError = ''
    try {
      await workspace.webrtc.acceptAnswerToken(answerTokenInput.trim())
      connectionSuccess = true
      answerTokenInput = ''
      refreshFolderState(selectedFolderId)
      setTimeout(() => {
        connectionSuccess = false
        activeTab = 'group'
      }, 2000)
    } catch (err) {
      connectionError = 'Erro ao aceitar resposta: ' + (err as Error).message
    } finally {
      isConnectingAnswer = false
    }
  }

  async function handleJoinWithOffer() {
    if (!joinOfferTokenInput.trim()) return
    isGeneratingAnswer = true
    joinError = ''
    try {
      let rawToken = joinOfferTokenInput.trim()
      const extracted = extractOfferFromUrl(rawToken)
      if (extracted) {
        rawToken = extracted
      }

      const payload = await decompressPayload(rawToken)
      const answerToken = await workspace.webrtc.acceptOfferToken(rawToken)
      generatedAnswerToken = answerToken

      let targetFolderId = selectedFolderId
      if (joinTargetMode === 'new' && onCreateFolderFromShare && payload.folderName) {
        targetFolderId = onCreateFolderFromShare(
          payload.folderName,
          payload.roomId || 'mesh-room',
          payload.groupName || 'Equipe P2P'
        )
        selectedFolderId = targetFolderId
      }

      workspace.joinFolderGroup(
        targetFolderId,
        payload.roomId || 'mesh-room',
        payload.groupName || 'Equipe P2P',
        payload.folderName
      )

      if (onUpdatePrimaryTab) {
        onUpdatePrimaryTab(targetFolderId, {
          p2pGroupId: payload.roomId || 'mesh-room',
          p2pGroupName: payload.groupName || 'Equipe P2P'
        })
      }

      if (onJoinFolderGroup) {
        onJoinFolderGroup(
          targetFolderId,
          payload.roomId || 'mesh-room',
          payload.groupName || 'Equipe P2P',
          payload.folderName
        )
      }

      refreshFolderState(targetFolderId)
    } catch (err) {
      joinError = 'Erro ao processar convite: ' + (err as Error).message
    } finally {
      isGeneratingAnswer = false
    }
  }

  const PALETTE = [
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#f97316',
    '#10b981',
    '#06b6d4',
    '#6366f1',
    '#eab308'
  ]
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="p2p-modal-backdrop" on:click={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="p2p-modal-window" on:click|stopPropagation>
      <!-- Modal Header (Sistema Standard: azul #3883fa) -->
      <div class="p2p-modal-header">
        <div class="p2p-modal-title">
          <span class="p2p-header-title">Colaboração em Grupo P2P</span>
          <span class="p2p-header-badge">WebRTC • Yjs CRDTs • Offline-First</span>
        </div>
        <button type="button" class="p2p-modal-close" on:click={onClose} title="Fechar (Esc)">
          ×
        </button>
      </div>

      <!-- Level-1 Folder Scoped Isolation Selector (User Directive: Isolamento Absoluto por Pasta) -->
      <div class="folder-bar">
        <div class="folder-bar-left">
          <span class="folder-bar-label">📁 Pasta:</span>
          <select
            class="folder-select"
            bind:value={selectedFolderId}
            on:change={handleFolderChange}
          >
            {#each primaryTabs as tab (tab.id)}
              <option value={tab.id}>
                📁 {tab.title || 'Pasta ' + tab.id}
                {tab.p2pGroupId ? `(👥 ${tab.p2pGroupName || 'Grupo'})` : '(Isolada / Sem Grupo)'}
              </option>
            {/each}
          </select>
        </div>
        <div class="folder-bar-right">
          {#if currentFolder?.p2pGroupId}
            <span
              class="folder-status-badge badge-active"
              title="Esta pasta possui grupo P2P isolado"
            >
              <span class="status-dot online"></span>
              {currentFolder.p2pGroupName || 'Grupo Ativo'}
            </span>
          {:else}
            <span
              class="folder-status-badge badge-isolated"
              title="Esta pasta é privada e isolada de outros grupos"
            >
              <span class="status-dot isolated"></span>
              Isolada (Privada)
            </span>
          {/if}
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="p2p-tabs-bar">
        <button
          class="tab-btn"
          class:active={activeTab === 'group'}
          on:click={() => (activeTab = 'group')}
        >
          <span>👥 Grupo & Membros</span>
          {#if groupInfo}
            <span class="badge-count">{groupInfo.members.length}</span>
          {/if}
        </button>

        <button
          class="tab-btn"
          class:active={activeTab === 'invite'}
          on:click={() => {
            activeTab = 'invite'
            if (!generatedOfferToken) generateInviteOffer()
          }}
        >
          <span>✉️ Convidar Pessoa</span>
        </button>

        <button
          class="tab-btn"
          class:active={activeTab === 'join'}
          on:click={() => (activeTab = 'join')}
        >
          <span>📥 Entrar com Convite</span>
        </button>

        <button
          class="tab-btn"
          class:active={activeTab === 'settings'}
          on:click={() => (activeTab = 'settings')}
        >
          <span>⚙️ Perfil & Rede</span>
        </button>
      </div>

      <!-- Modal Body -->
      <div class="p2p-modal-body">
        <!-- TAB 1: GRUPO & MEMBROS -->
        {#if activeTab === 'group'}
          {#if !groupInfo}
            <div class="empty-group-card">
              <div class="empty-icon">📁</div>
              <h3>Nenhum Grupo Ativo para esta Pasta</h3>
              <p>
                Crie um grupo de colaboração para convidar colegas e sincronizar estritamente a
                pasta
                <strong>"{currentFolder?.title || 'Pasta ' + selectedFolderId}"</strong> em tempo real.
                Suas outras pastas permanecem 100% privadas e isoladas deste grupo.
              </p>

              <div class="create-group-form">
                <label for="p2p-group-name" class="form-label">Nome do Grupo para esta Pasta:</label
                >
                <div class="input-with-button">
                  <input
                    id="p2p-group-name"
                    type="text"
                    class="text-input"
                    bind:value={newGroupName}
                    placeholder="Ex: Equipe de APIs & Fluxos"
                    on:keydown={(e) => e.key === 'Enter' && handleCreateGroup()}
                  />
                  <button class="action-btn primary" on:click={handleCreateGroup}>
                    Criar Grupo da Pasta
                  </button>
                </div>
              </div>

              <div class="info-callout">
                <div class="callout-icon">🔒</div>
                <div class="callout-text">
                  <strong>Isolamento Absoluto por Pasta:</strong> O grupo desta pasta NUNCA enxerga ou
                  recebe dados de outras pastas. Cada pasta possui grupo, membros e controle de sincronismo
                  100% independentes.
                </div>
              </div>
            </div>
          {:else}
            <!-- ACTIVE GROUP VIEW -->
            <div class="group-details-container">
              <!-- Group Banner -->
              <div class="group-banner">
                <div class="group-title-section">
                  <span class="group-name">{groupInfo.groupName}</span>
                  <span class="group-id-pill" title="ID da Sala P2P">ID: {groupInfo.groupId}</span>
                  {#if groupInfo.isOwner}
                    <span class="role-badge owner">👑 Criador / Host</span>
                  {:else}
                    <span class="role-badge member">👤 Membro</span>
                  {/if}
                </div>

                <div class="group-actions">
                  <button
                    class="action-btn secondary small"
                    on:click={() => {
                      activeTab = 'invite'
                      generateInviteOffer()
                    }}
                  >
                    ➕ Convidar Colega
                  </button>
                  <button class="action-btn danger small" on:click={handleLeaveGroup}>
                    🚪 Sair do Grupo
                  </button>
                </div>
              </div>

              <!-- COMPACT SMART CONTROL STRIP (Redesenhado: Limpo, rápido e intuitivo) -->
              <div class="sync-toggles-strip">
                <!-- Toggle 1: Sincronismo em Tempo Real -->
                <div
                  class="toggle-pill-card"
                  class:paused={!folderAutoSync}
                  title={folderAutoSync
                    ? 'Modificações sincronizam instantaneamente com o grupo'
                    : 'Modo rascunho: edições locais isoladas'}
                >
                  <div class="toggle-pill-left">
                    <span class="pill-icon">{folderAutoSync ? '🟢' : '⏸'}</span>
                    <div class="pill-texts">
                      <span class="pill-title">Tempo Real</span>
                      <span class="pill-status"
                        >{folderAutoSync ? 'Ativo' : 'Pausado (Rascunho)'}</span
                      >
                    </div>
                  </div>
                  <div class="pill-actions">
                    {#if !folderAutoSync}
                      <button
                        class="pill-btn mini-primary"
                        class:flushing={isFlushingSync}
                        on:click={handleManualSync}
                        title="Enviar modificações pendentes agora"
                      >
                        {isFlushingSync ? '⏳' : flushSuccess ? '✓' : '⚡ Sincronizar'}
                      </button>
                    {/if}
                    <button
                      class="pill-btn"
                      class:active={folderAutoSync}
                      on:click={handleToggleAutoSync}
                    >
                      {folderAutoSync ? 'Pausar' : 'Ativar'}
                    </button>
                  </div>
                </div>

                <!-- Toggle 2: Ponte com Navegador Fechado (Extensão) -->
                <div
                  class="toggle-pill-card"
                  class:paused={!extensionRelayEnabled}
                  title={extensionRelayEnabled
                    ? 'Extensão ativa: atua como ponte contínua mesmo com a aba fechada'
                    : 'Desativado: o compartilhamento ocorre apenas com a aba aberta'}
                >
                  <div class="toggle-pill-left">
                    <span class="pill-icon">{extensionRelayEnabled ? '🧩' : '💤'}</span>
                    <div class="pill-texts">
                      <span class="pill-title">Ponte em 2º Plano</span>
                      <span class="pill-status"
                        >{extensionRelayEnabled ? 'Extensão Ativa' : 'Desativada'}</span
                      >
                    </div>
                  </div>
                  <div class="pill-actions">
                    <button
                      class="pill-btn"
                      class:active={extensionRelayEnabled}
                      on:click={handleToggleExtensionRelay}
                      disabled={isCheckingExtension}
                    >
                      {#if isCheckingExtension}
                        ⏳
                      {:else if extensionRelayEnabled}
                        Desativar
                      {:else}
                        Ativar
                      {/if}
                    </button>
                  </div>
                </div>
              </div>

              <!-- MEMBERS LIST -->
              <div class="members-section">
                <div class="section-header">
                  <h4>Membros no Grupo ({groupInfo.members.length})</h4>
                  <span class="connected-badge">
                    {folderPeers.length > 0
                      ? `🟢 ${folderPeers.length} Conexão(ões) Direta(s)`
                      : '🟡 Aguardando Outros Membros'}
                  </span>
                </div>

                <div class="members-list">
                  {#each groupInfo.members as member}
                    <div class="member-card" class:is-local={member.isLocal}>
                      <div class="member-avatar" style="background: {member.color};">
                        {member.userName.slice(0, 2).toUpperCase()}
                      </div>

                      <div class="member-info">
                        <div class="member-name-row">
                          <span class="member-name">{member.userName}</span>
                          {#if member.isLocal}
                            <span class="tag local-tag">Você</span>
                          {/if}
                          {#if member.role === 'owner'}
                            <span class="tag owner-tag">👑 Criador</span>
                          {/if}
                        </div>
                        <div class="member-meta">
                          <span class="peer-id-snippet">ID: {member.peerId.slice(0, 10)}</span>
                          {#if member.isLocal}
                            <span class="e2ee-pill" title="Sua chave móvel efêmera do dia ativa">
                              🔒 Chave {workspace.webrtc.crypto.getCurrentEpoch()}
                            </span>
                          {:else}
                            {@const peerEntry = p2pState.peers.find(
                              (p) => p.peerId === member.peerId
                            )}
                            {#if peerEntry?.latencyMs}
                              <span class="latency-pill">⚡ {peerEntry.latencyMs}ms</span>
                            {:else if peerEntry?.dataChannelState === 'open'}
                              <span class="latency-pill">🟢 Conectado</span>
                            {:else}
                              <span class="latency-pill offline">⚪ Mesh Relay</span>
                            {/if}
                            {#if peerEntry?.isE2ee}
                              <span
                                class="e2ee-pill"
                                title="Criptografado ponta-a-ponta com chave móvel diária"
                              >
                                🔒 E2EE {peerEntry.sasFingerprint
                                  ? `• ${peerEntry.sasFingerprint}`
                                  : ''}
                              </span>
                            {/if}
                          {/if}
                        </div>
                      </div>

                      <!-- DELETE / KICK BUTTON (USER REQUESTED: Criador pode deletar membros) -->
                      {#if groupInfo.isOwner && !member.isLocal}
                        <button
                          class="kick-btn"
                          title="Remover este membro do grupo"
                          on:click={() => confirmKick(member)}
                        >
                          ✕ Remover do Grupo
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- TAB 2: CONVIDAR PESSOA -->
        {:else if activeTab === 'invite'}
          <div class="invite-container">
            <div class="step-card">
              <div class="step-header">
                <span class="step-num">Passo 1</span>
                <h4>Copie o Convite P2P e envie para o colega</h4>
              </div>
              <p class="step-desc">
                Este token contém a oferta WebRTC com candidatos ICE embutidos. O convidado pode
                usar o link direto ou copiar o token no aplicativo dele.
              </p>

              {#if isGeneratingOffer}
                <div class="loading-box">⏳ Gerando candidatos ICE e token comprimido...</div>
              {:else if generatedOfferToken}
                <div class="token-display-box">
                  <textarea class="token-textarea" readonly rows="3" value={generatedOfferToken}
                  ></textarea>
                  <div class="token-actions">
                    <button
                      class="action-btn primary small"
                      on:click={() => copyToClipboard(generatedOfferToken, 'token')}
                    >
                      {inviteCopySuccess ? '✓ Token Copiado!' : '📋 Copiar Token'}
                    </button>
                    <button
                      class="action-btn secondary small"
                      on:click={() => copyToClipboard(directShareUrl, 'link')}
                    >
                      {linkCopySuccess ? '✓ Link Copiado!' : '🔗 Copiar Link Direto'}
                    </button>
                    <button
                      class="action-btn ghost small"
                      on:click={generateInviteOffer}
                      title="Gerar novo par de chaves"
                    >
                      🔄 Atualizar
                    </button>
                  </div>
                </div>

                {#if qrCodeSvg}
                  <div class="qr-preview-section">
                    <span class="qr-label">Ou escaneie com câmera móvel / tablet:</span>
                    <div class="qr-wrapper">
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html qrCodeSvg}
                    </div>
                  </div>
                {/if}
              {/if}
            </div>

            <div class="step-card">
              <div class="step-header">
                <span class="step-num">Passo 2</span>
                <h4>Cole a Resposta (Answer) do colega para finalizar</h4>
              </div>
              <p class="step-desc">
                Assim que seu colega aceitar o convite no navegador dele, ele gerará um token de
                resposta. Cole-o aqui:
              </p>

              <div class="answer-input-box">
                <textarea
                  class="token-textarea"
                  rows="3"
                  placeholder="Cole aqui o token de resposta (p2p1_...)"
                  bind:value={answerTokenInput}
                ></textarea>

                {#if connectionError}
                  <div class="error-banner">{connectionError}</div>
                {/if}
                {#if connectionSuccess}
                  <div class="success-banner">
                    ✓ Conexão P2P estabelecida com sucesso! Membro adicionado.
                  </div>
                {/if}

                <button
                  class="action-btn primary"
                  disabled={!answerTokenInput.trim() || isConnectingAnswer}
                  on:click={handleAcceptAnswer}
                >
                  {isConnectingAnswer ? '⏳ Conectando...' : '🤝 Finalizar Conexão & Unir ao Grupo'}
                </button>
              </div>
            </div>
          </div>

          <!-- TAB 3: ENTRAR COM CONVITE -->
        {:else if activeTab === 'join'}
          <div class="join-container">
            <div class="step-card">
              <div class="step-header">
                <span class="step-num">Passo 1</span>
                <h4>Cole o Token de Convite recebido</h4>
              </div>
              <p class="step-desc">
                Cole o token recebido de quem criou o grupo (ou a URL de convite):
              </p>

              <div class="join-input-box">
                <textarea
                  class="token-textarea"
                  rows="3"
                  placeholder="Cole o token (p2p1_...) ou link aqui"
                  bind:value={joinOfferTokenInput}
                ></textarea>

                {#if joinPayloadPreview}
                  <div class="incoming-preview-box">
                    <div class="incoming-preview-header">
                      <span class="preview-icon">📁</span>
                      <div class="preview-text">
                        <div class="preview-folder-name">
                          Pasta Compartilhada: <strong
                            >{joinPayloadPreview.folderName || 'Pasta Lvl 1'}</strong
                          >
                        </div>
                        <div class="preview-group-name">
                          Grupo: <strong>{joinPayloadPreview.groupName || 'Equipe P2P'}</strong> •
                          Convidado por: <strong>{joinPayloadPreview.userName || 'Peer'}</strong>
                        </div>
                      </div>
                    </div>
                    <div class="preview-targets">
                      <label class="preview-radio">
                        <input type="radio" bind:group={joinTargetMode} value="current" />
                        <span
                          >Sincronizar na pasta atual selecionada (<strong
                            >{currentFolder?.title || 'Pasta ' + selectedFolderId}</strong
                          >)</span
                        >
                      </label>
                      <label class="preview-radio">
                        <input type="radio" bind:group={joinTargetMode} value="new" />
                        <span
                          >Criar nova Pasta Compartilhada "<strong
                            >{joinPayloadPreview.folderName || 'Nova Pasta'}</strong
                          >" (Recomendado)</span
                        >
                      </label>
                    </div>
                    <div class="preview-isolation-alert">
                      🔒 <strong>Isolamento Absoluto:</strong> O compartilhamento é restrito a esta pasta.
                      Suas outras pastas e as pastas do anfitrião permanecem 100% privadas e inacessíveis
                      entre grupos.
                    </div>

                    {#if joinPayloadPreview.publicKeyJwk}
                      <div class="preview-e2ee-alert">
                        <div class="e2ee-badge-row">
                          <span class="e2ee-shield">🛡️</span>
                          <strong
                            >Criptografia E2EE de Chave Móvel ({joinPayloadPreview.epoch ||
                              'Hoje'})</strong
                          >
                        </div>
                        {#if previewSasFingerprint}
                          <div class="preview-sas-box">
                            <span class="sas-label">Código de Confirmação SAS:</span>
                            <strong class="sas-code">🔒 {previewSasFingerprint}</strong>
                          </div>
                        {/if}
                        <div class="e2ee-desc">
                          Os dados serão cifrados com segredo mútuo (A × B). Observadores na rede ou
                          intermediários não conseguem decifrar os dados.
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if joinError}
                  <div class="error-banner">{joinError}</div>
                {/if}

                <button
                  class="action-btn primary"
                  disabled={!joinOfferTokenInput.trim() || isGeneratingAnswer}
                  on:click={handleJoinWithOffer}
                >
                  {isGeneratingAnswer
                    ? '⏳ Gerando Resposta...'
                    : '📩 Aceitar Convite & Entrar na Pasta Compartilhada'}
                </button>
              </div>
            </div>

            {#if generatedAnswerToken}
              <div class="step-card highlight">
                <div class="step-header">
                  <span class="step-num">Passo 2</span>
                  <h4>Envie esta Resposta de volta para quem te convidou</h4>
                </div>
                <p class="step-desc">
                  Copie o token abaixo e envie de volta pelo chat/WhatsApp/Slack para quem gerou o
                  convite:
                </p>

                <div class="token-display-box">
                  <textarea class="token-textarea" readonly rows="3" value={generatedAnswerToken}
                  ></textarea>
                  <button
                    class="action-btn primary"
                    on:click={() => copyToClipboard(generatedAnswerToken, 'answer')}
                  >
                    {answerCopySuccess ? '✓ Resposta Copiada!' : '📋 Copiar Resposta'}
                  </button>
                </div>
              </div>
            {/if}
          </div>

          <!-- TAB 4: PERFIL & REDE -->
        {:else if activeTab === 'settings'}
          <div class="settings-container">
            <div class="settings-card">
              <h4>Seu Perfil de Colaborador</h4>
              <p class="card-desc">
                Personalize como os outros membros do grupo veem você em tempo real.
              </p>

              <!-- LIVE PROFILE PREVIEW (Feedback visual imediato) -->
              <div class="live-preview-box">
                <span class="preview-micro-label">Prévia do seu Card na Equipe:</span>
                <div class="member-card preview-card">
                  <div class="member-avatar" style="background: {localUserColor};">
                    {(localUserName.trim() || 'Dev').slice(0, 2).toUpperCase()}
                  </div>
                  <div class="member-info">
                    <div class="member-name-row">
                      <span class="member-name">{localUserName.trim() || 'Dev'}</span>
                      <span class="tag local-tag">Você</span>
                      <span class="live-status-pill">⚡ Sincronizado</span>
                    </div>
                    <div class="member-meta">
                      <span class="peer-id-snippet">ID: {workspace.localPeerId.slice(0, 10)}</span>
                      <span class="e2ee-pill"
                        >🔒 Chave {workspace.webrtc.crypto.getCurrentEpoch()}</span
                      >
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label for="p2p-user-name" class="form-label">Seu Nome / Apelido:</label>
                <input
                  id="p2p-user-name"
                  type="text"
                  class="text-input"
                  bind:value={localUserName}
                  on:input={handleSaveProfile}
                />
              </div>

              <div class="form-group">
                <label for="p2p-user-color" class="form-label">Sua Cor do Cursor & Avatar:</label>
                <div id="p2p-user-color" class="palette-row">
                  {#each PALETTE as color}
                    <button
                      class="color-dot"
                      class:selected={localUserColor === color}
                      style="background: {color};"
                      on:click={() => {
                        localUserColor = color
                        handleSaveProfile()
                      }}
                      title={color}
                    ></button>
                  {/each}
                </div>
              </div>

              <div class="form-group">
                <label for="p2p-peer-id" class="form-label">Seu Peer ID:</label>
                <input
                  id="p2p-peer-id"
                  type="text"
                  class="text-input readonly"
                  readonly
                  value={workspace.localPeerId}
                />
              </div>
            </div>

            <div class="settings-card">
              <h4>Arquitetura & Diagnóstico da Malha P2P</h4>
              <ul class="diag-list">
                <li>
                  <strong>Topologia:</strong> Malha Completa (Full Mesh) com Protocolo de Fofoca (Gossip
                  Swarm)
                </li>
                <li>
                  <strong>Resolução de Conflitos:</strong> CRDTs Matemáticos via Yjs (Sem colisão de dados)
                </li>
                <li>
                  <strong>Persistência Local:</strong>
                  {p2pState.persistedLocally
                    ? '🟢 Sincronizado no IndexedDB'
                    : '🟡 Carregando DB Local'}
                </li>
                <li>
                  <strong>Navegador / PWA:</strong> Autônomo com Cache Service Worker
                </li>
                <li>
                  <strong>Servidores Externos:</strong> 0 (Zero). 100% Client-Side no GitHub Pages.
                </li>
              </ul>
            </div>
          </div>
        {/if}
      </div>

      <!-- KICK CONFIRMATION MODAL OVERLAY -->
      {#if memberToKick}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="confirm-overlay" on:click|self={cancelKick}>
          <div class="confirm-dialog">
            <div class="dialog-icon">⚠️</div>
            <h3>Remover Membro do Grupo?</h3>
            <p>
              Tem certeza de que deseja remover <strong>{memberToKick.userName}</strong>? A conexão
              WebRTC será encerrada e ele será impedido de sincronizar com a equipe.
            </p>
            <div class="dialog-buttons">
              <button class="action-btn ghost" on:click={cancelKick}>Cancelar</button>
              <button class="action-btn danger" on:click={executeKick}>Sim, Remover Membro</button>
            </div>
          </div>
        </div>
      {/if}

      <!-- EXTENSION INSTALLATION INSTRUCTIONS MODAL OVERLAY -->
      {#if showExtensionInstallDialog}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="confirm-overlay" on:click|self={() => (showExtensionInstallDialog = false)}>
          <div class="confirm-dialog extension-dialog">
            <div class="dialog-icon">🧩</div>
            <h3>Extensão de Navegador Necessária</h3>
            <p>
              Para continuar funcionando como <strong>ponte P2P mesmo com o site fechado</strong>, é
              necessário instalar a extensão no seu navegador (compatível com
              <strong>Google Chrome, Microsoft Edge e Mozilla Firefox</strong>).
            </p>
            <div class="extension-download-bar">
              <a
                href="/p2p-relay-extension.zip"
                download="p2p-relay-extension.zip"
                class="action-btn primary small download-btn"
              >
                📥 Baixar Extensão (.ZIP)
              </a>
              <button
                type="button"
                class="action-btn secondary small"
                on:click={() => copyToClipboard('chrome://extensions', 'link')}
              >
                📋 Copiar chrome://extensions
              </button>
            </div>

            <div class="install-steps-box">
              <div class="install-step-item">
                <span class="step-num-pill">1</span>
                <span
                  >Baixe o pacote acima e descompacte o arquivo <code>p2p-relay-extension.zip</code
                  >.</span
                >
              </div>
              <div class="install-step-item">
                <span class="step-num-pill">2</span>
                <span
                  >Abra <code>chrome://extensions</code> no Chrome, <code>edge://extensions</code>
                  no Edge ou <code>about:debugging</code> no Firefox.</span
                >
              </div>
              <div class="install-step-item">
                <span class="step-num-pill">3</span>
                <span
                  >Ative o <strong>Modo Desenvolvedor</strong> e clique em
                  <strong>Carregar sem compactação</strong> (selecione a pasta da extensão).</span
                >
              </div>
            </div>
            <div class="dialog-buttons">
              <button
                class="action-btn ghost"
                on:click={() => (showExtensionInstallDialog = false)}
              >
                Fechar
              </button>
              <button class="action-btn primary" on:click={handleToggleExtensionRelay}>
                🔄 Já Instalei, Ativar Agora
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .p2p-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: var(--theme-bg-overlay, rgba(0, 0, 0, 0.65));
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
  }

  .p2p-modal-window {
    position: relative;
    width: 700px;
    max-width: 95vw;
    height: 580px;
    max-height: 90vh;
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 6px;
    box-shadow: var(--theme-shadow-lg, 0 16px 40px rgba(0, 0, 0, 0.65));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--theme-t-main, #cccccc);
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
  }

  /* Header (svelte-jsoneditor standard: azul #3883fa) */
  .p2p-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    height: 38px;
    min-height: 38px;
    background: var(--theme-ac, #3883fa);
    color: #ffffff;
    user-select: none;
    flex-shrink: 0;
  }

  .p2p-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .p2p-header-title {
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
  }

  .p2p-header-badge {
    font-size: 10px;
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
    padding: 2px 7px;
    border-radius: 10px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  .p2p-modal-close {
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 20px;
    line-height: 1;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .p2p-modal-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* FOLDER SELECTION BAR */
  .folder-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 14px;
    background: var(--theme-bg-chrome, #181818);
    border-bottom: 1px solid var(--theme-b-main, #3e3e42);
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .folder-bar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .folder-bar-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-muted, #94a3b8);
    white-space: nowrap;
  }

  .folder-select {
    flex: 1;
    max-width: 320px;
    height: 28px;
    padding: 2px 8px;
    background: var(--theme-bg-input, #202022);
    color: var(--theme-t-bright, #ffffff);
    border: 1px solid var(--theme-b-input, #3c3c3c);
    border-radius: 4px;
    font-size: 12px;
    outline: none;
    cursor: pointer;
  }

  .folder-select:focus {
    border-color: var(--theme-ac, #3883fa);
  }

  .folder-bar-right {
    display: flex;
    align-items: center;
  }

  .folder-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
  }

  .folder-status-badge.badge-active {
    background: var(--theme-ac-subtle, rgba(56, 131, 250, 0.15));
    border: 1px solid var(--theme-ac, #3883fa);
    color: var(--theme-accent-text, #38bdf8);
  }

  .folder-status-badge.badge-isolated {
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--theme-b-main, #3e3e42);
    color: var(--theme-t-muted, #94a3b8);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .status-dot.online {
    background: #10b981;
    box-shadow: 0 0 6px #10b981;
  }

  .status-dot.isolated {
    background: var(--theme-t-muted, #94a3b8);
  }

  /* TABS BAR */
  .p2p-tabs-bar {
    display: flex;
    background: var(--theme-bg-chrome, #181818);
    border-bottom: 1px solid var(--theme-b-main, #3e3e42);
    padding: 0 12px;
    gap: 4px;
    overflow-x: auto;
    flex-shrink: 0;
  }

  .tab-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--theme-t-muted, #94a3b8);
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.12s ease;
    white-space: nowrap;
    outline: none;
  }

  .tab-btn:hover {
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--theme-t-bright, #ffffff);
  }

  .tab-btn.active {
    color: var(--theme-accent-text, #38bdf8);
    border-bottom: 2px solid var(--theme-ac, #3883fa);
    font-weight: 600;
    background: transparent;
  }

  .badge-count {
    background: var(--theme-chip-bg, rgba(255, 255, 255, 0.08));
    color: var(--theme-accent-text, #38bdf8);
    border: 1px solid var(--theme-chip-border, rgba(255, 255, 255, 0.14));
    border-radius: 10px;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: 700;
  }

  /* MODAL BODY */
  .p2p-modal-body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--theme-bg-card, #252526);
    color: var(--theme-t-main, #cccccc);
    box-sizing: border-box;
  }

  /* EMPTY GROUP CARD */
  .empty-group-card {
    text-align: center;
    padding: 24px 16px;
    background: var(--theme-bg-panel, #202021);
    border: 1px dashed var(--theme-b-main, #3e3e42);
    border-radius: 4px;
  }

  .empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }

  .empty-group-card h3 {
    margin: 0 0 6px 0;
    font-size: 16px;
    color: var(--theme-t-bright, #ffffff);
  }

  .empty-group-card p {
    margin: 0 auto 16px auto;
    font-size: 12px;
    color: var(--theme-t-muted, #94a3b8);
    max-width: 480px;
    line-height: 1.5;
  }

  .create-group-form {
    max-width: 460px;
    margin: 0 auto 16px auto;
    text-align: left;
  }

  .form-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--theme-t-bright, #ffffff);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .input-with-button {
    display: flex;
    gap: 8px;
  }

  .text-input {
    flex: 1;
    background: var(--theme-bg-input, #202022);
    border: 1px solid var(--theme-b-input, #3c3c3c);
    border-radius: 4px;
    padding: 7px 10px;
    color: var(--theme-t-bright, #ffffff);
    font-size: 12px;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.15s;
  }

  .text-input:focus {
    border-color: var(--theme-ac, #3883fa);
  }

  .text-input.readonly {
    opacity: 0.8;
    cursor: default;
    background: var(--theme-bg-chrome, #181818);
    color: var(--theme-t-muted, #94a3b8);
  }

  /* CALLOUT */
  .info-callout {
    display: flex;
    gap: 10px;
    background: var(--theme-ac-subtle, rgba(56, 131, 250, 0.1));
    border: 1px solid var(--theme-ac, rgba(56, 131, 250, 0.25));
    border-radius: 4px;
    padding: 10px 12px;
    text-align: left;
    max-width: 480px;
    margin: 0 auto;
    font-size: 11px;
    color: var(--theme-t-main, #cccccc);
    line-height: 1.45;
  }

  .callout-icon {
    font-size: 14px;
  }

  .callout-text strong {
    color: var(--theme-t-bright, #ffffff);
  }

  /* GROUP BANNER */
  .group-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--theme-bg-panel, #202021);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 4px;
    padding: 10px 14px;
    flex-wrap: wrap;
    gap: 10px;
  }

  .group-title-section {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .group-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--theme-t-bright, #ffffff);
  }

  .group-id-pill {
    background: var(--theme-chip-bg, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--theme-chip-border, rgba(255, 255, 255, 0.14));
    color: var(--theme-t-muted, #94a3b8);
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: Consolas, monospace;
  }

  .role-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
  }

  .role-badge.owner {
    background: rgba(234, 179, 8, 0.18);
    color: #eab308;
    border: 1px solid rgba(234, 179, 8, 0.35);
  }

  .role-badge.member {
    background: var(--theme-ac-subtle, rgba(56, 131, 250, 0.18));
    color: var(--theme-accent-text, #38bdf8);
    border: 1px solid var(--theme-ac, rgba(56, 131, 250, 0.3));
  }

  .group-actions {
    display: flex;
    gap: 6px;
  }

  /* COMPACT SMART TOGGLE STRIP */
  .sync-toggles-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 8px;
    margin-bottom: 4px;
  }

  .toggle-pill-card {
    background: var(--theme-bg-panel, #202021);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 4px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    transition: all 0.15s ease;
  }

  .toggle-pill-card:hover {
    border-color: var(--theme-ac, #3883fa);
  }

  .toggle-pill-card.paused {
    border-color: var(--theme-b-main, #3e3e42);
    opacity: 0.88;
  }

  .toggle-pill-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .pill-icon {
    font-size: 15px;
    line-height: 1;
    flex-shrink: 0;
  }

  .pill-texts {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pill-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--theme-t-bright, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill-status {
    font-size: 10px;
    color: var(--theme-t-muted, #94a3b8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .pill-btn {
    border: 1px solid var(--theme-b-main, #3e3e42);
    background: var(--theme-bg-chrome, #181818);
    color: var(--theme-t-main, #cccccc);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pill-btn:hover:not(:disabled) {
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
    border-color: var(--theme-ac, #3883fa);
    color: var(--theme-t-bright, #ffffff);
  }

  .pill-btn.active {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.35);
    color: var(--theme-danger-text, #f87171);
  }

  .pill-btn.active:hover {
    background: #dc2626;
    color: #ffffff;
  }

  .pill-btn.mini-primary {
    background: var(--theme-ac, #3883fa);
    border-color: var(--theme-ac, #3883fa);
    color: #ffffff;
  }

  .pill-btn.mini-primary:hover {
    background: var(--theme-ac-hover, #0067b8);
  }

  .pill-btn.flushing {
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.8;
    }
  }

  /* LIVE PROFILE PREVIEW */
  .live-preview-box {
    margin-bottom: 12px;
    background: var(--theme-bg-chrome, #181818);
    border: 1px dashed var(--theme-b-main, #3e3e42);
    border-radius: 4px;
    padding: 8px 10px;
  }

  .preview-micro-label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--theme-t-muted, #94a3b8);
    margin-bottom: 6px;
  }

  .preview-card {
    background: var(--theme-bg-panel, #202021) !important;
    border-color: var(--theme-ac, #3883fa) !important;
  }

  .live-status-pill {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(52, 211, 153, 0.15);
    color: var(--theme-method-get, #34d399);
    border: 1px solid rgba(52, 211, 153, 0.3);
  }

  /* MEMBERS SECTION */
  .members-section {
    margin-top: 4px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .section-header h4 {
    margin: 0;
    font-size: 13px;
    color: var(--theme-t-bright, #ffffff);
  }

  .connected-badge {
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
  }

  .members-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .member-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--theme-bg-panel, #202021);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 4px;
    padding: 8px 12px;
    transition: border-color 0.15s;
  }

  .member-card.is-local {
    border-color: var(--theme-ac, #3883fa);
  }

  .member-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-weight: 700;
    font-size: 11px;
    flex-shrink: 0;
  }

  .member-info {
    flex: 1;
    min-width: 0;
  }

  .member-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .member-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--theme-t-bright, #ffffff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .tag.local-tag {
    background: var(--theme-ac-subtle, rgba(56, 131, 250, 0.2));
    color: var(--theme-accent-text, #38bdf8);
  }

  .tag.owner-tag {
    background: rgba(234, 179, 8, 0.18);
    color: #eab308;
    border: 1px solid rgba(234, 179, 8, 0.3);
  }

  .member-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
  }

  .peer-id-snippet {
    font-family: Consolas, monospace;
    opacity: 0.8;
  }

  .latency-pill {
    background: rgba(52, 211, 153, 0.15);
    color: var(--theme-method-get, #34d399);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
  }

  .latency-pill.offline {
    background: var(--theme-chip-bg, rgba(255, 255, 255, 0.08));
    color: var(--theme-t-muted, #94a3b8);
  }

  .e2ee-pill {
    background: rgba(56, 189, 248, 0.12);
    color: var(--theme-accent-text, #38bdf8);
    border: 1px solid rgba(56, 189, 248, 0.3);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
  }

  .kick-btn {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--theme-danger-text, #f87171);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    white-space: nowrap;
  }

  .kick-btn:hover {
    background: #dc2626;
    color: #ffffff;
  }

  /* STEP CARDS (INVITE / JOIN) */
  .step-card {
    background: var(--theme-bg-panel, #202021);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 4px;
    padding: 14px;
    margin-bottom: 12px;
  }

  .step-card.highlight {
    border-color: var(--theme-ac, #3883fa);
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .step-num {
    background: var(--theme-ac, #3883fa);
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 8px;
  }

  .step-header h4 {
    margin: 0;
    font-size: 13px;
    color: var(--theme-t-bright, #ffffff);
  }

  .step-desc {
    margin: 0 0 10px 0;
    font-size: 12px;
    color: var(--theme-t-muted, #94a3b8);
    line-height: 1.4;
  }

  .token-textarea {
    width: 100%;
    background: var(--theme-bg-input, #202022);
    border: 1px solid var(--theme-b-input, #3c3c3c);
    border-radius: 4px;
    padding: 8px;
    color: var(--theme-t-bright, #ffffff);
    font-family: Consolas, monospace;
    font-size: 11px;
    box-sizing: border-box;
    resize: vertical;
    outline: none;
  }

  .token-textarea:focus {
    border-color: var(--theme-ac, #3883fa);
  }

  .token-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }

  .qr-preview-section {
    margin-top: 12px;
    text-align: center;
    background: var(--theme-bg-chrome, #181818);
    border: 1px solid var(--theme-b-main, #3e3e42);
    padding: 12px;
    border-radius: 4px;
  }

  .qr-label {
    display: block;
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
    margin-bottom: 8px;
  }

  .qr-wrapper {
    display: inline-block;
    background: #ffffff;
    padding: 8px;
    border-radius: 4px;
    border: 1px solid #cbd5e1;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: var(--theme-danger-text, #f87171);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 11px;
    margin-top: 6px;
    margin-bottom: 6px;
  }

  .success-banner {
    background: rgba(52, 211, 153, 0.15);
    border: 1px solid rgba(52, 211, 153, 0.35);
    color: var(--theme-method-get, #34d399);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 11px;
    margin-top: 6px;
    margin-bottom: 6px;
  }

  /* INCOMING TOKEN PREVIEW & FOLDER DESTINATION */
  .incoming-preview-box {
    margin-top: 10px;
    margin-bottom: 12px;
    background: var(--theme-bg-chrome, #181818);
    border: 1px solid var(--theme-ac, #3883fa);
    border-radius: 4px;
    padding: 12px;
  }

  .incoming-preview-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .preview-icon {
    font-size: 20px;
  }

  .preview-text {
    flex: 1;
    min-width: 0;
  }

  .preview-folder-name {
    font-size: 13px;
    color: var(--theme-t-bright, #ffffff);
    margin-bottom: 2px;
  }

  .preview-group-name {
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
  }

  .preview-targets {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 10px;
    background: var(--theme-bg-panel, #202021);
    padding: 8px 10px;
    border-radius: 4px;
    border: 1px solid var(--theme-b-main, #3e3e42);
  }

  .preview-radio {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--theme-t-main, #cccccc);
    cursor: pointer;
  }

  .preview-radio input {
    cursor: pointer;
    accent-color: var(--theme-ac, #3883fa);
  }

  .preview-isolation-alert {
    font-size: 11px;
    line-height: 1.4;
    color: var(--theme-accent-text, #38bdf8);
    background: var(--theme-ac-subtle, rgba(56, 131, 250, 0.1));
    border: 1px solid rgba(56, 131, 250, 0.3);
    padding: 6px 10px;
    border-radius: 4px;
  }

  /* SETTINGS */
  .settings-card {
    background: var(--theme-bg-panel, #202021);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 4px;
    padding: 14px;
    margin-bottom: 12px;
  }

  .settings-card h4 {
    margin: 0 0 4px 0;
    font-size: 13px;
    color: var(--theme-t-bright, #ffffff);
  }

  .card-desc {
    margin: 0 0 12px 0;
    font-size: 12px;
    color: var(--theme-t-muted, #94a3b8);
  }

  .form-group {
    margin-bottom: 12px;
  }

  .palette-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .color-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition:
      transform 0.15s,
      border-color 0.15s;
  }

  .color-dot:hover {
    transform: scale(1.15);
  }

  .color-dot.selected {
    border-color: var(--theme-t-bright, #ffffff);
    box-shadow: 0 0 0 2px var(--theme-ac, #3883fa);
    transform: scale(1.15);
  }

  .diag-list {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
    color: var(--theme-t-muted, #94a3b8);
    line-height: 1.7;
  }

  .diag-list strong {
    color: var(--theme-t-bright, #ffffff);
  }

  /* BUTTONS */
  .action-btn {
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.12s ease;
    font-family: inherit;
  }

  .action-btn:active {
    transform: scale(0.98);
  }

  .action-btn.primary {
    background: var(--theme-ac, #3883fa);
    border-color: var(--theme-ac, #3883fa);
    color: #ffffff;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--theme-ac-hover, #0067b8);
    border-color: var(--theme-ac-hover, #0067b8);
  }

  .action-btn.secondary {
    background: var(--theme-bg-chrome, #181818);
    border-color: var(--theme-b-main, #3e3e42);
    color: var(--theme-t-bright, #ffffff);
  }

  .action-btn.secondary:hover {
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.08));
    border-color: var(--theme-b-input-hover, #4e4e4e);
  }

  .action-btn.danger {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    color: var(--theme-danger-text, #f87171);
  }

  .action-btn.danger:hover {
    background: #dc2626;
    border-color: #dc2626;
    color: #ffffff;
  }

  .action-btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--theme-t-muted, #94a3b8);
  }

  .action-btn.ghost:hover {
    background: var(--theme-bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--theme-t-bright, #ffffff);
  }

  .action-btn.small {
    padding: 4px 8px;
    font-size: 11px;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* CONFIRM DIALOG OVERLAY */
  .confirm-overlay {
    position: absolute;
    inset: 0;
    background: var(--theme-bg-overlay, rgba(0, 0, 0, 0.65));
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
  }

  .confirm-dialog {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-main, #3e3e42);
    border-radius: 6px;
    padding: 16px 20px;
    max-width: 400px;
    text-align: center;
    box-shadow: var(--theme-shadow-lg, 0 16px 40px rgba(0, 0, 0, 0.65));
    color: var(--theme-t-main, #cccccc);
  }

  .dialog-icon {
    font-size: 28px;
    margin-bottom: 6px;
  }

  .confirm-dialog h3 {
    margin: 0 0 6px 0;
    font-size: 15px;
    color: var(--theme-t-bright, #ffffff);
  }

  .confirm-dialog p {
    margin: 0 0 16px 0;
    font-size: 12px;
    color: var(--theme-t-muted, #94a3b8);
    line-height: 1.45;
  }

  .dialog-buttons {
    display: flex;
    justify-content: center;
    gap: 8px;
  }

  /* E2EE BADGES & SAS STYLES */
  .e2ee-pill {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--theme-ac-subtle, rgba(56, 131, 250, 0.15));
    border: 1px solid var(--theme-b-main, rgba(56, 131, 250, 0.3));
    color: var(--theme-accent-text, #38bdf8);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .preview-e2ee-alert {
    margin-top: 10px;
    padding: 10px 12px;
    background: var(--theme-bg-panel, #202021);
    border: 1px solid var(--theme-ac, #3883fa);
    border-radius: 4px;
    font-size: 11px;
    color: var(--theme-t-main, #d4d4d4);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .e2ee-badge-row {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--theme-t-bright, #ffffff);
    font-size: 12px;
  }

  .preview-sas-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--theme-bg-input, #202022);
    border: 1px solid var(--theme-b-input, #3c3c3c);
    border-radius: 4px;
  }

  .sas-label {
    font-size: 11px;
    color: var(--theme-t-muted, #94a3b8);
  }

  .sas-code {
    font-family: monospace;
    font-size: 14px;
    letter-spacing: 1.5px;
    color: var(--theme-accent-text, #38bdf8);
  }

  .e2ee-desc {
    font-size: 10.5px;
    color: var(--theme-t-muted, #94a3b8);
    line-height: 1.35;
  }

  .extension-dialog {
    max-width: 480px;
    text-align: left;
  }

  .extension-dialog h3 {
    text-align: center;
  }

  .extension-dialog p {
    text-align: left;
    margin-bottom: 12px;
  }

  .install-steps-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--theme-bg-input, #202022);
    border: 1px solid var(--theme-b-input, #3c3c3c);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 16px;
  }

  .install-step-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 11px;
    color: var(--theme-t-main, #d4d4d4);
    line-height: 1.4;
  }

  .install-step-item code {
    background: var(--theme-bg-card, #252526);
    border: 1px solid var(--theme-b-main, #3e3e42);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 10.5px;
    color: var(--theme-accent-text, #38bdf8);
  }

  .step-num-pill {
    background: var(--theme-ac, #3883fa);
    color: #ffffff;
    font-size: 10px;
    font-weight: 600;
    min-width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .extension-download-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }

  .download-btn {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
</style>
