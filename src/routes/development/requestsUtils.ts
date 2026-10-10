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

/** Parse a query string or full URL (or form-urlencoded body) into key/value rows. */
export function parseQueryParams(urlOrQuery: string): QueryParam[] {
  if (!urlOrQuery || typeof urlOrQuery !== 'string') return []
  const question = urlOrQuery.indexOf('?')
  let query = ''
  if (question !== -1) {
    query = urlOrQuery.slice(question + 1)
  } else if (
    !urlOrQuery.includes('://') &&
    !urlOrQuery.startsWith('/') &&
    urlOrQuery.includes('=')
  ) {
    // Raw parameter string without leading '?' (e.g. "username=admin&password=123456")
    query = urlOrQuery
  } else {
    return []
  }

  const hash = query.indexOf('#')
  if (hash !== -1) {
    query = query.slice(0, hash)
  }
  if (!query) return []

  return query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
    let key = rawKey
    let value = rawValue
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
    } catch {
      // keep raw
    }
    try {
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '))
    } catch {
      // keep raw
    }
    return { key, value, enabled: true }
  })
}

/** Builds the encoded query string "key=val&key2=val2" from enabled query params. */
export function buildQueryParamsString(params: QueryParam[]): string {
  return params
    .filter((param) => param.enabled && param.key.trim() !== '')
    .map((param) => `${encodeURIComponent(param.key.trim())}=${encodeURIComponent(param.value)}`)
    .join('&')
}

