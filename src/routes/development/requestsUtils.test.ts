import { describe, expect, it } from 'vitest'
import {
  extractValueByPath,
  formatBytes,
  parseCaptureList,
  parseHeadersText,
  proxyUrl,
  relativeTime,
  resolveVariables,
  responseName,
  truncateText
} from './requestsUtils.js'

describe('parseHeadersText', () => {
  it('parses "Key: Value" lines', () => {
    expect(parseHeadersText('Content-Type: application/json\nAuthorization: Bearer abc')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc'
    })
  })

  it('parses a JSON object', () => {
    expect(parseHeadersText('{"Content-Type": "application/json", "X-Key": 1}')).toEqual({
      'Content-Type': 'application/json',
      'X-Key': '1'
    })
  })

  it('skips blank lines, comments and malformed lines', () => {
    expect(
      parseHeadersText('# comment\n\nContent-Type: application/json\nmalformed-line\n')
    ).toEqual({ 'Content-Type': 'application/json' })
  })

  it('returns an empty object for empty input', () => {
    expect(parseHeadersText('   ')).toEqual({})
  })
})

describe('proxyUrl', () => {
  it('replaces the {url} placeholder', () => {
    expect(proxyUrl('https://api.example.com/a?b=1', 'https://corsproxy.io/?url={url}')).toBe(
      'https://corsproxy.io/?url=' + encodeURIComponent('https://api.example.com/a?b=1')
    )
  })

  it('appends the encoded url when no placeholder is present', () => {
    expect(proxyUrl('https://api.example.com/x', 'https://proxy.example/')).toBe(
      'https://proxy.example/' + encodeURIComponent('https://api.example.com/x')
    )
    expect(proxyUrl('https://api.example.com/x', 'https://proxy.example')).toBe(
      'https://proxy.example/' + encodeURIComponent('https://api.example.com/x')
    )
  })

  it('returns the original url for an empty template', () => {
    expect(proxyUrl('https://api.example.com', '')).toBe('https://api.example.com')
  })
})

describe('responseName', () => {
  it('uses method, host and the last path segments', () => {
    expect(responseName('GET', 'https://api.example.com/users/42')).toBe(
      'GET-api.example.com-users-42.json'
    )
  })

  it('handles urls without a path segment', () => {
    expect(responseName('POST', 'https://api.example.com/')).toBe('POST-api.example.com.json')
  })

  it('falls back for invalid urls', () => {
    expect(responseName('GET', 'not a url')).toBe('GET-response.json')
  })
})

describe('formatBytes', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
  })
})

describe('resolveVariables', () => {
  it('replaces known variables', () => {
    const result = resolveVariables('{{baseUrl}}/users/{{id}}', {
      baseUrl: 'https://api.dev',
      id: '42'
    })
    expect(result.resolved).toBe('https://api.dev/users/42')
    expect(result.missing).toEqual([])
  })

  it('reports missing variables and leaves the placeholder untouched', () => {
    const result = resolveVariables('{{baseUrl}}/users/{{missing}}', { baseUrl: 'https://api.dev' })
    expect(result.resolved).toBe('https://api.dev/users/{{missing}}')
    expect(result.missing).toEqual(['missing'])
  })
})

describe('extractValueByPath', () => {
  const json = {
    data: { items: [{ access_token: 'abc123' }, { access_token: 'xyz789' }] },
    token: 'top'
  }

  it('extracts nested values by dot path', () => {
    expect(extractValueByPath(json, 'token')).toBe('top')
    expect(extractValueByPath(json, 'data.items[0].access_token')).toBe('abc123')
    expect(extractValueByPath(json, 'data.items[1].access_token')).toBe('xyz789')
  })

  it('returns undefined for missing paths', () => {
    expect(extractValueByPath(json, 'data.nope')).toBeUndefined()
    expect(extractValueByPath(json, 'data.items[5]')).toBeUndefined()
  })

  it('returns the whole object for an empty path', () => {
    expect(extractValueByPath(json, '')).toEqual(json)
  })
})

describe('relativeTime', () => {
  const now = 1_000_000_000_000

  it('formats seconds, minutes, hours and days', () => {
    expect(relativeTime(now - 3_000, now)).toBe('just now')
    expect(relativeTime(now - 30_000, now)).toBe('30s ago')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
})

describe('truncateText', () => {
  it('keeps short texts untouched', () => {
    expect(truncateText('hello', 10)).toBe('hello')
  })

  it('truncates long texts and appends a marker', () => {
    const result = truncateText('abcdefghij', 5)
    expect(result.startsWith('abcde')).toBe(true)
    expect(result.endsWith('(response truncated)')).toBe(true)
  })
})

describe('parseCaptureList', () => {
  it('pairs comma-separated paths and names', () => {
    expect(parseCaptureList('data.token, id', 'token, userId')).toEqual([
      { path: 'data.token', name: 'token' },
      { path: 'id', name: 'userId' }
    ])
  })

  it('skips incomplete pairs and handles single values', () => {
    expect(parseCaptureList('data.token', 'token')).toEqual([{ path: 'data.token', name: 'token' }])
    expect(parseCaptureList('data.token,', 'token')).toEqual([
      { path: 'data.token', name: 'token' }
    ])
    expect(parseCaptureList('data.token', '')).toEqual([])
  })

  it('returns an empty list for empty input', () => {
    expect(parseCaptureList('', '')).toEqual([])
  })
})
