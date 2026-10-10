import { describe, expect, it } from 'vitest'
import {
  buildCurlCommand,
  buildUrlWithQuery,
  encodeBasicAuth,
  extractValueByPath,
  formatBytes,
  headersToRows,
  isCurlCommand,
  parseCaptureList,
  parseCurlCommand,
  parseHeadersText,
  parseQueryParams,
  proxyUrl,
  relativeTime,
  resolveVariables,
  responseName,
  rowsToHeadersText,
  stripCodeFences,
  tokenizeShellArgs,
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

describe('parseQueryParams and buildUrlWithQuery', () => {
  it('parses query pairs and decodes them', () => {
    expect(parseQueryParams('https://api.example.com?a=1&b=two%20words')).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: 'two words', enabled: true }
    ])
  })

  it('returns an empty list when there is no query', () => {
    expect(parseQueryParams('https://api.example.com/path')).toEqual([])
  })

  it('rebuilds the URL with encoded params', () => {
    expect(
      buildUrlWithQuery('https://api.example.com/path?old=1', [
        { key: 'a', value: '1', enabled: true },
        { key: 'q', value: 'two words', enabled: true },
        { key: 'skip', value: 'x', enabled: false }
      ])
    ).toBe('https://api.example.com/path?a=1&q=two%20words')
  })

  it('round-trips URL -> params -> URL', () => {
    const url = 'https://api.example.com/path?a=1&q=two%20words'
    expect(buildUrlWithQuery(url, parseQueryParams(url))).toBe(url)
  })
})

describe('headersToRows and rowsToHeadersText', () => {
  it('converts header text into rows', () => {
    expect(headersToRows('Content-Type: application/json\nAccept: */*')).toEqual([
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'Accept', value: '*/*', enabled: true }
    ])
  })

  it('serializes only enabled rows with a key', () => {
    expect(
      rowsToHeadersText([
        { key: 'A', value: '1', enabled: true },
        { key: 'B', value: '2', enabled: false },
        { key: '', value: 'x', enabled: true }
      ])
    ).toBe('A: 1')
  })
})

describe('encodeBasicAuth', () => {
  it('encodes user:password as base64', () => {
    expect(encodeBasicAuth('user', 'pass')).toBe(btoa('user:pass'))
  })
})

describe('tokenizeShellArgs', () => {
  it('splits simple arguments by space', () => {
    expect(tokenizeShellArgs('curl -X POST https://example.com')).toEqual([
      'curl',
      '-X',
      'POST',
      'https://example.com'
    ])
  })

  it('preserves single-quoted strings and escaped single quotes in bash', () => {
    expect(
      tokenizeShellArgs(
        "curl --header 'Content-Type: application/json' --data '{\"name\":\"O'\\''Reilly\"}'"
      )
    ).toEqual([
      'curl',
      '--header',
      'Content-Type: application/json',
      '--data',
      '{"name":"O\'Reilly"}'
    ])
  })

  it('preserves double-quoted strings with spaces and escaped characters', () => {
    expect(
      tokenizeShellArgs('curl -H "Authorization: Bearer my-token" -d "{\\"active\\": true}"')
    ).toEqual(['curl', '-H', 'Authorization: Bearer my-token', '-d', '{"active": true}'])
  })

  it('handles line continuations (bash backslash, cmd caret, powershell backtick)', () => {
    const bash = `curl --location 'https://api.example.com/items' \\
      --header 'Accept: application/json' \\
      --data '{"ok":true}'`
    expect(tokenizeShellArgs(bash)).toEqual([
      'curl',
      '--location',
      'https://api.example.com/items',
      '--header',
      'Accept: application/json',
      '--data',
      '{"ok":true}'
    ])

    const cmd = `curl --location "https://api.example.com/items" ^
      --header "Accept: application/json"`
    expect(tokenizeShellArgs(cmd)).toEqual([
      'curl',
      '--location',
      'https://api.example.com/items',
      '--header',
      'Accept: application/json'
    ])

    const ps = `curl --location 'https://api.example.com/items' \`
      --header 'Accept: application/json'`
    expect(tokenizeShellArgs(ps)).toEqual([
      'curl',
      '--location',
      'https://api.example.com/items',
      '--header',
      'Accept: application/json'
    ])
  })

  it('strips leading prompt symbols', () => {
    expect(tokenizeShellArgs('$ curl https://example.com')).toEqual(['curl', 'https://example.com'])
    expect(tokenizeShellArgs('> curl https://example.com')).toEqual(['curl', 'https://example.com'])
  })
})

