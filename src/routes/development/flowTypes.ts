import type { CaptureRule } from './tabUtils.js'
import type { HeaderRow, QueryParam } from './requestsUtils.js'

export type FlowNodeType =
  | 'rest'
  | 'js'
  | 'transform'
  | 'router'
  | 'loop'
  | 'delay'
  | 'merge'
  | 'start'
  | 'terminate'
  | 'event-throw'
  | 'event-catch'

export type PortSlot = 'top' | 'middle' | 'bottom'

export interface FlowNodePort {
  id: string
  label: string
  slot: PortSlot
  slotIndex?: number
  color?: string
}

export interface FlowNodeEventData {
  eventName: string
  targetFlowId?: string
  targetFlowName?: string
}

export interface WorkspaceSpatialFlow {
  id: string
  name: string
  groupId: string
  graph: FlowGraph
  createdAt: number
  updatedAt: number
}

export interface WorkspaceFlowGroup {
  id: string
  name: string
  collapsed?: boolean
}

export interface FlowNodeRestData {
  method: string
  url: string
  queryParams?: QueryParam[]
  headers: string
  headerRows?: HeaderRow[]
  body: string
  bodyType: 'none' | 'json' | 'text'
  proxyMode?: 'inherit' | 'direct' | 'corsproxy' | 'allorigins' | 'custom'
  customProxyUrl?: string
  authType?: 'inherit' | 'none' | 'bearer' | 'basic' | 'apikey'
  authBearerToken?: string
  authBasicUser?: string
  authBasicPass?: string
  authApiKeyName?: string
  authApiKeyValue?: string
  captures: CaptureRule[]
}

export interface FlowNodeJsData {
  code: string
  ports?: FlowNodePort[]
}

export type MapperModifier =
  | 'direct'
  | 'uppercase'
  | 'lowercase'
  | 'trim'
  | 'number'
  | 'string'
  | 'boolean'

export interface FlowNodeTransformMapping {
  id: string
  sourcePath: string
  targetPath: string
  modifier?: MapperModifier
  defaultValue?: string
}

export interface FlowNodeTransformData {
  sampleInput?: string
  mappings: FlowNodeTransformMapping[]
  saveToEnvVar?: string
}

export type RouterRuleType = 'status' | 'jsonpath' | 'otherwise'
export type RouterOperator =
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'contains'
  | 'exists'
  | 'not-exists'
  | 'is_empty'
  | 'in'
  | 'between'

export interface FlowNodeRouterRule {
  id: string
  portId: string
  label: string
  type: RouterRuleType
  statusPattern?: string
  path?: string
  operator?: RouterOperator
  value?: string
}

export interface FlowNodeRouterData {
  mode: 'first-match' | 'all-matches'
  ports: FlowNodePort[]
  rules: FlowNodeRouterRule[]
}

export interface FlowNodeLoopData {
  arrayPath: string
  itemVar?: string
  indexVar?: string
  mode?: 'for-each' | 'count'
  repeatCount?: number
  maxIterations?: number
  delayMs?: number
  status?: 'future'
}

export interface FlowNodeDelayData {
  mode: 'delay' | 'throttle'
  delayMs: number
  ratePerSecond?: number
  status?: 'future'
}

export interface FlowNodeMergeData {
  strategy: 'wait-all' | 'first-completed' | 'combine'
  inputs?: FlowNodePort[]
  status?: 'future'
}

export type FlowNodeExecutionStatus = 'idle' | 'waiting' | 'running' | 'success' | 'error' | 'skipped'

export interface FlowNodeExecutionHistoryEntry {
  id: string
  timestamp: number
  status?: number | string
  durationMs: number
  responseText?: string
  responseHeaders?: Record<string, string>
  sizeBytes?: number
  viaProxy?: boolean
  error?: string
  logs?: string[]
}

export interface FlowNodeLastRun {
  durationMs: number
  status?: number | string
  error?: string
  outputSummary?: string
  timestamp: number
  responseText?: string
  responseHeaders?: Record<string, string>
  sizeBytes?: number
  viaProxy?: boolean
  logs?: string[]
}

export interface FlowNode {
  id: string
  type: FlowNodeType
  title: string
  x: number
  y: number
  restData?: FlowNodeRestData
  jsData?: FlowNodeJsData
  transformData?: FlowNodeTransformData
  routerData?: FlowNodeRouterData
  loopData?: FlowNodeLoopData
  delayData?: FlowNodeDelayData
  mergeData?: FlowNodeMergeData
  eventData?: FlowNodeEventData
  status?: FlowNodeExecutionStatus
  lastRun?: FlowNodeLastRun
  history?: FlowNodeExecutionHistoryEntry[]
}

