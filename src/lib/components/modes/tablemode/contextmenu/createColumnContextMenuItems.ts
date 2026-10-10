import type { ContextMenuItem } from 'svelte-jsoneditor'
import { faCaretDown, faCaretUp, faCompress, faExpand } from '@fortawesome/free-solid-svg-icons'
import type { JSONPath } from 'immutable-json-patch'
import type { SortedColumn } from '$lib/types.js'
import { SortDirection } from '$lib/types.js'

export default function createColumnContextMenuItems({
  columnPath,
  parentPath,
  isExpandable,
  isExpanded,
  onToggleExpand,
  onSort,
  sortedColumn,
  readOnly
}: {
  columnPath: JSONPath
  parentPath?: JSONPath
  isExpandable: boolean
  isExpanded: boolean
  onToggleExpand: (path: JSONPath) => void
  onSort: (sortedColumn: SortedColumn) => void
  sortedColumn?: SortedColumn
  readOnly: boolean
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = []

  if (isExpandable || isExpanded) {
    items.push({
      type: 'row',
      items: [
        {
          type: 'column',
          items: [
            { type: 'label', text: 'Visualização JSON:' },
            {
              type: 'button',
              icon: isExpanded ? faCompress : faExpand,
              text: isExpanded ? 'Recolher sub-colunas' : 'Expandir sub-colunas JSON',
              title: isExpanded
                ? 'Recolher sub-colunas de volta para a coluna original'
                : 'Expandir objetos ou arrays desta coluna em sub-colunas para comparar na tabela',
              onClick: () => onToggleExpand(parentPath ?? columnPath)
            }
          ]
        }
      ]
    })
    items.push({ type: 'separator' })
  }

  if (!readOnly) {
    const isSortedAsc =
      sortedColumn &&
      JSON.stringify(sortedColumn.path) === JSON.stringify(columnPath) &&
      sortedColumn.sortDirection === SortDirection.asc
    const isSortedDesc =
      sortedColumn &&
      JSON.stringify(sortedColumn.path) === JSON.stringify(columnPath) &&
      sortedColumn.sortDirection === SortDirection.desc

    items.push({
      type: 'row',
      items: [
        {
          type: 'column',
          items: [
            { type: 'label', text: 'Ordenar:' },
            {
              type: 'button',
              icon: faCaretUp,
              text: 'Ordenar crescente',
              title: 'Ordenar valores em ordem crescente (A-Z / 0-9)',
              disabled: isSortedAsc,
              onClick: () =>
                onSort({
                  path: columnPath,
                  sortDirection: SortDirection.asc
                })
            },
            {
              type: 'button',
              icon: faCaretDown,
              text: 'Ordenar decrescente',
              title: 'Ordenar valores em ordem decrescente (Z-A / 9-0)',
              disabled: isSortedDesc,
              onClick: () =>
                onSort({
                  path: columnPath,
                  sortDirection: SortDirection.desc
                })
            }
          ]
        }
      ]
    })
  }

  return items
}
