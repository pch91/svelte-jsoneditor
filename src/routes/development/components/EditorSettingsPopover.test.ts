import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from 'svelte'
import { fireEvent, getByLabelText, getByRole, queryByRole } from '@testing-library/svelte'
import EditorSettingsPopover from './EditorSettingsPopover.svelte'

describe('EditorSettingsPopover', () => {
  let onClose: () => void

  beforeEach(() => {
    onClose = vi.fn()
  })

  it('renders nothing when open is false', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(EditorSettingsPopover, { target, props: { open: false, onClose } })
    expect(queryByRole(target, 'dialog')).toBeNull()
  })

  it('renders dialog and triggers onClose on close button click', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(EditorSettingsPopover, { target, props: { open: true, onClose } })

    const dialog = getByRole(target, 'dialog')
    expect(dialog).not.toBeNull()

    const closeBtn = getByLabelText(target, 'Close')
    await fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('toggles switch states correctly', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(EditorSettingsPopover, { target, props: { open: true, mainMenuBar: true } })

    const toggle = getByLabelText(target, 'Toggle Main Menu Bar')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('toggles Auto-Expand Columns switch correctly', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(EditorSettingsPopover, { target, props: { open: true, flatten: true } })

    const toggle = getByLabelText(target, 'Toggle Auto-Expand Columns')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})
