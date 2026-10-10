import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, tick } from 'svelte'
import { fireEvent, getByText, queryByText } from '@testing-library/svelte'

import CurlImportModal from './CurlImportModal.svelte'

function mountModal(
  open: boolean,
  onImport: (curlText: string) => void,
  onClose: () => void
): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  mount(CurlImportModal, { target, props: { open, onImport, onClose } })
  return target
}

describe('CurlImportModal', () => {
  let onImport: (curlText: string) => void
  let onClose: () => void

  beforeEach(() => {
    onImport = vi.fn()
    onClose = vi.fn()
  })

  it('renders nothing when closed', () => {
    const target = mountModal(false, onImport, onClose)
    expect(queryByText(target, 'Import cURL Request')).toBeNull()
  })

  it('renders title and controls when open', () => {
    const target = mountModal(true, onImport, onClose)
    expect(getByText(target, 'Import cURL Request')).toBeTruthy()
    expect(getByText(target, 'Postman Compatible')).toBeTruthy()
  })

  it('shows live preview when a valid curl command is entered', async () => {
    const target = mountModal(true, onImport, onClose)
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement

    await fireEvent.input(textarea, {
      target: {
        value:
          "curl --location 'https://api.example.com/users?page=1' --header 'Accept: application/json'"
      }
    })
    await tick()

    expect(getByText(target, 'Parsed Request Preview')).toBeTruthy()
    expect(getByText(target, 'GET')).toBeTruthy()
    expect(getByText(target, '1 header')).toBeTruthy()
    expect(getByText(target, '1 query param')).toBeTruthy()
  })

  it('calls onImport with curlText when clicking Import Request', async () => {
    const target = mountModal(true, onImport, onClose)
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement

    const command = "curl --location 'https://api.example.com/data'"
    await fireEvent.input(textarea, { target: { value: command } })
    await tick()

    const importBtn = getByText(target, 'Import Request') as HTMLButtonElement
    expect(importBtn.disabled).toBe(false)
    await fireEvent.click(importBtn)
    await tick()

    expect(onImport).toHaveBeenCalledWith(command)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape or Cancel', async () => {
    const target = mountModal(true, onImport, onClose)
    const cancelBtn = getByText(target, 'Cancel')
    await fireEvent.click(cancelBtn)
    await tick()

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