export type ConnectionKind = 'solid' | 'dotted'

export interface FlowConnection {
  id: string
  fromId: string
  toId: string
  fromPort?: string
  toPort?: string
  kind: ConnectionKind // 'solid' = wait for all to finish (join); 'dotted' = do not wait (async)
}

export interface FlowGraph {
  nodes: FlowNode[]
  connections: FlowConnection[]
}

/**
 * Execute custom JavaScript in a sandbox with Postman compatibility:
 * - pm.environment.get / set / unset
 * - env.get / set / unset
 * - captured console.log
 */
export function executeJsSandbox(
  code: string,
  initialEnv: Record<string, string>,
  initialGlobalEnv: Record<string, string> = {},
  options?: {
    ports?: FlowNodePort[]
    payload?: unknown
  }
): {
  success: boolean
  updatedEnv: Record<string, string>
  updatedGlobalEnv: Record<string, string>
  logs: string[]
  activePorts: string[]
  portPayloads: Record<string, unknown>
  error?: string
} {
  const currentEnv = { ...initialEnv }
  const currentGlobals = { ...initialGlobalEnv }
  const logs: string[] = []
  const activePorts: string[] = []
  const portPayloads: Record<string, unknown> = {}

  const envHelper = {
    get(key: string): string | undefined {
      return currentEnv[key]
    },
    set(key: string, value: unknown): void {
      currentEnv[key] = String(value ?? '')
    },
    unset(key: string): void {
      delete currentEnv[key]
    },
    has(key: string): boolean {
      return Object.prototype.hasOwnProperty.call(currentEnv, key)
    },
    toObject(): Record<string, string> {
      return { ...currentEnv }
    }
  }

  const globalsHelper = {
    get(key: string): string | undefined {
      return currentGlobals[key]
    },
    set(key: string, value: unknown): void {
      currentGlobals[key] = String(value ?? '')
    },
    unset(key: string): void {
      delete currentGlobals[key]
    },
    has(key: string): boolean {
      return Object.prototype.hasOwnProperty.call(currentGlobals, key)
    },
    toObject(): Record<string, string> {
      return { ...currentGlobals }
    }
  }

  const variablesHelper = {
    get(key: string): string | undefined {
      return currentEnv[key] ?? currentGlobals[key]
    },
    set(key: string, value: unknown): void {
      currentEnv[key] = String(value ?? '')
    },
    unset(key: string): void {
      delete currentEnv[key]
    },
    has(key: string): boolean {
      return (
        Object.prototype.hasOwnProperty.call(currentEnv, key) ||
        Object.prototype.hasOwnProperty.call(currentGlobals, key)
      )
    },
    toObject(): Record<string, string> {
      return { ...currentGlobals, ...currentEnv }
    }
  }

  const pm = {
    environment: envHelper,
    variables: variablesHelper,
    collectionVariables: envHelper,
    globals: globalsHelper
  }

  const mockConsole = {
    log(...args: unknown[]): void {
      logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
    },
    info(...args: unknown[]): void {
      mockConsole.log(...args)
    },
    warn(...args: unknown[]): void {
      logs.push(
        '[WARN] ' +
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      )
    },
    error(...args: unknown[]): void {
      logs.push(
        '[ERROR] ' +
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      )
    }
  }

  const routeHelper = (portIdOrIndex: string | number) => {
    let portId = String(portIdOrIndex)
    if (typeof portIdOrIndex === 'number' && options?.ports) {
      const p = options.ports[portIdOrIndex]
      if (p) portId = p.id
    }
    if (!activePorts.includes(portId)) {
      activePorts.push(portId)
    }
  }

  const outHelper = (portIdOrIndex: string | number, payload?: unknown) => {
    let portId = String(portIdOrIndex)
    if (typeof portIdOrIndex === 'number' && options?.ports) {
      const p = options.ports[portIdOrIndex]
      if (p) portId = p.id
    }
    if (!activePorts.includes(portId)) {
      activePorts.push(portId)
    }
    if (payload !== undefined) {
      portPayloads[portId] = payload
    }
  }

  try {
    const fn = new Function(
      'pm',
      'env',
      'globals',
      'console',
      'route',
      'out',
      'payload',
      `"use strict";\n${code}`
    )
    fn(pm, envHelper, globalsHelper, mockConsole, routeHelper, outHelper, options?.payload ?? null)
    return {
      success: true,
      updatedEnv: currentEnv,
      updatedGlobalEnv: currentGlobals,
      logs,
      activePorts,
      portPayloads
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logs.push(`[ERROR] ${msg}`)
    return {
      success: false,
      updatedEnv: currentEnv,
      updatedGlobalEnv: currentGlobals,
      logs,
      activePorts,
      portPayloads,
      error: msg
    }
  }
}

// --- ROUTER HELPER FUNCTIONS ---

export function createDefaultRouterPorts(): FlowNodePort[] {
  return [
    { id: 'port_2xx', label: '2xx Success', slot: 'top', slotIndex: 2, color: '#10b981' },
    { id: 'port_default', label: 'Default Route', slot: 'middle', slotIndex: 1, color: '#f59e0b' },
    { id: 'port_4xx_5xx', label: '4xx/5xx Error', slot: 'bottom', slotIndex: 3, color: '#ef4444' },
    { id: 'port_otherwise', label: 'Otherwise', slot: 'bottom', slotIndex: 6, color: '#f43f5e' }
  ]
}

export function createDefaultRouterRules(): FlowNodeRouterRule[] {
  return [
    {
      id: 'rule_1',
      portId: 'port_2xx',
      label: 'Success 2xx',
      type: 'status',
      statusPattern: '200-299'
    },
    {
      id: 'rule_2',
      portId: 'port_4xx_5xx',
      label: 'Client/Server Error',
      type: 'status',
      statusPattern: '400-599'
    },
    {
      id: 'rule_3',
      portId: 'port_otherwise',
      label: 'Otherwise Fallback',
      type: 'otherwise'
    }
  ]
}

export function matchStatusPattern(status: number, pattern?: string): boolean {
  if (!pattern) return false
  const trimmed = pattern.trim().toLowerCase()
  if (!trimmed) return false

  // Handle comma-separated list like "200, 201, 204"
  if (trimmed.includes(',')) {
    return trimmed.split(',').some((p) => matchStatusPattern(status, p.trim()))
  }

  // Handle range like "200-299"
  if (trimmed.includes('-')) {
    const [minStr, maxStr] = trimmed.split('-')
    const min = Number(minStr.trim())
    const max = Number(maxStr.trim())
    if (!isNaN(min) && !isNaN(max)) {
      return status >= min && status <= max
    }
  }

  // Handle wildcards like "2xx", "4xx", "5xx"
  if (trimmed.endsWith('xx')) {
    const prefix = trimmed.slice(0, 1)
    return String(status).startsWith(prefix)
  }

  // Exact match
  const num = Number(trimmed)
  if (!isNaN(num)) {
    return status === num
  }

  return false
}

function extractJsonValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object' || !path) return undefined
  const cleanPath = path.startsWith('$.')
    ? path.slice(2)
    : path.startsWith('$')
      ? path.slice(1)
      : path
  const parts = cleanPath.split('.').map((p) => p.trim()).filter(Boolean)
  let cur: unknown = obj
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    const match = part.match(/^([^[]+)\[(\d+)\]$/)
    if (match) {
      const arrKey = match[1]
      const idx = Number(match[2])
      const arr = (cur as Record<string, unknown>)[arrKey]
      if (Array.isArray(arr) && idx >= 0 && idx < arr.length) {
        cur = arr[idx]
      } else {
        return undefined
      }
    } else {
      cur = (cur as Record<string, unknown>)[part]
    }
  }
  return cur
}

