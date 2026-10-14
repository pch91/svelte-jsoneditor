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
            { type: 'label', text: 'JSON View:' },
            {
              type: 'button',
              icon: isExpanded ? faCompress : faExpand,
              text: isExpanded ? 'Collapse sub-columns' : 'Expand JSON sub-columns',
              title: isExpanded
                ? 'Collapse sub-columns back to original column'
                : 'Expand objects or arrays in this column into sub-columns to compare in table',
              onClick: () =>
                onToggleExpand(isExpandable ? columnPath : (parentPath ?? columnPath))
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
            { type: 'label', text: 'Sort:' },
            {
              type: 'button',
              icon: faCaretUp,
              text: 'Sort ascending',
              title: 'Sort values in ascending order (A-Z / 0-9)',
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
              text: 'Sort descending',
              title: 'Sort values in descending order (Z-A / 9-0)',
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
