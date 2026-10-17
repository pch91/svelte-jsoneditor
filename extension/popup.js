/**
 * Extension Popup Logic (Chrome, Edge & Firefox)
 */

const ext = typeof browser !== 'undefined' ? browser : chrome

const statusBadge = document.getElementById('status-badge')
const masterSub = document.getElementById('master-sub')
const btnToggleGlobal = document.getElementById('btn-toggle-global')
const groupCountBadge = document.getElementById('group-count-badge')
const groupsList = document.getElementById('groups-list')

async function refreshUI() {
  const data = await ext.storage.local.get(['globalPaused', 'savedGroups'])
  const globalPaused = data.globalPaused || false
  const savedGroups = data.savedGroups || {}
  const groupArray = Object.values(savedGroups)

  // Status Badge & Master Controls
  if (globalPaused) {
    statusBadge.textContent = '⏸ Pausado'
    statusBadge.className = 'header-badge paused'
    masterSub.textContent = 'Sincronismo em 2º plano suspenso'
    btnToggleGlobal.textContent = '▶ Reativar Tudo'
    btnToggleGlobal.className = 'btn-toggle'
  } else {
    statusBadge.textContent = '🟢 Ativo'
    statusBadge.className = 'header-badge'
    masterSub.textContent = 'Retransmitindo dados em 2º plano'
    btnToggleGlobal.textContent = '⏸ Pausar Tudo'
    btnToggleGlobal.className = 'btn-toggle is-paused'
  }

  // Group Count
  groupCountBadge.textContent = `${groupArray.length} ${groupArray.length === 1 ? 'grupo' : 'grupos'}`

  // Render Groups
  if (groupArray.length === 0) {
    groupsList.innerHTML = `
      <div class="empty-state">
        Nenhum grupo registrado ainda.<br>
        Crie ou entre em um grupo no site para sincronizar.
      </div>
    `
    return
  }

  groupsList.innerHTML = ''
  for (const group of groupArray) {
    const isPaused = globalPaused || group.paused

    const card = document.createElement('div')
    card.className = `group-card ${isPaused ? 'paused' : ''}`

    card.innerHTML = `
      <div class="group-card-left">
        <span class="group-card-name" title="${group.name}">${group.name}</span>
        <span class="group-card-meta">
          <span>${isPaused ? '⚪ Pausado' : '🟢 Sincronizando'}</span>
          <span>•</span>
          <span>ID: ${group.groupId.slice(0, 8)}...</span>
        </span>
      </div>
      <button type="button" class="btn-group-toggle" data-id="${group.groupId}">
        ${group.paused ? 'Ativar' : 'Pausar'}
      </button>
    `

    const toggleBtn = card.querySelector('.btn-group-toggle')
    toggleBtn.addEventListener('click', async () => {
      await ext.runtime.sendMessage({
        action: 'TOGGLE_GROUP_PAUSE',
        groupId: group.groupId
      })
      await refreshUI()
    })

    groupsList.appendChild(card)
  }
}

btnToggleGlobal.addEventListener('click', async () => {
  await ext.runtime.sendMessage({ action: 'TOGGLE_GLOBAL_PAUSE' })
  await refreshUI()
})

// Listen to changes in storage to update UI immediately
ext.storage.onChanged.addListener(() => {
  refreshUI()
})

refreshUI()