function evaluateJsonPathRule(rule: FlowNodeRouterRule, payload: unknown): boolean {
  if (!rule.path) return false
  const actual = extractJsonValue(payload, rule.path)
  const op = rule.operator || '=='
  const expectedStr = (rule.value ?? '').trim()

  if (op === 'exists') {
    return actual !== undefined && actual !== null
  }
  if (op === 'not-exists') {
    return actual === undefined || actual === null
  }
  if (op === 'is_empty') {
    if (actual === undefined || actual === null) return true
    if (typeof actual === 'string') return actual.trim() === ''
    if (Array.isArray(actual)) return actual.length === 0
    if (typeof actual === 'object') return Object.keys(actual as object).length === 0
    return false
  }

  if (actual === undefined || actual === null) {
    return false
  }

  const actualStr = String(actual).trim()

  switch (op) {
    case '==':
      return actualStr === expectedStr || String(actual) === expectedStr
    case '!=':
      return actualStr !== expectedStr
    case '>':
      return Number(actual) > Number(expectedStr)
    case '<':
      return Number(actual) < Number(expectedStr)
    case '>=':
      return Number(actual) >= Number(expectedStr)
    case '<=':
      return Number(actual) <= Number(expectedStr)
    case 'contains':
      if (Array.isArray(actual)) {
        return actual.some((item) => String(item).includes(expectedStr))
      }
      return actualStr.toLowerCase().includes(expectedStr.toLowerCase())
    case 'in': {
      const list = expectedStr.split(',').map((s) => s.trim().toLowerCase())
      return list.includes(actualStr.toLowerCase())
    }
    case 'between': {
      const parts = expectedStr.split(/[-–—]/).map((s) => s.trim())
      if (parts.length === 2) {
        const num = Number(actual)
        return !isNaN(num) && num >= Number(parts[0]) && num <= Number(parts[1])
      }
      return false
    }
    default:
      return false
  }
}

