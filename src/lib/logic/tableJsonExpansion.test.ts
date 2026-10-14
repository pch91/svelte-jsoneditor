import { describe, expect, test } from 'vitest'
import type { JSONPatchReplace } from 'immutable-json-patch'
import {
  buildVisualColumns,
  buildVisualRows,
  collectExpandableDescendantPaths,
  createVisualCellPatch,
  getRowSortValue,
  getVisualCellPath,
  getVisualCellValue,
  isColumnExpandable,
  sortJsonWithExpansion,
  transformOperationsForStringJson,
  tryParseJson
} from './tableJsonExpansion.js'

describe('tableJsonExpansion', () => {
  // Test data matching user screenshot
  const testData = [
    {
      id: 1,
      nome: 'João',
      endereco: '{"rua":"Rua A","cidade":"Porto"}',
      configuracao: [
        { tema: 'escuro', idioma: 'pt' },
        { tema: 'escuro', idioma: 'rt' }
      ],
      configuracao2: { cena: 'escuro', idioma: 'pt' }
    },
    {
      id: 2,
      nome: 'Maria',
      endereco: '{"rua":"Rua B","cidade":"Lisboa"}',
      configuracao: [
        { tema: 'claro', idioma: 'en' },
        { tema: 'escuro', idioma: 'yt' }
      ],
      configuracao2: { cena: 'escuro', idioma: 'pt' }
    }
  ]

  test('tryParseJson detects stringified JSON vs native objects', () => {
    const strObj = tryParseJson('{"rua":"Rua A"}')
    expect(strObj.isStringJson).toBe(true)
    expect(strObj.parsed).toEqual({ rua: 'Rua A' })

    const nativeObj = tryParseJson({ cena: 'escuro' })
    expect(nativeObj.isStringJson).toBe(false)
    expect(nativeObj.parsed).toEqual({ cena: 'escuro' })

    const plainStr = tryParseJson('hello world')
    expect(plainStr.isStringJson).toBe(false)
    expect(plainStr.parsed).toBe('hello world')
  })

  test('isColumnExpandable detects objects, arrays, and stringified JSON', () => {
    expect(isColumnExpandable(testData, ['endereco'])).toBe(true)
    expect(isColumnExpandable(testData, ['configuracao'])).toBe(true)
    expect(isColumnExpandable(testData, ['configuracao2'])).toBe(true)
    expect(isColumnExpandable(testData, ['nome'])).toBe(false)
    expect(isColumnExpandable(testData, ['id'])).toBe(false)
  })

  test('buildVisualColumns expands object and stringified JSON into sub-columns', () => {
    const originalColumns = [['id'], ['nome'], ['endereco']]
    const expandedColumns = { '/endereco': true }

    const vCols = buildVisualColumns(originalColumns, expandedColumns, testData)
    expect(vCols.map((c) => c.displayName)).toEqual(['id', 'nome', 'rua', 'cidade'])
    expect(vCols[2].parentName).toBe('endereco')
    expect(vCols[2].isStringJson).toBe(true)
    expect(vCols[2].isArrayElement).toBe(false)
  })

  test('buildVisualColumns expands array into sub-columns', () => {
    const originalColumns = [['id'], ['configuracao']]
    const expandedColumns = { '/configuracao': true }

    const vCols = buildVisualColumns(originalColumns, expandedColumns, testData)
    expect(vCols.map((c) => c.displayName)).toEqual(['id', 'tema', 'idioma'])
    expect(vCols[1].parentName).toBe('configuracao')
    expect(vCols[1].isArrayElement).toBe(true)
  })

  test('buildVisualRows unnest rows in parallel (zip) when expanding array', () => {
    const originalColumns = [['id'], ['configuracao']]
    const expandedColumns = { '/configuracao': true }
    const vCols = buildVisualColumns(originalColumns, expandedColumns, testData)

    const vRows = buildVisualRows(testData, vCols)
    // 2 original rows, each with 2 array items -> 4 visual rows
    expect(vRows.length).toBe(4)
    expect(vRows[0]).toEqual({
      originalRowIndex: 0,
      subRowIndex: 0,
      isSubRow: false,
      subRowTotal: 2
    })
    expect(vRows[1]).toEqual({
      originalRowIndex: 0,
      subRowIndex: 1,
      isSubRow: true,
      subRowTotal: 2
    })
  })

  test('buildVisualRows aligns multiple arrays by index (Zip) without combinatorial explosion', () => {
    const multiArrayData = [
      {
        id: 1,
        listA: [{ a: 1 }, { a: 2 }],
        listB: [{ b: 'x' }, { b: 'y' }, { b: 'z' }]
      }
    ]
    const vCols = buildVisualColumns(
      [['id'], ['listA'], ['listB']],
      { '/listA': true, '/listB': true },
      multiArrayData
    )

    const vRows = buildVisualRows(multiArrayData, vCols)
    // max(2, 3) = 3 rows, NOT 2 * 3 = 6 rows!
    expect(vRows.length).toBe(3)
    expect(vRows[0].subRowIndex).toBe(0)
    expect(vRows[1].subRowIndex).toBe(1)
    expect(vRows[2].subRowIndex).toBe(2)
  })

  test('getVisualCellValue retrieves values accurately for normal, object, and array sub-columns', () => {
    const vCols = buildVisualColumns(
      [['id'], ['endereco'], ['configuracao']],
      { '/endereco': true, '/configuracao': true },
      testData
    )
    const vRows = buildVisualRows(testData, vCols)

    const colId = vCols.find((c) => c.displayName === 'id')!
    const colRua = vCols.find((c) => c.displayName === 'rua')!
    const colTema = vCols.find((c) => c.displayName === 'tema')!

    // Row 0, SubRow 0: João, Rua A, escuro
    expect(getVisualCellValue(testData, vRows[0], colId)).toBe(1)
    expect(getVisualCellValue(testData, vRows[0], colRua)).toBe('Rua A')
    expect(getVisualCellValue(testData, vRows[0], colTema)).toBe('escuro')

    // Row 0, SubRow 1: item 1 of configuracao is { tema: "escuro", idioma: "rt" }
    const colIdioma = vCols.find((c) => c.displayName === 'idioma')!
    expect(getVisualCellValue(testData, vRows[1], colIdioma)).toBe('rt')

    // Row 1, SubRow 0: Maria, Rua B, claro
    expect(getVisualCellValue(testData, vRows[2], colRua)).toBe('Rua B')
    expect(getVisualCellValue(testData, vRows[2], colTema)).toBe('claro')
  })

  test('createVisualCellPatch preserves stringified JSON when editing a sub-column', () => {
    const vCols = buildVisualColumns([['endereco']], { '/endereco': true }, testData)
    const vRows = buildVisualRows(testData, vCols)
    const colRua = vCols.find((c) => c.displayName === 'rua')!

    const patch = createVisualCellPatch(testData, vRows[0], colRua, 'Avenida Central')
    expect(patch.op).toBe('replace')
    expect(patch.path).toBe('/0/endereco')
    // Must be serialized back to a string with updated rua:
    expect(patch.value).toBe(JSON.stringify({ rua: 'Avenida Central', cidade: 'Porto' }))
  })

  test('createVisualCellPatch updates native array element directly', () => {
    const vCols = buildVisualColumns([['configuracao']], { '/configuracao': true }, testData)
    const vRows = buildVisualRows(testData, vCols)
    const colTema = vCols.find((c) => c.displayName === 'tema')!

    const patch = createVisualCellPatch(testData, vRows[1], colTema, 'azul')
    expect(patch.op).toBe('replace')
    expect(patch.path).toBe('/0/configuracao/1/tema')
    expect(patch.value).toBe('azul')
  })

  test('transformOperationsForStringJson serializes nested property updates back into string field', () => {
    const ops = [
      {
        op: 'replace' as const,
        path: '/0/endereco/rua',
        value: 'Rua Nova'
      }
    ]
    const transformed = transformOperationsForStringJson(ops, testData)
    expect(transformed[0].op).toBe('replace')
    expect(transformed[0].path).toBe('/0/endereco')
    expect((transformed[0] as JSONPatchReplace).value).toBe(
      JSON.stringify({ rua: 'Rua Nova', cidade: 'Porto' })
    )
  })

  test('getRowSortValue extracts values from plain fields, string JSON, and arrays', () => {
    expect(getRowSortValue(testData[0], ['id'])).toBe(1)
    expect(getRowSortValue(testData[0], ['nome'])).toBe('João')
    // Stringified JSON sub-column:
    expect(getRowSortValue(testData[0], ['endereco', 'cidade'])).toBe('Porto')
    expect(getRowSortValue(testData[1], ['endereco', 'cidade'])).toBe('Lisboa')
    // Array sub-column:
    expect(getRowSortValue(testData[0], ['configuracao', 'tema'])).toBe('escuro')
    expect(getRowSortValue(testData[1], ['configuracao', 'tema'])).toBe('claro')
  })

  test('sortJsonWithExpansion correctly sorts by stringified JSON sub-column', () => {
    // Lisboa (id: 2) comes before Porto (id: 1) alphabetically
    const patchAsc = sortJsonWithExpansion(testData, [], ['endereco', 'cidade'], 1)
    expect(patchAsc[0].op).toBe('replace')
    const sortedAsc = (patchAsc[0] as JSONPatchReplace).value as typeof testData
    expect(sortedAsc[0].id).toBe(2)
    expect(sortedAsc[1].id).toBe(1)

    // Descending: Porto (id: 1) before Lisboa (id: 2)
    const patchDesc = sortJsonWithExpansion(testData, [], ['endereco', 'cidade'], -1)
    const sortedDesc = (patchDesc[0] as JSONPatchReplace).value as typeof testData
    expect(sortedDesc[0].id).toBe(1)
    expect(sortedDesc[1].id).toBe(2)
  })

  test('sortJsonWithExpansion correctly sorts by array sub-column', () => {
    // 'claro' (id: 2) comes before 'escuro' (id: 1)
    const patchAsc = sortJsonWithExpansion(testData, [], ['configuracao', 'tema'], 1)
    const sortedAsc = (patchAsc[0] as JSONPatchReplace).value as typeof testData
    expect(sortedAsc[0].id).toBe(2)
    expect(sortedAsc[1].id).toBe(1)

    // Descending: 'escuro' (id: 1) before 'claro' (id: 2)
    const patchDesc = sortJsonWithExpansion(testData, [], ['configuracao', 'tema'], -1)
    const sortedDesc = (patchDesc[0] as JSONPatchReplace).value as typeof testData
    expect(sortedDesc[0].id).toBe(1)
    expect(sortedDesc[1].id).toBe(2)
  })

  describe('primitive arrays expansion (e.g. tags: ["tag2", "group2"])', () => {
    const primitiveArrayData = [
      {
        id: 1,
        score: 84,
        tags: ['tag2', 'group2'],
        city: 'Porto'
      },
      {
        id: 2,
        score: 95,
        tags: ['tag1'],
        city: 'Lisboa'
      }
    ]

    test('isColumnExpandable returns true for arrays of primitives', () => {
      expect(isColumnExpandable(primitiveArrayData, ['tags'])).toBe(true)
      expect(isColumnExpandable(primitiveArrayData, ['score'])).toBe(false)
    })

    test('buildVisualColumns expands primitive array into visual column with unnested values', () => {
      const originalColumns = [['id'], ['score'], ['tags'], ['city']]
      const expandedColumns = { '/tags': true }

      const vCols = buildVisualColumns(originalColumns, expandedColumns, primitiveArrayData)
      expect(vCols.map((c) => c.displayName)).toEqual(['id', 'score', 'value', 'city'])
      const colTags = vCols.find((c) => c.parentName === 'tags')!
      expect(colTags).toBeDefined()
      expect(colTags.isExpandedSubColumn).toBe(true)
      expect(colTags.isArrayElement).toBe(true)
      expect(colTags.isPrimitiveArray).toBe(true)
      expect(colTags.parentName).toBe('tags')
      expect(colTags.displayName).toBe('value')
    })

    test('buildVisualRows unnests rows according to primitive array length', () => {
      const originalColumns = [['id'], ['score'], ['tags']]
      const expandedColumns = { '/tags': true }
      const vCols = buildVisualColumns(originalColumns, expandedColumns, primitiveArrayData)

      const vRows = buildVisualRows(primitiveArrayData, vCols)
      // Row 0 has 2 tags -> 2 subrows (0.0, 0.1). Row 1 has 1 tag -> 1 subrow (1.0). Total: 3 visual rows.
      expect(vRows.length).toBe(3)
      expect(vRows[0]).toEqual({
        originalRowIndex: 0,
        subRowIndex: 0,
        isSubRow: false,
        subRowTotal: 2
      })
      expect(vRows[1]).toEqual({
        originalRowIndex: 0,
        subRowIndex: 1,
        isSubRow: true,
        subRowTotal: 2
      })
      expect(vRows[2]).toEqual({
        originalRowIndex: 1,
        subRowIndex: 0,
        isSubRow: false,
        subRowTotal: 1
      })
    })

    test('getVisualCellValue returns individual primitive elements for subrows', () => {
      const vCols = buildVisualColumns([['tags']], { '/tags': true }, primitiveArrayData)
      const vRows = buildVisualRows(primitiveArrayData, vCols)
      const colTags = vCols[0]

      expect(getVisualCellValue(primitiveArrayData, vRows[0], colTags)).toBe('tag2')
      expect(getVisualCellValue(primitiveArrayData, vRows[1], colTags)).toBe('group2')
      expect(getVisualCellValue(primitiveArrayData, vRows[2], colTags)).toBe('tag1')
    })

    test('createVisualCellPatch generates exact patch for primitive array item', () => {
      const vCols = buildVisualColumns([['tags']], { '/tags': true }, primitiveArrayData)
      const vRows = buildVisualRows(primitiveArrayData, vCols)
      const colTags = vCols[0]

      // Edit item 1 ('group2') of row 0:
      const patch = createVisualCellPatch(primitiveArrayData, vRows[1], colTags, 'supergroup')
      expect(patch).toEqual({
        op: 'replace',
        path: '/0/tags/1',
        value: 'supergroup'
      })
    })

    test('collapsing primitive array restores original single column', () => {
      const originalColumns = [['id'], ['tags']]
      const collapsedCols = buildVisualColumns(
        originalColumns,
        { '/tags': false },
        primitiveArrayData
      )
      expect(collapsedCols.length).toBe(2)
      expect(collapsedCols[1].displayName).toBe('tags')
      expect(collapsedCols[1].isExpandedSubColumn).toBe(false)
    })

    test('sortJsonWithExpansion sorts by primitive array first element', () => {
      // Row 0 tags are sorted to ['group2','tag2'], row 1 has ['tag1']. group2 comes before tag1.
      const patchAsc = sortJsonWithExpansion(primitiveArrayData, [], ['tags'], 1)
      const sortedAsc = (patchAsc[0] as JSONPatchReplace).value as typeof primitiveArrayData
      expect(sortedAsc[0].id).toBe(1)
      expect(sortedAsc[0].tags).toEqual(['group2', 'tag2'])
      expect(sortedAsc[1].id).toBe(2)
    })
  })

  describe('nested array of objects sorting (e.g. orders[].amount)', () => {
    const customersData = [
      { id: 1003, name: 'Pedro Almeida', orders: [{ id: 'ORD-5004', amount: 45.75 }] },
      { id: 1005, name: 'Ricardo Sousa', orders: [{ id: 'ORD-5007', amount: 99.99 }] },
      {
        id: 1001,
        name: 'João Silva',
        orders: [
          { id: 'ORD-5001', amount: 125.5 },
          { id: 'ORD-5002', amount: 89.9 }
        ]
      },
      {
        id: 1008,
        name: 'Sofia Mendes',
        orders: [
          { id: 'ORD-5009', amount: 149.5 },
          { id: 'ORD-5010', amount: 67.3 }
        ]
      },
      { id: 1002, name: 'Maria Costa', orders: [{ id: 'ORD-5003', amount: 250 }] },
      { id: 1007, name: 'Miguel Rocha', orders: [{ id: 'ORD-5008', amount: 315.2 }] },
      {
        id: 1004,
        name: 'Ana Martins',
        orders: [
          { id: 'ORD-5005', amount: 700 },
          { id: 'ORD-5006', amount: 12.99 }
        ]
      },
      { id: 1006, name: 'Carla Ferreira', orders: [] }
    ]

    test('sortJsonWithExpansion sorts ascending with sub-array items sorted and nulls last', () => {
      const patch = sortJsonWithExpansion(customersData, [], ['orders', 'amount'], 1)
      const sorted = (patch[0] as JSONPatchReplace).value as typeof customersData

      // In ascending order:
      // Ana's orders sorted: 12.99, then 700
      expect(sorted[0].name).toBe('Ana Martins')
      expect(sorted[0].orders[0].amount).toBe(12.99)
      expect(sorted[0].orders[1].amount).toBe(700)

      // Pedro: 45.75
      expect(sorted[1].name).toBe('Pedro Almeida')
      expect(sorted[1].orders[0].amount).toBe(45.75)

      // Sofia's orders sorted: 67.3, then 149.5
      expect(sorted[2].name).toBe('Sofia Mendes')
      expect(sorted[2].orders[0].amount).toBe(67.3)
      expect(sorted[2].orders[1].amount).toBe(149.5)

      // João's orders sorted: 89.9, then 125.5
      expect(sorted[3].name).toBe('João Silva')
      expect(sorted[3].orders[0].amount).toBe(89.9)
      expect(sorted[3].orders[1].amount).toBe(125.5)

      // Ricardo: 99.99
      expect(sorted[4].name).toBe('Ricardo Sousa')
      expect(sorted[4].orders[0].amount).toBe(99.99)

      // Maria: 250
      expect(sorted[5].name).toBe('Maria Costa')
      expect(sorted[5].orders[0].amount).toBe(250)

      // Miguel: 315.2
      expect(sorted[6].name).toBe('Miguel Rocha')
      expect(sorted[6].orders[0].amount).toBe(315.2)

      // Carla (empty orders) is at the very end
      expect(sorted[7].name).toBe('Carla Ferreira')
    })

    test('sortJsonWithExpansion sorts descending with sub-array items sorted and nulls last', () => {
      const patch = sortJsonWithExpansion(customersData, [], ['orders', 'amount'], -1)
      const sorted = (patch[0] as JSONPatchReplace).value as typeof customersData

      // In descending order:
      // Ana's orders sorted: 700, then 12.99
      expect(sorted[0].name).toBe('Ana Martins')
      expect(sorted[0].orders[0].amount).toBe(700)
      expect(sorted[0].orders[1].amount).toBe(12.99)

      // Miguel: 315.2
      expect(sorted[1].name).toBe('Miguel Rocha')
      expect(sorted[1].orders[0].amount).toBe(315.2)

      // Maria: 250
      expect(sorted[2].name).toBe('Maria Costa')
      expect(sorted[2].orders[0].amount).toBe(250)

      // Sofia's orders sorted: 149.5, then 67.3
      expect(sorted[3].name).toBe('Sofia Mendes')
      expect(sorted[3].orders[0].amount).toBe(149.5)
      expect(sorted[3].orders[1].amount).toBe(67.3)

      // João's orders sorted: 125.5, then 89.9
      expect(sorted[4].name).toBe('João Silva')
      expect(sorted[4].orders[0].amount).toBe(125.5)
      expect(sorted[4].orders[1].amount).toBe(89.9)

      // Ricardo: 99.99
      expect(sorted[5].name).toBe('Ricardo Sousa')
      expect(sorted[5].orders[0].amount).toBe(99.99)

      // Pedro: 45.75
      expect(sorted[6].name).toBe('Pedro Almeida')
      expect(sorted[6].orders[0].amount).toBe(45.75)

      // Carla (empty orders) remains at the end
      expect(sorted[7].name).toBe('Carla Ferreira')
    })
  })

  describe('multi-level expansion and recursive collapse', () => {
    const deepData = [
      {
        id: 1,
        root: {
          level2: {
            level3: {
              level4: {
                level5: 'leaf_value'
              }
            }
          }
        }
      }
    ]

    test('collectExpandableDescendantPaths expands up to 4 levels by default for top-level column', () => {
      // Top-level column has length 1. maxLevels = 4 expands levels 1, 2, 3, 4.
      const expanded = collectExpandableDescendantPaths(deepData, ['root'], 4)
      expect(expanded['/root']).toBe(true)
      expect(expanded['/root/level2']).toBe(true)
      expect(expanded['/root/level2/level3']).toBe(true)
      expect(expanded['/root/level2/level3/level4']).toBe(true)
      // Level 5 is string 'leaf_value', so it's not expandable anyway
    })

    test('deep structures with > 4 levels stop at 4th level, and deeper levels expand one by one', () => {
      const veryDeepData = [
        {
          id: 1,
          root: {
            l2: {
              l3: {
                l4: {
                  l5: {
                    l6: 'deepest'
                  }
                }
              }
            }
          }
        }
      ]

      // Expanding root (length 1) with 4 levels expands root, l2, l3, l4.
      const initialExpanded = collectExpandableDescendantPaths(veryDeepData, ['root'], 4)
      expect(initialExpanded['/root']).toBe(true)
      expect(initialExpanded['/root/l2']).toBe(true)
      expect(initialExpanded['/root/l2/l3']).toBe(true)
      expect(initialExpanded['/root/l2/l3/l4']).toBe(true)
      // /root/l2/l3/l4/l5 should NOT be expanded automatically
      expect(initialExpanded['/root/l2/l3/l4/l5']).toBeUndefined()

      // Visual columns should contain l5 with isExpandable = true
      const vCols = buildVisualColumns([['id'], ['root']], initialExpanded, veryDeepData)
      const l5Col = vCols.find((c) => c.displayName === 'l5')
      expect(l5Col).toBeDefined()
      expect(l5Col?.isExpandable).toBe(true)

      // Expanding l5 (depth >= 4) expands 1 level further ("um por um")
      const l5Path = ['root', 'l2', 'l3', 'l4', 'l5']
      const maxLevelsForL5 = l5Path.length < 4 ? 4 - l5Path.length + 1 : 1
      expect(maxLevelsForL5).toBe(1)

      const expandedL5 = collectExpandableDescendantPaths(veryDeepData, l5Path, maxLevelsForL5)
      expect(expandedL5['/root/l2/l3/l4/l5']).toBe(true)
      expect(expandedL5['/root/l2/l3/l4/l5/l6']).toBeUndefined()

      const allExpanded = { ...initialExpanded, ...expandedL5 }
      const vColsAfter = buildVisualColumns([['id'], ['root']], allExpanded, veryDeepData)
      const l6Col = vColsAfter.find((c) => c.displayName === 'l6')
      expect(l6Col).toBeDefined()
      expect(l6Col?.isExpandable).toBe(false)
      expect(getVisualCellValue(veryDeepData, { originalRowIndex: 0, subRowIndex: 0, isSubRow: false, subRowTotal: 1 }, l6Col!)).toBe('deepest')
    })

    test('collapsing a column removes all its descendants', () => {
      const expandedColumns: Record<string, boolean> = {
        '/root': true,
        '/root/l2': true,
        '/root/l2/l3': true,
        '/other': true
      }

      // Simulate toggleExpandColumn collapse logic
      const colKey: string = '/root'
      const next = { ...expandedColumns }
      delete next[colKey]
      const prefix = colKey === '' ? '/' : colKey + '/'
      for (const k of Object.keys(next)) {
        if (k.startsWith(prefix)) {
          delete next[k]
        }
      }

      expect(next['/root']).toBeUndefined()
      expect(next['/root/l2']).toBeUndefined()
      expect(next['/root/l2/l3']).toBeUndefined()
      expect(next['/other']).toBe(true)
    })
  })
})
