/**
 * Pure helpers for the Requests (HTTP client) panel.
 */

/** Parse a raw headers text into an object. Accepts "Key: Value" lines or a JSON object. */
export function parseHeadersText(text: string): Record<string, string> {
  const trimmed = text.trim()
  if (!trimmed) return {}

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value)
          ])
        )
      }
    } catch {
      // fall through to line parsing
    }
  }

  const headers: Record<string, string> = {}
  for (const line of trimmed.split('\n')) {
    const current = line.trim()
    if (!current || current.startsWith('#')) continue
    const separator = current.indexOf(':')
    if (separator <= 0) continue
    const key = current.slice(0, separator).trim()
    const value = current.slice(separator + 1).trim()
    if (key) headers[key] = value
  }
  return headers
}

// ---- Query params ----

export interface QueryParam {
  key: string
  value: string
  enabled: boolean
}

/** Parse the query string of a URL into key/value rows. */
export function parseQueryParams(url: string): QueryParam[] {
  const question = url.indexOf('?')
  if (question === -1) return []
  const query = url.slice(question + 1)
  if (!query) return []

  return query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
    let key = rawKey
    let value = rawValue
    try {
      key = decodeURIComponent(rawKey)
    } catch {
      // keep raw
    }
    try {
      value = decodeURIComponent(rawValue)
    } catch {
      // keep raw
    }
    return { key, value, enabled: true }
  })
}

/** Replace the query part of a URL with the given (enabled) params, properly encoded. */
export function buildUrlWithQuery(url: string, params: QueryParam[]): string {
  const base = url.split('?')[0]
  const query = params
    .filter((param) => param.enabled && param.key.trim() !== '')
    .map((param) => `${encodeURIComponent(param.key.trim())}=${encodeURIComponent(param.value)}`)
    .join('&')
  return query ? `${base}?${query}` : base
}

// ---- Header rows ----

export interface HeaderRow {
  key: string
  value: string
  enabled: boolean
}

/** Parse "Key: value" header text into editable rows (all enabled). */
export function headersToRows(text: string): HeaderRow[] {
  const headers = parseHeadersText(text)
  return Object.entries(headers).map(([key, value]) => ({
    key,
    value: String(value),
    enabled: true
  }))
}

/** Serialize header rows back into "Key: value" text (enabled rows only). */
export function rowsToHeadersText(rows: HeaderRow[]): string {
  return rows
    .filter((row) => row.enabled && row.key.trim() !== '')
    .map((row) => `${row.key.trim()}: ${row.value}`)
    .join('\n')
}

/** Build the Basic Authorization header value (Base64 of "user:pass"). */
export function encodeBasicAuth(username: string, password: string): string {
  return btoa(`${username}:${password}`)
}

/** Build the proxied URL from a template. Supports `{url}` placeholders. */
export function proxyUrl(url: string, proxyTemplate: string): string {
  const template = proxyTemplate.trim()
  if (!template) return url
  if (template.includes('{url}')) {
    return template.replace('{url}', encodeURIComponent(url))
  }
  return template.endsWith('/')
    ? `${template}${encodeURIComponent(url)}`
    : `${template}/${encodeURIComponent(url)}`
}

/** Generate a tab title for a response, e.g. "GET-api.example.com-users-42.json". */
export function responseName(method: string, url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean).slice(-2)
    return `${method}-${parsed.host}${segments.length ? `-${segments.join('-')}` : ''}.json`
  } catch {
    return `${method}-response.json`
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Replace `{{variable}}` placeholders using an environment. Missing variables
 * are left untouched and reported, so the user can fix them.
 */
export function resolveVariables(
  text: string,
  env: Record<string, string>
): { resolved: string; missing: string[] } {
  const missing: string[] = []
  const resolved = text.replace(/\{\{([^{}]+)\}\}/g, (match, name: string) => {
    const key = name.trim()
    if (key in env) return env[key]
    missing.push(key)
    return match
  })
  return { resolved, missing }
}

/**
 * Extract a value from a JSON response using a dot path, with array indexes:
 * "data.items[0].access_token".
 */
export function extractValueByPath(json: unknown, path: string): unknown {
  const segments = path
    .trim()
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return json

  let current: unknown = json
  for (const segment of segments) {
    const arrayMatch = /^([^[\]]+)\[(\d+)\]$/.exec(segment)
    if (arrayMatch) {
      const key = arrayMatch[1]
      const index = Number(arrayMatch[2])
      if (key && current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[key]
      }
      if (!Array.isArray(current)) return undefined
      current = current[index]
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return current
}

/** Human-friendly relative time, e.g. "3m ago". */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Truncate a large response body before persisting it in history. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n… (response truncated)`
}

/**
 * Parse comma-separated capture lists into pairs. "a.b,c.d" with
 * "token,id" yields [{ path: 'a.b', name: 'token' }, { path: 'c.d', name: 'id' }].
 */
export function parseCaptureList(
  paths: string,
  names: string
): Array<{ path: string; name: string }> {
  const pathList = paths
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const nameList = names
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const captures: Array<{ path: string; name: string }> = []
  const count = Math.max(pathList.length, nameList.length)
  for (let index = 0; index < count; index++) {
    const path = pathList[index] ?? ''
    const name = nameList[index] ?? ''
    if (path && name) captures.push({ path, name })
  }
  return captures
}