export function evaluateRouterRules(
  rules: FlowNodeRouterRule[],
  mode: 'first-match' | 'all-matches' = 'first-match',
  payload: unknown = null,
  status: number = 200
): { matchedPortIds: string[]; matchedRules: FlowNodeRouterRule[] } {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { matchedPortIds: [], matchedRules: [] }
  }

  const matchedRules: FlowNodeRouterRule[] = []
  let otherwiseRule: FlowNodeRouterRule | null = null

  for (const rule of rules) {
    if (rule.type === 'otherwise') {
      otherwiseRule = rule
      continue
    }

    let isMatch = false
    if (rule.type === 'status') {
      isMatch = matchStatusPattern(status, rule.statusPattern)
    } else if (rule.type === 'jsonpath') {
      isMatch = evaluateJsonPathRule(rule, payload)
    }

    if (isMatch) {
      matchedRules.push(rule)
      if (mode === 'first-match') {
        break
      }
    }
  }

  if (matchedRules.length === 0 && otherwiseRule) {
    matchedRules.push(otherwiseRule)
  }

  const matchedPortIds = Array.from(new Set(matchedRules.map((r) => r.portId).filter(Boolean)))
  return { matchedPortIds, matchedRules }
}


/**
 * Convert legacy chain items to a visual spatial FlowGraph
 */
export function migrateChainToFlowGraph(
  chainItems: Array<{
    method?: string
    url?: string
    headers?: string
    body?: string
    captures?: Array<{ path: string; name: string }>
    capturePath?: string
    captureVar?: string
  }>
): FlowGraph {
  if (!Array.isArray(chainItems) || chainItems.length === 0) {
    return createDefaultFlowGraph()
  }

  const nodes: FlowNode[] = []
  const connections: FlowConnection[] = []

  let currentX = 60
  const currentY = 120
  const gapX = 300

  chainItems.forEach((item, index) => {
    const id = `node_${index + 1}`
    const captures: CaptureRule[] =
      item.captures && item.captures.length > 0
        ? item.captures.map((c) => ({ path: c.path, name: c.name, enabled: true }))
        : item.capturePath && item.captureVar
          ? [{ path: item.capturePath, name: item.captureVar, enabled: true }]
          : []

    nodes.push({
      id,
      type: 'rest',
      title: `Step ${index + 1} (${item.method ?? 'GET'})`,
      x: currentX,
      y: currentY + (index % 2 === 1 ? 40 : 0),
      restData: {
        method: item.method ?? 'GET',
        url: item.url ?? '',
        headers: item.headers ?? '',
        body: item.body ?? '',
        bodyType: 'json',
        proxyMode: 'inherit',
        authType: 'inherit',
        captures
      },
      status: 'idle'
    })

    if (index > 0) {
      connections.push({
        id: `conn_${index}`,
        fromId: `node_${index}`,
        toId: id,
        kind: 'solid'
      })
    }

    currentX += gapX
  })

  return { nodes, connections }
}

/**
 * Initial Rick & Morty example flow:
 * 1. Start node (Green Circle)
 * 2. REST: GET character 1 -> captures charId, charStatus, charName
 * 3. JS: Script with if condition, reading and writing environment variables
 * 4. Event Throw (Filled Blue Circle): broadcast "valida total"
 * 5. Event Catch (Dotted Blue Circle): catch "valida total"
 * 6. REST: GET episode with {{charId}} -> captures episodeName
 * 7. Terminate (Red Circle): halts execution
 */