describe('isCurlCommand and stripCodeFences', () => {
  it('detects standard curl command strings', () => {
    expect(isCurlCommand("curl 'https://api.example.com'")).toBe(true)
    expect(isCurlCommand('curl.exe -X POST https://api.example.com')).toBe(true)
    expect(isCurlCommand('CURL https://api.example.com')).toBe(true)
    expect(isCurlCommand('$ curl -v https://api.example.com')).toBe(true)
  })

  it('detects multiline curl commands with comments', () => {
    const multi = `# Fetch users from api
    curl --location 'https://api.example.com/users'`
    expect(isCurlCommand(multi)).toBe(true)
  })

  it('detects curl enclosed in markdown code fences', () => {
    const fenced = '```bash\ncurl --location https://api.example.com\n```'
    expect(isCurlCommand(fenced)).toBe(true)
    expect(stripCodeFences(fenced)).toBe('curl --location https://api.example.com')
  })

  it('returns false for plain URLs and non-curl text', () => {
    expect(isCurlCommand('https://api.example.com/users')).toBe(false)
    expect(isCurlCommand('{"some": "json"}')).toBe(false)
    expect(isCurlCommand('')).toBe(false)
  })
})

describe('parseCurlCommand', () => {
  it('parses standard Postman cURL with headers and JSON body', () => {
    const postman = `curl --location 'https://api.example.com/v1/users?page=1&limit=10' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer my-secret-token' \\
--data '{
    "name": "Alice",
    "email": "alice@example.com"
}'`

    const parsed = parseCurlCommand(postman)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.url).toBe('https://api.example.com/v1/users?page=1&limit=10')
    expect(parsed.method).toBe('POST')
    expect(parsed.headers['Content-Type']).toBe('application/json')
    expect(parsed.headers['Authorization']).toBe('Bearer my-secret-token')
    expect(parsed.headerRows).toEqual([
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'Authorization', value: 'Bearer my-secret-token', enabled: true }
    ])
    expect(parsed.params).toEqual([
      { key: 'page', value: '1', enabled: true },
      { key: 'limit', value: '10', enabled: true }
    ])
    expect(parsed.bodyType).toBe('json')
    expect(JSON.parse(parsed.body)).toEqual({
      name: 'Alice',
      email: 'alice@example.com'
    })
    expect(parsed.auth).toEqual({
      type: 'bearer',
      token: 'my-secret-token'
    })
  })

  it('parses Postman cURL with --request and --data-raw', () => {
    const cmd = `curl --location --request PUT 'https://api.example.com/items/42' \\
--header 'Accept: application/json' \\
--data-raw '{"status":"active"}'`

    const parsed = parseCurlCommand(cmd)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.url).toBe('https://api.example.com/items/42')
    expect(parsed.method).toBe('PUT')
    expect(parsed.headers.Accept).toBe('application/json')
    expect(parsed.bodyType).toBe('json')
    expect(JSON.parse(parsed.body)).toEqual({ status: 'active' })
  })

  it('parses cURL with basic auth flag -u / --user', () => {
    const cmd = "curl -u admin:supersecret 'https://api.example.com/admin'"
    const parsed = parseCurlCommand(cmd)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.url).toBe('https://api.example.com/admin')
    expect(parsed.method).toBe('GET')
    expect(parsed.auth).toEqual({
      type: 'basic',
      username: 'admin',
      password: 'supersecret'
    })
    expect(parsed.headers.Authorization).toBe(`Basic ${encodeBasicAuth('admin', 'supersecret')}`)
  })

  it('parses boolean flags without consuming following URL or headers', () => {
    const cmd = "curl -k -s -L --compressed 'https://api.example.com/data' -H 'X-Test: 1'"
    const parsed = parseCurlCommand(cmd)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.url).toBe('https://api.example.com/data')
    expect(parsed.method).toBe('GET')
    expect(parsed.headers['X-Test']).toBe('1')
  })

  it('parses URL with explicit --url flag and shorthand flags like -XPOST', () => {
    const cmd =
      "curl -XPOST --url 'https://api.example.com/submit' -H'Content-Type: text/plain' -d'Hello World'"
    const parsed = parseCurlCommand(cmd)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.url).toBe('https://api.example.com/submit')
    expect(parsed.method).toBe('POST')
    expect(parsed.headers['Content-Type']).toBe('text/plain')
    expect(parsed.body).toBe('Hello World')
    expect(parsed.bodyType).toBe('text')
  })

  it('parses urlencoded form data from multiple --data-urlencode flags', () => {
    const cmd =
      "curl --location 'https://api.example.com/token' --data-urlencode 'grant_type=client_credentials' --data-urlencode 'client_id=123'"
    const parsed = parseCurlCommand(cmd)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.method).toBe('POST')
    expect(parsed.body).toBe('grant_type=client_credentials&client_id=123')
    expect(parsed.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('returns null if no URL can be identified', () => {
    expect(parseCurlCommand('curl -v -k')).toBeNull()
    expect(parseCurlCommand('')).toBeNull()
  })
})

