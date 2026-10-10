import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, tick } from 'svelte'
import { fireEvent, getByText, queryByText } from '@testing-library/svelte'

import EnvironmentManagerModal from './EnvironmentManagerModal.svelte'

describe('EnvironmentManagerModal', () => {
  let onClose: () => void
  let onOpenInEditor: (title: string, text: string) => void

  beforeEach(() => {
    onClose = vi.fn()
    onOpenInEditor = vi.fn()
  })

  it('renders nothing when closed', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(EnvironmentManagerModal, {
      target,
      props: {
        open: false,
        environments: {},
        globalEnvironment: {},
        activeEnvName: '',
        onClose,
        onOpenInEditor
      }
    })
    expect(queryByText(target, 'Manage Environments (Postman Style)')).toBeNull()
  })

  it('renders Globals and multiple environments when open', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(EnvironmentManagerModal, {
      target,
      props: {
        open: true,
        environments: {
          Dev: { baseUrl: 'https://dev.api.com' },
          Prod: { baseUrl: 'https://api.com' }
        },
        globalEnvironment: { apiKey: 'secret-global-123' },
        activeEnvName: 'Dev',
        onClose,
        onOpenInEditor
      }
    })

    expect(getByText(target, 'Manage Environments (Postman Style)')).toBeTruthy()
    expect(getByText(target, 'Globals')).toBeTruthy()
    const itemNames = Array.from(target.querySelectorAll('.item-name')).map((el) =>
      el.textContent?.trim()
    )
    expect(itemNames).toContain('Dev')
    expect(itemNames).toContain('Prod')
  })

  it('can create a new environment and add variable rows', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const environments: Record<string, Record<string, string>> = {}
    const globalEnvironment: Record<string, string> = { globalToken: 'xyz' }

    mount(EnvironmentManagerModal, {
      target,
      props: {
        open: true,
        environments,
        globalEnvironment,
        activeEnvName: '',
        onClose,
        onOpenInEditor
      }
    })

    const newBtn = getByText(target, '＋ New')
    await fireEvent.click(newBtn)
    await tick()

    // An environment like 'Environment 1' should now exist in the sidebar
    const itemNames = Array.from(target.querySelectorAll('.item-name')).map((el) =>
      el.textContent?.trim()
    )
    expect(itemNames).toContain('Environment 1')

    // Can add variable row
    const addVarBtn = getByText(target, '＋ Add Variable')
    await fireEvent.click(addVarBtn)
    await tick()

    const inputs = target.querySelectorAll('.env-table-row input')
    expect(inputs.length).toBeGreaterThanOrEqual(2)
  })

  it('calls onOpenInEditor when clicking Abrir no Editor JSON', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    mount(EnvironmentManagerModal, {
      target,
      props: {
        open: true,
        environments: {},
        globalEnvironment: { testVar: 'hello' },
        activeEnvName: '',
        onClose,
        onOpenInEditor
      }
    })

    const editorBtn = getByText(target, '↗ Abrir no Editor JSON')
    await fireEvent.click(editorBtn)
    expect(onOpenInEditor).toHaveBeenCalledWith('globals.json', expect.stringContaining('testVar'))
  })
})