export function createEmptyFlowGraph(): FlowGraph {
  return {
    nodes: [],
    connections: []
  }
}

export function createDefaultFlowGraph(): FlowGraph {
  return {
    nodes: [
      {
        id: 'node_start',
        type: 'start',
        title: 'Start',
        x: 60,
        y: 123,
        status: 'idle'
      },
      {
        id: 'node_1',
        type: 'rest',
        title: '1. Fetch Character',
        x: 160,
        y: 80,
        restData: {
          method: 'GET',
          url: '{{baseUrl}}/character/1',
          headers: '',
          body: '',
          bodyType: 'json',
          proxyMode: 'inherit',
          authType: 'inherit',
          captures: [
            { path: 'id', name: 'charId', enabled: true },
            { path: 'status', name: 'charStatus', enabled: true },
            { path: 'name', name: 'charName', enabled: true }
          ]
        },
        status: 'idle'
      },
      {
        id: 'node_2',
        type: 'js',
        title: '2. Validation Script',
        x: 490,
        y: 80,
        jsData: {
          code: `// Get variables captured from previous step
const charId = pm.environment.get("charId");
const charName = pm.environment.get("charName") || "Rick Sanchez";
const charStatus = pm.environment.get("charStatus") || "Alive";

console.log(\`Character: \${charName} (ID: \${charId}), Status: \${charStatus}\`);

// Conditional validation with IF and environment update
if (charStatus === "Alive" && Number(charId) > 0) {
  console.log("Validation passed: Active and valid character!");
  pm.environment.set("isValidCharacter", "true");
  pm.environment.set("customHeader", "RickMorty-Verified");
  pm.environment.set("charIdTimesTwo", Number(charId || 1) * 2);
} else {
  console.warn("Alternative validation triggered for fallback");
  pm.environment.set("isValidCharacter", "false");
  pm.environment.set("customHeader", "RickMorty-Fallback");
}

console.log("Environment variables updated successfully!");`
        },
        status: 'idle'
      },
      {
        id: 'node_event_throw',
        type: 'event-throw',
        title: 'Jump: valida total',
        eventData: { eventName: 'valida total' },
        x: 820,
        y: 123,
        status: 'idle'
      },
      {
        id: 'node_event_catch',
        type: 'event-catch',
        title: 'Receiver: valida total',
        eventData: { eventName: 'valida total' },
        x: 60,
        y: 303,
        status: 'idle'
      },
      {
        id: 'node_3',
        type: 'rest',
        title: '3. Fetch Episode',
        x: 160,
        y: 260,
        restData: {
          method: 'GET',
          url: '{{baseUrl}}/episode/{{charId}}',
          headers: 'X-Flow-Agent: {{customHeader}}',
          body: '',
          bodyType: 'json',
          proxyMode: 'inherit',
          authType: 'inherit',
          captures: [{ path: 'name', name: 'episodeName', enabled: true }]
        },
        status: 'idle'
      },
      {
        id: 'node_terminate',
        type: 'terminate',
        title: 'End of Flow',
        x: 490,
        y: 303,
        status: 'idle'
      }
    ],
    connections: [
      {
        id: 'conn_start_1',
        fromId: 'node_start',
        toId: 'node_1',
        kind: 'solid'
      },
      {
        id: 'conn_1_2',
        fromId: 'node_1',
        toId: 'node_2',
        kind: 'solid'
      },
      {
        id: 'conn_2_throw',
        fromId: 'node_2',
        toId: 'node_event_throw',
        kind: 'solid'
      },
      {
        id: 'conn_catch_3',
        fromId: 'node_event_catch',
        toId: 'node_3',
        kind: 'solid'
      },
      {
        id: 'conn_3_terminate',
        fromId: 'node_3',
        toId: 'node_terminate',
        kind: 'solid'
      }
    ]
  }
}

/**
 * Advanced Rick & Morty example flow. Every block does real work and feeds the next one:
 *
 * 1. REST "Fetch Character" calls /character/{{charId}} and captures name, status, species,
 *    the origin URL and the URL of the first episode into environment variables.
 * 2. Router "Route by Status" sends the flow down ONE of three ports based on the captured payload:
 *    Alive -> hero branch, Dead -> incident branch, anything else -> fallback branch.
 * 3. Alive branch: JSON Mapper builds a hero profile (saved in {{heroProfile}}), REST calls the
 *    origin URL captured in step 1, and a JS block combines both into a danger rating.
 * 4. Dead branch: REST calls the first-episode URL captured in step 1 and JS archives the record.
 * 5. Unknown branch: JS flags the character for manual review.
 * 6. Every branch ends with an Event Jump ("finish_telemetry"); the Event Receiver catches it
 *    and the Terminate block ends the flow.
 *
 * Change the environment variable charId (e.g. 8 = Dead, 7 = unknown) to exercise the other branches.
 */
