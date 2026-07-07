import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, tick } from 'svelte'
import { fireEvent, getByText, queryByText } from '@testing-library/svelte'

import CommandPalette from './CommandPalette.svelte'

interface Action {
  id: string
  label: string
  group: string
  hint?: string
  run: () => void
}

function makeActions(): Action[] {
  return [
    { id: 'new', group: 'File', label: 'New tab', hint: 'Ctrl+Alt+N', run: vi.fn() },
    { id: 'save', group: 'File', label: 'Save', run: vi.fn() },
    { id: 'theme', group: 'Theme', label: 'Theme: dark', run: vi.fn() }
  ]
}

function mountPalette(open: boolean, actions: Action[]): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  mount(CommandPalette, { target, props: { open, actions } })
  return target
}

describe('CommandPalette', () => {
  let actions: Action[]

  beforeEach(() => {
    actions = makeActions()
  })

  it('renders nothing when closed', () => {
    const target = mountPalette(false, actions)
    expect(queryByText(target, 'New tab')).toBeNull()
  })

  it('renders actions with group headers and hints when open', () => {
    const target = mountPalette(true, actions)
    expect(getByText(target, 'New tab')).toBeTruthy()
    expect(getByText(target, 'Theme: dark')).toBeTruthy()
    expect(getByText(target, 'File')).toBeTruthy()
    expect(getByText(target, 'Ctrl+Alt+N')).toBeTruthy()
  })

  it('filters actions by query', async () => {
    const target = mountPalette(true, actions)
    const input = target.querySelector('.palette-input') as HTMLInputElement

    await fireEvent.input(input, { target: { value: 'theme' } })
    await tick()

    expect(queryByText(target, 'New tab')).toBeNull()
    expect(getByText(target, 'Theme: dark')).toBeTruthy()
  })

  it('runs the first action on Enter and closes', async () => {
    const target = mountPalette(true, actions)
    const input = target.querySelector('.palette-input') as HTMLInputElement

    await fireEvent.keyDown(input, { key: 'Enter' })
    await tick()

    expect(actions[0].run).toHaveBeenCalledTimes(1)
    expect(queryByText(target, 'New tab')).toBeNull()
  })

  it('navigates with arrow keys', async () => {
    const target = mountPalette(true, actions)
    const input = target.querySelector('.palette-input') as HTMLInputElement

    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await tick()

    expect(actions[1].run).toHaveBeenCalledTimes(1)
    expect(actions[0].run).not.toHaveBeenCalled()
  })

  it('runs an action on click and closes', async () => {
    const target = mountPalette(true, actions)

    await fireEvent.click(getByText(target, 'Theme: dark'))
    await tick()

    expect(actions[2].run).toHaveBeenCalledTimes(1)
    expect(queryByText(target, 'Theme: dark')).toBeNull()
  })

  it('shows an empty state when nothing matches', async () => {
    const target = mountPalette(true, actions)
    const input = target.querySelector('.palette-input') as HTMLInputElement

    await fireEvent.input(input, { target: { value: 'zzz' } })
    await tick()

    expect(getByText(target, 'No matching commands')).toBeTruthy()
  })
})
