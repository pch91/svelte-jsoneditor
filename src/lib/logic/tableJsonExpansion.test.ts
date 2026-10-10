import { describe, expect, test } from 'vitest'
import {
  buildVisualColumns,
  buildVisualRows,
  createVisualCellPatch,
  getRowSortValue,
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
    expect(transformed[0].value).toBe(JSON.stringify({ rua: 'Rua Nova', cidade: 'Porto' }))
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
    const sortedAsc = patchAsc[0].value as typeof testData
    expect(sortedAsc[0].id).toBe(2)
    expect(sortedAsc[1].id).toBe(1)

    // Descending: Porto (id: 1) before Lisboa (id: 2)
    const patchDesc = sortJsonWithExpansion(testData, [], ['endereco', 'cidade'], -1)
    const sortedDesc = patchDesc[0].value as typeof testData
    expect(sortedDesc[0].id).toBe(1)
    expect(sortedDesc[1].id).toBe(2)
  })

  test('sortJsonWithExpansion correctly sorts by array sub-column', () => {
    // 'claro' (id: 2) comes before 'escuro' (id: 1)
    const patchAsc = sortJsonWithExpansion(testData, [], ['configuracao', 'tema'], 1)
    const sortedAsc = patchAsc[0].value as typeof testData
    expect(sortedAsc[0].id).toBe(2)
    expect(sortedAsc[1].id).toBe(1)

    // Descending: 'escuro' (id: 1) before 'claro' (id: 2)
    const patchDesc = sortJsonWithExpansion(testData, [], ['configuracao', 'tema'], -1)
    const sortedDesc = patchDesc[0].value as typeof testData
    expect(sortedDesc[0].id).toBe(1)
    expect(sortedDesc[1].id).toBe(2)
  })
})