export function createAdvancedFlowGraph(): FlowGraph {
  return {
    nodes: [
      {
        id: 'node_start',
        type: 'start',
        title: 'Start Flow',
        x: 60,
        y: 260,
        status: 'idle'
      },
      {
        id: 'node_fetch_char',
        type: 'rest',
        title: '1. Fetch Character',
        x: 180,
        y: 220,
        restData: {
          method: 'GET',
          url: '{{baseUrl}}/character/{{charId}}',
          headers: '',
          body: '',
          bodyType: 'json',
          proxyMode: 'inherit',
          authType: 'inherit',
          captures: [
            { path: 'name', name: 'charName', enabled: true },
            { path: 'status', name: 'charStatus', enabled: true },
            { path: 'species', name: 'charSpecies', enabled: true },
            { path: 'origin.url', name: 'originUrl', enabled: true },
            { path: 'episode[0]', name: 'firstEpisodeUrl', enabled: true }
          ]
        },
        status: 'idle'
      },
      {
        id: 'node_router',
        type: 'router',
        title: '2. Route by Status',
        x: 520,
        y: 200,
        routerData: {
          mode: 'first-match',
          ports: [
            { id: 'port_alive', label: 'Alive Character', slot: 'top', slotIndex: 1, color: '#10b981' },
            { id: 'port_dead', label: 'Dead Character', slot: 'middle', slotIndex: 2, color: '#ef4444' },
            { id: 'port_unknown', label: 'Unknown / Fallback', slot: 'bottom', slotIndex: 3, color: '#f59e0b' }
          ],
          rules: [
            {
              id: 'rule_alive',
              portId: 'port_alive',
              label: 'Status is Alive',
              type: 'jsonpath',
              path: 'status',
              operator: '==',
              value: 'Alive'
            },
            {
              id: 'rule_dead',
              portId: 'port_dead',
              label: 'Status is Dead',
              type: 'jsonpath',
              path: 'status',
              operator: '==',
              value: 'Dead'
            },
            {
              id: 'rule_fallback',
              portId: 'port_unknown',
              label: 'Any other status (Fallback)',
              type: 'otherwise'
            }
          ]
        },
        status: 'idle'
      },

      // --- ALIVE BRANCH: profile -> origin lookup -> danger rating ---
      {
        id: 'node_transform_alive',
        type: 'transform',
        title: '3a. Build Hero Profile',
        x: 880,
        y: 60,
        transformData: {
          mappings: [
            { id: 'm1', sourcePath: 'name', targetPath: 'hero.name', modifier: 'uppercase' },
            { id: 'm2', sourcePath: 'species', targetPath: 'hero.species', modifier: 'trim' },
            { id: 'm3', sourcePath: 'status', targetPath: 'hero.status', modifier: 'lowercase' }
          ],
          saveToEnvVar: 'heroProfile'
        },
        status: 'idle'
      },
      {
        id: 'node_fetch_origin',
        type: 'rest',
        title: '4a. Fetch Origin Location',
        x: 1220,
        y: 60,
        restData: {
          method: 'GET',
          url: '{{originUrl}}',
          headers: '',
          body: '',
          bodyType: 'json',
          proxyMode: 'inherit',
          authType: 'inherit',
          captures: [
            { path: 'dimension', name: 'charDimension', enabled: true },
            { path: 'residents.length', name: 'residentCount', enabled: true }
          ]
        },
        status: 'idle'
      },
      {
        id: 'node_js_alive',
        type: 'js',
        title: '5a. Rate Danger Level',
        x: 1560,
        y: 60,
        jsData: {
          code: `// Combine the mapped hero profile with the origin location data
const hero = JSON.parse(pm.environment.get('heroProfile') || '{}').hero || {};
const dimension = pm.environment.get('charDimension') || 'unknown dimension';
const residents = Number(pm.environment.get('residentCount')) || 0;
const danger = residents > 50 ? 'HIGH' : residents > 20 ? 'MEDIUM' : 'LOW';
console.log(hero.name + ' (' + hero.species + ', ' + hero.status + ') originates from ' + dimension + ' with ' + residents + ' known residents. Danger level: ' + danger);
pm.environment.set('dangerLevel', danger);
pm.environment.set('flowOutcome', 'Hero active - ' + dimension + ' - danger ' + danger);`
        },
        status: 'idle'
      },
      {
        id: 'node_jump_alive',
        type: 'event-throw',
        title: 'Jump: Finish',
        x: 1900,
        y: 84,
        eventData: { eventName: 'finish_telemetry' },
        status: 'idle'
      },

      // --- DEAD BRANCH: first appearance lookup -> archive record ---
      {
        id: 'node_fetch_episode',
        type: 'rest',
        title: '3b. Fetch First Episode',
        x: 880,
        y: 240,
        restData: {
          method: 'GET',
          url: '{{firstEpisodeUrl}}',
          headers: '',
          body: '',
          bodyType: 'json',
          proxyMode: 'inherit',
          authType: 'inherit',
          captures: [
            { path: 'name', name: 'episodeTitle', enabled: true },
            { path: 'air_date', name: 'episodeAirDate', enabled: true }
          ]
        },
        status: 'idle'
      },
      {
        id: 'node_js_dead',
        type: 'js',
        title: '4b. Archive Record',
        x: 1220,
        y: 240,
        jsData: {
          code: `// Archive the deceased character together with their first appearance
const name = pm.environment.get('charName') || 'Unknown';
const episode = pm.environment.get('episodeTitle') || 'unknown episode';
const aired = pm.environment.get('episodeAirDate') || 'unknown date';
console.warn(name + ' is deceased. First appearance: ' + episode + ' (' + aired + '). Record archived.');
pm.environment.set('archiveRecord', name + ' | ' + episode + ' | ' + aired);
pm.environment.set('flowOutcome', 'Deceased - archived');`
        },
        status: 'idle'
      },
      {
        id: 'node_jump_dead',
        type: 'event-throw',
        title: 'Jump: Finish',
        x: 1560,
        y: 264,
        eventData: { eventName: 'finish_telemetry' },
        status: 'idle'
      },

      // --- UNKNOWN BRANCH: flag for manual review ---
      {
        id: 'node_js_unknown',
        type: 'js',
        title: '3c. Flag for Review',
        x: 880,
        y: 420,
        jsData: {
          code: `// Fallback: the status is neither Alive nor Dead
const name = pm.environment.get('charName') || 'Unknown';
const species = pm.environment.get('charSpecies') || 'unknown species';
const status = pm.environment.get('charStatus') || 'unknown';
console.info(name + ' (' + species + ') has status "' + status + '". Manual review required.');
pm.environment.set('flowOutcome', 'Unverified - manual review required');`
        },
        status: 'idle'
      },
      {
        id: 'node_jump_unknown',
        type: 'event-throw',
        title: 'Jump: Finish',
        x: 1220,
        y: 444,
        eventData: { eventName: 'finish_telemetry' },
        status: 'idle'
      },

      // --- CONVERGENCE: EVENT RECEIVER -> TERMINATE ---
      {
        id: 'node_recv_finish',
        type: 'event-catch',
        title: 'Receiver: Finish',
        x: 180,
        y: 480,
        eventData: { eventName: 'finish_telemetry' },
        status: 'idle'
      },
      {
        id: 'node_terminate',
        type: 'terminate',
        title: 'End of Flow',
        x: 340,
        y: 480,
        status: 'idle'
      }
    ],
    connections: [
      { id: 'c_start_fetch', fromId: 'node_start', toId: 'node_fetch_char', kind: 'solid' },
      { id: 'c_fetch_router', fromId: 'node_fetch_char', toId: 'node_router', kind: 'solid' },

      // Router port connectors:
      {
        id: 'c_router_alive',
        fromId: 'node_router',
        toId: 'node_transform_alive',
        fromPort: 'port_alive',
        kind: 'solid'
      },
      { id: 'c_trans_origin', fromId: 'node_transform_alive', toId: 'node_fetch_origin', kind: 'solid' },
      { id: 'c_origin_js', fromId: 'node_fetch_origin', toId: 'node_js_alive', kind: 'solid' },
      { id: 'c_js_jump_alive', fromId: 'node_js_alive', toId: 'node_jump_alive', kind: 'solid' },

      {
        id: 'c_router_dead',
        fromId: 'node_router',
        toId: 'node_fetch_episode',
        fromPort: 'port_dead',
        kind: 'solid'
      },
      { id: 'c_episode_js', fromId: 'node_fetch_episode', toId: 'node_js_dead', kind: 'solid' },
      { id: 'c_js_jump_dead', fromId: 'node_js_dead', toId: 'node_jump_dead', kind: 'solid' },

      {
        id: 'c_router_unk',
        fromId: 'node_router',
        toId: 'node_js_unknown',
        fromPort: 'port_unknown',
        kind: 'solid'
      },
      { id: 'c_unk_jump', fromId: 'node_js_unknown', toId: 'node_jump_unknown', kind: 'solid' },

      { id: 'c_recv_term', fromId: 'node_recv_finish', toId: 'node_terminate', kind: 'solid' }
    ]
  }
}

