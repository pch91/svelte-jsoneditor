import { describe, expect, it } from 'vitest'
import { mount, tick } from 'svelte'
import { fireEvent, getByText } from '@testing-library/svelte'
import CapturePathsTable from './CapturePathsTable.svelte'
import type { CaptureRule } from '../tabUtils.js'

describe('CapturePathsTable', () => {
  it('renders table headers and rules correctly', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const initialCaptures: CaptureRule[] = [
      { path: 'data.token', name: 'authToken', enabled: true },
      { path: 'user.id', name: 'userId', enabled: false }
    ]

    mount(CapturePathsTable, {
      target,
      props: {
        captures: initialCaptures,
        sampleJsonText: '{"data": {"token": "abc123xyz"}, "user": {"id": 42}}'
      }
    })

    expect(getByText(target, 'Response Captures (Capture Paths)')).toBeTruthy()
    expect(getByText(target, 'JSON Path')).toBeTruthy()
    expect(getByText(target, 'Environment Variable')).toBeTruthy()
  })

  it('runs live extraction against sample JSON when clicking Test on Response', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const initialCaptures: CaptureRule[] = [
      { path: 'data.token', name: 'authToken', enabled: true }
    ]

    mount(CapturePathsTable, {
      target,
      props: {
        captures: initialCaptures,
        sampleJsonText: '{"data": {"token": "abc123xyz"}}'
      }
    })

    const testBtn = target.querySelector('.cap-btn-test') as HTMLButtonElement
    expect(testBtn).toBeTruthy()
    await fireEvent.click(testBtn)
    await tick()

    expect(getByText(target, '✓ abc123xyz')).toBeTruthy()
  })
})
