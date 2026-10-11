import { beforeEach, afterEach, test, describe, expect, vi } from 'vitest'
import '@testing-library/jest-dom'
import JSONEditor from './JSONEditor.svelte'
import { type Content, Mode } from '$lib/types.js'
import { flushSync, mount } from 'svelte'
import { getByText } from '@testing-library/svelte'

describe('JSONEditor', () => {
  const content: Content = {
    json: [{ id: 1 }, { id: 2, name: 'Joe' }, { id: 3 }]
  }

  beforeEach(() => {
    const ResizeObserverMock = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('render tree mode', () => {
    const target = document.createElement('div')

    mount(JSONEditor, {
      target,
      props: {
        mode: Mode.tree,
        content
      }
    })

    const main = target.getElementsByClassName('jse-main')[0]
    expect(main.children[0]).toHaveClass('jse-tree-mode')
    expect(getByText(target, 'Joe')).toHaveClass('jse-value', 'jse-string')
    expect(target).toMatchSnapshot()
  })

  test('render text mode', async () => {
    const target = document.createElement('div')

    mount(JSONEditor, {
      target,
      props: {
        mode: Mode.text,
        content
      }
    })

    flushSync() // wait until CodeMirror is rendered during onMount

    const main = target.getElementsByClassName('jse-main')[0]
    expect(main.children[0]).toHaveClass('jse-text-mode')
    expect(getByText(target, '"Joe"').parentNode).toHaveClass('cm-line')
    expect(target).toMatchSnapshot()
  })

  test('render table mode', () => {
    const target = document.createElement('div')

    mount(JSONEditor, {
      target,
      props: {
        mode: Mode.table,
        content
      }
    })

    const main = target.getElementsByClassName('jse-main')[0]
    expect(main.children[0]).toHaveClass('jse-table-mode')
    expect(getByText(target, 'Joe')).toHaveClass('jse-value', 'jse-string')
    expect(target).toMatchSnapshot()
  })

  test('render compare mode with document selection and target drop zone', () => {
    const target = document.createElement('div')

    mount(JSONEditor, {
      target,
      props: {
        mode: Mode.compare,
        content: { json: { name: 'Doc A', version: 1 } },
        compareDocuments: [
          { id: 2, title: 'Doc B', content: { json: { name: 'Doc B', version: 2 } } },
          { id: 3, title: 'Doc C', content: { json: { name: 'Doc C', version: 3 } } }
        ]
      }
    })

    const main = target.getElementsByClassName('jse-main')[0]
    expect(main.children[0]).toHaveClass('jse-compare-mode')
    expect(target.querySelector('.target-quick-pills')).not.toBeNull()
    expect(target.querySelector('.target-drop-zone')).not.toBeNull()
  })
})
