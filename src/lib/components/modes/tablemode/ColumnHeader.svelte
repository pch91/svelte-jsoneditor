<svelte:options immutable={true} />

<script lang="ts">
  import type { JSONPath } from 'immutable-json-patch'
  import type { SortedColumn } from '$lib/types.js'
  import { SortDirection } from '$lib/types.js'
  import { stringifyJSONPath } from '$lib/utils/pathUtils.js'
  import Icon from 'svelte-awesome'
  import { faCaretDown, faCaretUp } from '@fortawesome/free-solid-svg-icons'
  import { isEmpty, isEqual } from 'lodash-es'
  import { MAX_HEADER_NAME_CHARACTERS, SORT_DIRECTION_NAMES } from '$lib/constants.js'
  import { truncate } from '$lib/utils/stringUtils.js'
  import { PARENT_BADGE_COLORS } from '$lib/logic/tableJsonExpansion.js'

  export let path: JSONPath
  export let sortedColumn: SortedColumn | undefined
  export let readOnly: boolean
  export let onSort: (sortedColumn: SortedColumn) => void

  export let isExpandable: boolean = false
  export let isExpanded: boolean = false
  export let parentName: string | undefined = undefined
  export let displayName: string | undefined = undefined
  export let colorIndex: number | undefined = undefined
  export let isArrayElement: boolean = false
  export let onToggleExpand: (() => void) | undefined = undefined
  export let onContextMenu: ((event: MouseEvent) => void) | undefined = undefined

  $: rawColumnName = displayName ?? (!isEmpty(path) ? stringifyJSONPath(path) : 'values')
  $: columnName = rawColumnName

  $: sortDirection =
    sortedColumn && isEqual(path, sortedColumn?.path) ? sortedColumn.sortDirection : undefined

  $: sortDirectionName = sortDirection ? SORT_DIRECTION_NAMES[sortDirection] : undefined

  $: badgeColor =
    colorIndex !== undefined
      ? PARENT_BADGE_COLORS[colorIndex % PARENT_BADGE_COLORS.length]
      : PARENT_BADGE_COLORS[0]

  function handleSort() {
    if (readOnly) {
      return
    }

    onSort({
      path,
      sortDirection: sortDirection === SortDirection.asc ? SortDirection.desc : SortDirection.asc
    })
  }

  function handleContextMenu(event: MouseEvent) {
    if (onContextMenu) {
      event.preventDefault()
      event.stopPropagation()
      onContextMenu(event)
    }
  }

  function handleToggle(event: MouseEvent) {
    event.stopPropagation()
    onToggleExpand?.()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<button
  type="button"
  class="jse-column-header"
  class:jse-readonly={readOnly}
  class:jse-expanded-column={isExpanded}
  on:click={handleSort}
  on:contextmenu={handleContextMenu}
  title={!readOnly ? columnName + ' (Click to sort the data by this column)' : columnName}
>
  {#if parentName}
    <span
      class="jse-column-parent-badge"
      style="background: {badgeColor.bg}; border-color: {badgeColor.border}; color: {badgeColor.text};"
      title="Origem: {parentName}{isArrayElement ? ' (lista)' : ' (objeto)'}"
    >
      {parentName}{isArrayElement ? '[]' : ''}
    </span>
  {/if}

  <span class="jse-column-name">
    {truncate(columnName, MAX_HEADER_NAME_CHARACTERS)}
  </span>

  {#if isExpanded}
    <span
      class="jse-column-toggle-btn"
      on:click={handleToggle}
      role="button"
      tabindex="0"
      title="Recolher sub-colunas"
    >
      ◱
    </span>
  {:else if isExpandable}
    <span
      class="jse-column-toggle-btn"
      on:click={handleToggle}
      role="button"
      tabindex="0"
      title="Expandir sub-colunas JSON"
    >
      ◲
    </span>
  {/if}

  {#if sortDirection !== undefined}
    <span class="jse-column-sort-icon" title={`Currently sorted in ${sortDirectionName} order`}>
      <Icon data={sortDirection === SortDirection.asc ? faCaretUp : faCaretDown} />
    </span>
  {/if}
</button>

<style src="./ColumnHeader.scss"></style>