// --- FLOW FILE (import / export / save / open) ---

export const FLOW_FILE_FORMAT = 'spatial-flow'
export const FLOW_FILE_VERSION = 1

/** Serialize a flow graph to a portable JSON file (runtime state like history/lastRun is stripped). */
export function serializeFlowFile(graph: FlowGraph): string {
  const nodes = graph.nodes.map((n) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { status, lastRun, history, ...rest } = n
    return rest
  })
  return JSON.stringify(
    {
      format: FLOW_FILE_FORMAT,
      version: FLOW_FILE_VERSION,
      graph: { nodes, connections: graph.connections }
    },
    null,
    2
  )
}

const VALID_FLOW_NODE_TYPES = new Set<FlowNodeType>([
  'rest',
  'js',
  'transform',
  'router',
  'loop',
  'delay',
  'merge',
  'start',
  'terminate',
  'event-throw',
  'event-catch'
])

/**
 * Parse a flow file. Accepts the wrapped format `{ format, version, graph }`
 * or a bare `{ nodes, connections }` graph. Throws an Error with a readable message when invalid.
 */
export function parseFlowFile(text: string): FlowGraph {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }
  const obj = data as { graph?: unknown; nodes?: unknown; connections?: unknown }
  const raw = (obj && typeof obj === 'object' && obj.graph ? obj.graph : obj) as {
    nodes?: unknown
    connections?: unknown
  }
  if (!raw || !Array.isArray(raw.nodes)) {
    throw new Error('Not a valid Spatial Flow file (missing "nodes")')
  }
  const nodes: FlowNode[] = []
  for (const n of raw.nodes as Partial<FlowNode>[]) {
    if (!n || typeof n.id !== 'string' || !VALID_FLOW_NODE_TYPES.has(n.type as FlowNodeType)) {
      throw new Error('Invalid node in flow file')
    }
    nodes.push({
      ...(n as FlowNode),
      title: typeof n.title === 'string' ? n.title : 'Block',
      x: Number.isFinite(n.x) ? (n.x as number) : 0,
      y: Number.isFinite(n.y) ? (n.y as number) : 0,
      status: 'idle',
      history: []
    })
  }
  const ids = new Set(nodes.map((n) => n.id))
  const connections: FlowConnection[] = (
    Array.isArray(raw.connections) ? (raw.connections as Partial<FlowConnection>[]) : []
  )
    .filter((c) => c && typeof c.fromId === 'string' && typeof c.toId === 'string')
    .filter((c) => ids.has(c.fromId as string) && ids.has(c.toId as string))
    .map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `conn_${i}`,
      fromId: c.fromId as string,
      toId: c.toId as string,
      fromPort: typeof c.fromPort === 'string' ? c.fromPort : undefined,
      toPort: typeof c.toPort === 'string' ? c.toPort : undefined,
      kind: c.kind === 'dotted' ? 'dotted' : 'solid'
    }))
  return { nodes, connections }
}

/** Re-id the nodes/connections of an imported graph so it can be merged into an existing one. */
export function remapFlowGraphIds(graph: FlowGraph, offsetX = 0, offsetY = 0): FlowGraph {
  const stamp = Date.now().toString(36)
  const idMap = new Map<string, string>()
  const nodes = graph.nodes.map((n, i) => {
    const id = `node_${stamp}_${i}_${Math.random().toString(36).slice(2, 5)}`
    idMap.set(n.id, id)
    return { ...n, id, x: n.x + offsetX, y: n.y + offsetY }
  })
  const connections = graph.connections.map((c, i) => ({
    ...c,
    id: `conn_${stamp}_${i}`,
    fromId: idMap.get(c.fromId) as string,
    toId: idMap.get(c.toId) as string
  }))
  return { nodes, connections }
}