/** Replace the query part of a URL with the given (enabled) params, properly encoded. */
export function buildUrlWithQuery(url: string, params: QueryParam[]): string {
  const base = url.split('?')[0].split('#')[0]
  const hash = url.includes('#') ? '#' + url.split('#')[1] : ''
  const query = buildQueryParamsString(params)
  return (query ? `${base}?${query}` : base) + hash
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

/** Try the URL directly, then fall back to the CORS proxy when configured. */
export async function fetchWithProxy(
  url: string,
  init: RequestInit,
  proxyTemplate: string
): Promise<{ res: Response; viaProxy: boolean }> {
  const attempts = [url]
  if (proxyTemplate) attempts.push(proxyUrl(url, proxyTemplate))
  let lastError: unknown
  for (let index = 0; index < attempts.length; index++) {
    try {
      return { res: await fetch(attempts[index], init), viaProxy: index > 0 }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

/** Add a default Content-Type automatically when a body is sent without one. */
export function withContentType(
  headers: Record<string, string>,
  body: string | undefined,
  contentType = 'application/json'
): Record<string, string> {
  if (!body) return headers
  const has = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
  return has ? headers : { ...headers, 'Content-Type': contentType }
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
 * Replace `{{variable}}` placeholders using an environment (and fallback to globalEnv).
 * Missing variables are left untouched and reported, so the user can fix them.
 */
export function resolveVariables(
  text: string,
  env: Record<string, string>,
  globalEnv: Record<string, string> = {}
): { resolved: string; missing: string[] } {
  const missing: string[] = []
  const resolved = text.replace(/\{\{([^{}]+)\}\}/g, (match, name: string) => {
    const key = name.trim()
    if (key in env) return env[key]
    if (key in globalEnv) return globalEnv[key]
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

// ---- cURL import & export ----

export interface ParsedCurl {
  url: string
  method: string
  headers: Record<string, string>
  headerRows: HeaderRow[]
  body: string
  bodyType: 'none' | 'json' | 'text'
  params: QueryParam[]
  auth?: {
    type: 'basic' | 'bearer'
    username?: string
    password?: string
    token?: string
  }
}

export interface BuildCurlOptions {
  method: string
  url: string
  headers?: HeaderRow[] | Record<string, string> | string
  body?: string
  bodyType?: 'none' | 'json' | 'text'
  auth?: {
    type: 'none' | 'bearer' | 'basic' | 'apikey'
    bearerToken?: string
    basicUser?: string
    basicPass?: string
    apiKeyName?: string
    apiKeyValue?: string
  }
}

/**
 * Strips markdown code fences (```bash ... ```) if text was copied from a doc.
 */
export function stripCodeFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '')
    cleaned = cleaned.replace(/\r?\n```\s*$/, '')
  }
  return cleaned.trim()
}

/**
 * Detects whether the given text is a cURL command (case-insensitive "curl ...").
 */
export function isCurlCommand(text: string): boolean {
  if (!text || typeof text !== 'string') return false
  const unFenced = stripCodeFences(text)
  const lines = unFenced
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (lines.length === 0) return false
  const first = lines[0].replace(/^[$#>]\s+/, '').trim()
  return /^curl(?:\.exe)?(?:\s|$)/i.test(first)
}

/**
 * Splits a shell command string into arguments, respecting:
 * - single quotes ('...') with bash escaped single quotes ('\'')
 * - double quotes ("...") with escape sequences
 * - line continuations (\ + newline, cmd ^ + newline, powershell ` + newline)
 * - bash prompt prefixes ($ , > )
 */
export function tokenizeShellArgs(command: string): string[] {
  const cleaned = stripCodeFences(command)
    .trim()
    .replace(/^[$#>]\s+/, '')
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let i = 0

  while (i < cleaned.length) {
    const ch = cleaned[i]

    // Line continuations: \ followed by newline (bash), ^ followed by newline (cmd), ` followed by newline (powershell)
    if (!inSingleQuote && (ch === '\\' || ch === '^' || ch === '`')) {
      let peek = i + 1
      while (peek < cleaned.length && (cleaned[peek] === ' ' || cleaned[peek] === '\t')) {
        peek++
      }
      if (peek < cleaned.length && (cleaned[peek] === '\n' || cleaned[peek] === '\r')) {
        if (cleaned[peek] === '\r' && peek + 1 < cleaned.length && cleaned[peek + 1] === '\n') {
          peek++
        }
        i = peek + 1
        // If outside quotes and we had text accumulated, push it as a token
        if (!inDoubleQuote && current.length > 0) {
          tokens.push(current)
          current = ''
        }
        continue
      }
    }

    if (inSingleQuote) {
      if (ch === "'") {
        // Bash escaped single quote sequence: '\'' -> produces literal single quote
        if (cleaned.slice(i, i + 4) === "'\\''") {
          current += "'"
          i += 4
          continue
        }
        inSingleQuote = false
      } else {
        current += ch
      }
      i++
      continue
    }

    if (inDoubleQuote) {
      if (ch === '\\' && i + 1 < cleaned.length) {
        const next = cleaned[i + 1]
        if (next === '"' || next === '\\' || next === 'n' || next === 'r' || next === 't') {
          if (next === 'n') current += '\n'
          else if (next === 'r') current += '\r'
          else if (next === 't') current += '\t'
          else current += next
          i += 2
          continue
        } else {
          current += next
          i += 2
          continue
        }
      } else if (ch === '`' && i + 1 < cleaned.length && cleaned[i + 1] === '"') {
        // PowerShell `" inside double quotes
        current += '"'
        i += 2
        continue
      } else if (ch === '"') {
        inDoubleQuote = false
      } else {
        current += ch
      }
      i++
      continue
    }

    // Outside quotes:
    if (ch === "'") {
      inSingleQuote = true
      i++
      continue
    }

    if (ch === '"') {
      inDoubleQuote = true
      i++
      continue
    }

    if (ch === '\\' && i + 1 < cleaned.length) {
      // Escaped character outside quotes (e.g. \ )
      current += cleaned[i + 1]
      i += 2
      continue
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      i++
      continue
    }

    current += ch
    i++
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

const BOOLEAN_FLAGS = new Set([
  '-L',
  '--location',
  '--location-trusted',
  '-k',
  '--insecure',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-v',
  '--verbose',
  '-i',
  '--include',
  '-I',
  '--head',
  '-f',
  '--fail',
  '-g',
  '--globoff',
  '-N',
  '--no-buffer',
  '-O',
  '--remote-name',
  '-J',
  '--remote-header-name',
  '-Z',
  '--parallel',
  '--compressed',
  '--raw',
  '--anyauth',
  '--basic',
  '--digest',
  '--negotiate',
  '--ntlm',
  '--tcp-nodelay',
  '--ipv4',
  '-4',
  '--ipv6',
  '-6',
  '--http1.0',
  '--http1.1',
  '--http2',
  '--http2-prior-knowledge',
  '--http3',
  '--ssl-no-revoke',
  '--proxy-insecure'
])

const VALUE_FLAGS = new Set([
  '-X',
  '--request',
  '--url',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '-F',
  '--form',
  '--form-string',
  '-u',
  '--user',
  '-A',
  '--user-agent',
  '-b',
  '--cookie',
  '-c',
  '--cookie-jar',
  '-e',
  '--referer',
  '-x',
  '--proxy',
  '-m',
  '--max-time',
  '--connect-timeout',
  '--resolve',
  '-o',
  '--output',
  '--cacert',
  '--capath',
  '-E',
  '--cert',
  '--key',
  '--ciphers'
])

function isLikelyUrl(str: string): boolean {
  if (/^https?:\/\//i.test(str)) return true
  if (str.startsWith('//')) return true
  if (str.startsWith('{{')) return true
  if (/^[a-zA-Z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(str) && str.includes('.')) return true
  return false
}

/**
 * Parses a cURL command line into a structured request object.
 * Extracts URL, method, headers, query parameters, auth, and body.
 */
export function parseCurlCommand(command: string): ParsedCurl | null {
  if (!command || typeof command !== 'string') return null
  const tokens = tokenizeShellArgs(command)
  if (tokens.length === 0) return null

  let i = 0
  if (tokens[0] === '$' || tokens[0] === '>' || tokens[0] === '#') {
    i++
  }
  if (i < tokens.length && /^curl(?:\.exe)?$/i.test(tokens[i])) {
    i++
  }

  let method: string | undefined
  let url: string | undefined
  const headerRows: HeaderRow[] = []
  const headers: Record<string, string> = {}
  const dataChunks: string[] = []
  const urlencodeChunks: string[] = []
  const formChunks: string[] = []
  let authInfo: ParsedCurl['auth'] | undefined

  function addHeader(headerLine: string) {
    let cleaned = headerLine.trim()
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1)
    }
    const colonIndex = cleaned.indexOf(':')
    if (colonIndex > 0) {
      const key = cleaned.slice(0, colonIndex).trim()
      const value = cleaned.slice(colonIndex + 1).trim()
      if (key) {
        headerRows.push({ key, value, enabled: true })
        headers[key] = value

        if (key.toLowerCase() === 'authorization') {
          const bearerMatch = /^Bearer\s+(.+)$/i.exec(value)
          if (bearerMatch) {
            authInfo = { type: 'bearer', token: bearerMatch[1].trim() }
          } else {
            const basicMatch = /^Basic\s+(.+)$/i.exec(value)
            if (basicMatch) {
              try {
                const decoded = atob(basicMatch[1].trim())
                const colon = decoded.indexOf(':')
                if (colon !== -1) {
                  authInfo = {
                    type: 'basic',
                    username: decoded.slice(0, colon),
                    password: decoded.slice(colon + 1)
                  }
                }
              } catch {
                // ignore invalid base64
              }
            }
          }
        }
      }
    } else if (cleaned.endsWith(';')) {
      const key = cleaned.slice(0, -1).trim()
      if (key) {
        headerRows.push({ key, value: '', enabled: true })
        headers[key] = ''
      }
    }
  }

  function handleBasicAuth(userPass: string) {
    const colon = userPass.indexOf(':')
    const user = colon === -1 ? userPass : userPass.slice(0, colon)
    const pass = colon === -1 ? '' : userPass.slice(colon + 1)
    authInfo = { type: 'basic', username: user, password: pass }
    const authVal = `Basic ${encodeBasicAuth(user, pass)}`
    if (!headerRows.some((h) => h.key.toLowerCase() === 'authorization')) {
      headerRows.push({ key: 'Authorization', value: authVal, enabled: true })
      headers.Authorization = authVal
    }
  }

  while (i < tokens.length) {
    const token = tokens[i]

    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '-I' || token === '--head') {
        method = 'HEAD'
      }
      i++
      continue
    }

    let flag = token
    let inlineVal: string | undefined
    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=')
      flag = token.slice(0, eq)
      inlineVal = token.slice(eq + 1)
    }

    const getValue = (): string | undefined => {
      if (inlineVal !== undefined) return inlineVal
      if (i + 1 < tokens.length) {
        i++
        return tokens[i]
      }
      return undefined
    }

    if (flag === '-X' || flag === '--request') {
      const val = getValue()
      if (val) method = val.toUpperCase()
    } else if (token.startsWith('-X') && token.length > 2) {
      method = token.slice(2).toUpperCase()
    } else if (flag === '--url') {
      const val = getValue()
      if (val) url = val
    } else if (flag === '-H' || flag === '--header') {
      const val = getValue()
      if (val) addHeader(val)
    } else if (token.startsWith('-H') && token.length > 2) {
      addHeader(token.slice(2))
    } else if (flag === '-A' || flag === '--user-agent') {
      const val = getValue()
      if (val) addHeader(`User-Agent: ${val}`)
    } else if (flag === '-b' || flag === '--cookie') {
      const val = getValue()
      if (val) addHeader(`Cookie: ${val}`)
    } else if (flag === '-e' || flag === '--referer') {
      const val = getValue()
      if (val) addHeader(`Referer: ${val}`)
    } else if (flag === '-u' || flag === '--user') {
      const val = getValue()
      if (val) handleBasicAuth(val)
    } else if (token.startsWith('-u') && token.length > 2) {
      handleBasicAuth(token.slice(2))
    } else if (
      flag === '-d' ||
      flag === '--data' ||
      flag === '--data-raw' ||
      flag === '--data-binary' ||
      flag === '--data-ascii'
    ) {
      const val = getValue()
      if (val !== undefined) dataChunks.push(val)
    } else if (token.startsWith('-d') && token.length > 2) {
      dataChunks.push(token.slice(2))
    } else if (flag === '--data-urlencode') {
      const val = getValue()
      if (val !== undefined) urlencodeChunks.push(val)
    } else if (flag === '-F' || flag === '--form' || flag === '--form-string') {
      const val = getValue()
      if (val !== undefined) formChunks.push(val)
    } else if (token.startsWith('-F') && token.length > 2) {
      formChunks.push(token.slice(2))
    } else if (flag.startsWith('-')) {
      if (VALUE_FLAGS.has(flag)) {
        getValue()
      }
    } else {
      const cleanToken = token.replace(/^['"]|['"]$/g, '').trim()
      if (!url || isLikelyUrl(cleanToken)) {
        url = cleanToken
      }
    }

    i++
  }

  if (!url) return null

  // Normalize URL prefix if missing protocol
  if (!/^https?:\/\//i.test(url) && !url.startsWith('{{')) {
    if (url.startsWith('//')) {
      url = `https:${url}`
    } else if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/.*)?$/i.test(url)) {
      url = `http://${url}`
    } else if (url.includes('.')) {
      url = `https://${url}`
    }
  }

  // Body assembling
  let body = ''
  let bodyType: 'none' | 'json' | 'text' = 'none'

  if (dataChunks.length > 0 || urlencodeChunks.length > 0 || formChunks.length > 0) {
    if (dataChunks.length > 0) {
      if (dataChunks.length === 1) {
        body = dataChunks[0]
      } else {
        const hasJson = dataChunks.some((c) => c.trim().startsWith('{') || c.trim().startsWith('['))
        body = dataChunks.join(hasJson ? '\n' : '&')
      }
    }

    if (urlencodeChunks.length > 0) {
      const encoded = urlencodeChunks
        .map((chunk) => {
          const eq = chunk.indexOf('=')
          if (eq !== -1) {
            const k = chunk.slice(0, eq)
            const v = chunk.slice(eq + 1)
            return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
          }
          return encodeURIComponent(chunk)
        })
        .join('&')
      body = body ? `${body}&${encoded}` : encoded
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headerRows.push({
          key: 'Content-Type',
          value: 'application/x-www-form-urlencoded',
          enabled: true
        })
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
    }

    if (formChunks.length > 0 && !body) {
      body = formChunks.join('\n')
    }

    const trimmedBody = body.trim()
    if (trimmedBody) {
      try {
        const parsedJson = JSON.parse(trimmedBody)
        body = JSON.stringify(parsedJson, null, 2)
        bodyType = 'json'
      } catch {
        const isJsonContentType = Object.entries(headers).some(
          ([k, v]) =>
            k.toLowerCase() === 'content-type' && v.toLowerCase().includes('application/json')
        )
        bodyType = isJsonContentType ? 'json' : 'text'
      }
    }
  }

  if (!method) {
    method = bodyType !== 'none' || dataChunks.length > 0 ? 'POST' : 'GET'
  }

  const urlParams = parseQueryParams(url)
  const bodyParams: QueryParam[] = []
  const isUrlEncoded = Object.entries(headers).some(
    ([k, v]) =>
      k.toLowerCase() === 'content-type' &&
      v.toLowerCase().includes('application/x-www-form-urlencoded')
  )

  if (body && (isUrlEncoded || (bodyType === 'text' && body.includes('=')))) {
    const parsedBodyParams = parseQueryParams(body)
    if (parsedBodyParams.length > 0) {
      bodyParams.push(...parsedBodyParams)
    }
  }

  const params: QueryParam[] = [...urlParams]
  for (const bp of bodyParams) {
    if (!params.some((p) => p.key === bp.key && p.value === bp.value)) {
      params.push(bp)
    }
  }

  let adjustedUrl = url
  if (params.length > 0) {
    adjustedUrl = buildUrlWithQuery(url, params)
  }

  return {
    url: adjustedUrl,
    method,
    headers,
    headerRows,
    body,
    bodyType,
    params,
    auth: authInfo
  }
}

/**
 * Builds a formatted cURL command string (Postman style) from request parameters.
 */
export function buildCurlCommand(options: BuildCurlOptions): string {
  const method = (options.method || 'GET').toUpperCase()
  const url = (options.url || '').trim()
  const lines: string[] = []

  const parts: string[] = ['curl', '--location']

  if (method !== 'GET') {
    parts.push(`--request ${method}`)
  }

  const escapeSingle = (str: string) => str.replace(/'/g, "'\\''")

  parts.push(`'${escapeSingle(url)}'`)
  lines.push(parts.join(' '))

  const headerList: Array<{ key: string; value: string }> = []
  if (Array.isArray(options.headers)) {
    for (const h of options.headers) {
      if (h.enabled && h.key.trim()) {
        headerList.push({ key: h.key.trim(), value: h.value })
      }
    }
  } else if (typeof options.headers === 'string') {
    for (const [k, v] of Object.entries(parseHeadersText(options.headers))) {
      headerList.push({ key: k, value: v })
    }
  } else if (options.headers && typeof options.headers === 'object') {
    for (const [k, v] of Object.entries(options.headers)) {
      headerList.push({ key: k, value: String(v) })
    }
  }

  if (options.auth) {
    if (options.auth.type === 'bearer' && options.auth.bearerToken) {
      if (!headerList.some((h) => h.key.toLowerCase() === 'authorization')) {
        headerList.push({
          key: 'Authorization',
          value: `Bearer ${options.auth.bearerToken.trim()}`
        })
      }
    } else if (options.auth.type === 'basic') {
      const u = options.auth.basicUser ?? ''
      const p = options.auth.basicPass ?? ''
      if (u || p) {
        if (!headerList.some((h) => h.key.toLowerCase() === 'authorization')) {
          headerList.push({ key: 'Authorization', value: `Basic ${encodeBasicAuth(u, p)}` })
        }
      }
    } else if (options.auth.type === 'apikey') {
      const k = (options.auth.apiKeyName ?? '').trim()
      const v = options.auth.apiKeyValue ?? ''
      if (k && v) {
        if (!headerList.some((h) => h.key.toLowerCase() === k.toLowerCase())) {
          headerList.push({ key: k, value: v })
        }
      }
    }
  }

  for (const h of headerList) {
    lines.push(`--header '${escapeSingle(`${h.key}: ${h.value}`)}'`)
  }

  if (options.body && options.bodyType !== 'none' && !['GET', 'HEAD'].includes(method)) {
    lines.push(`--data '${escapeSingle(options.body)}'`)
  }

  return lines.join(' \\\n')
}