describe('buildCurlCommand', () => {
  it('builds a Postman-compatible GET curl command', () => {
    const curl = buildCurlCommand({
      method: 'GET',
      url: 'https://api.example.com/items?q=test',
      headers: [
        { key: 'Accept', value: 'application/json', enabled: true },
        { key: 'X-Disabled', value: 'ignore', enabled: false }
      ]
    })

    expect(curl).toBe(
      "curl --location 'https://api.example.com/items?q=test' \\\n--header 'Accept: application/json'"
    )
  })

  it('builds a POST curl command with body and auth', () => {
    const curl = buildCurlCommand({
      method: 'POST',
      url: 'https://api.example.com/login',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: '{"username":"john"}',
      bodyType: 'json',
      auth: {
        type: 'bearer',
        bearerToken: 'secret123'
      }
    })

    expect(curl).toContain("curl --location --request POST 'https://api.example.com/login'")
    expect(curl).toContain("--header 'Content-Type: application/json'")
    expect(curl).toContain("--header 'Authorization: Bearer secret123'")
    expect(curl).toContain('--data \'{"username":"john"}\'')
  })

  it('round-trips through buildCurlCommand and parseCurlCommand', () => {
    const original = {
      method: 'POST',
      url: 'https://api.example.com/v1/resource?active=true',
      headers: [
        { key: 'Content-Type', value: 'application/json', enabled: true },
        { key: 'X-Key', value: 'val-123', enabled: true }
      ],
      body: '{\n  "name": "Roundtrip"\n}',
      bodyType: 'json' as const
    }

    const built = buildCurlCommand(original)
    const parsed = parseCurlCommand(built)

    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.method).toBe(original.method)
    expect(parsed.url).toBe(original.url)
    expect(parsed.headers['Content-Type']).toBe('application/json')
    expect(parsed.headers['X-Key']).toBe('val-123')
    expect(parsed.params).toEqual([{ key: 'active', value: 'true', enabled: true }])
    expect(parsed.bodyType).toBe('json')
    expect(JSON.parse(parsed.body)).toEqual({ name: 'Roundtrip' })
  })

  it('parses form-urlencoded parameters from multiple -d flags and adjusts the URL', () => {
    const cmd = `curl -X POST "https://api.exemplo.com/login" \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "username=admin" \\
  -d "password=123456"`

    const parsed = parseCurlCommand(cmd)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.method).toBe('POST')
    expect(parsed.url).toBe('https://api.exemplo.com/login?username=admin&password=123456')
    expect(parsed.params).toEqual([
      { key: 'username', value: 'admin', enabled: true },
      { key: 'password', value: '123456', enabled: true }
    ])
    expect(parsed.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(parsed.body).toBe('username=admin&password=123456')
  })

  it('parses form-urlencoded parameters when the URL is at the end of the command', () => {
    const cmd = `curl -X POST \\
     -H "Content-Type: application/x-www-form-urlencoded" \\
     -d "username=testuser&password=testpass" \\
     https://www.example.com/login`

    const parsed = parseCurlCommand(cmd)
    expect(parsed).not.toBeNull()
    if (!parsed) return

    expect(parsed.method).toBe('POST')
    expect(parsed.url).toBe('https://www.example.com/login?username=testuser&password=testpass')
    expect(parsed.params).toEqual([
      { key: 'username', value: 'testuser', enabled: true },
      { key: 'password', value: 'testpass', enabled: true }
    ])
    expect(parsed.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(parsed.body).toBe('username=testuser&password=testpass')
  })
})

