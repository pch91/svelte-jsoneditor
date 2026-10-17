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

export type MergePayloadMode = 'pass-active' | 'combine' | 'append' | 'structured'

export interface FlowNodeMergeData {
  strategy: 'wait-all' | 'first-completed' | 'combine'
  payloadMode?: MergePayloadMode
  inputs?: FlowNodePort[]
  status?: 'future'
}

export type FlowNodeExecutionStatus =
  | 'idle'
  | 'waiting'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped'

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
  returnValue?: unknown
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
    const ret = fn(
      pm,
      envHelper,
      globalsHelper,
      mockConsole,
      routeHelper,
      outHelper,
      options?.payload ?? null
    )
    return {
      success: true,
      updatedEnv: currentEnv,
      updatedGlobalEnv: currentGlobals,
      logs,
      activePorts,
      portPayloads,
      returnValue: ret
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
  const parts = cleanPath
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
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

function evaluateJsonPathRule(
  rule: FlowNodeRouterRule,
  payload: unknown,
  env?: Record<string, unknown>
): boolean {
  if (!rule.path) return false
  let actual = extractJsonValue(payload, rule.path)
  if (actual === undefined && env && typeof env === 'object') {
    actual = extractJsonValue(env, rule.path)
    if (actual === undefined && rule.path in env) {
      actual = env[rule.path]
    }
  }
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
  status: number = 200,
  env?: Record<string, unknown>
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
      isMatch = evaluateJsonPathRule(rule, payload, env)
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
/**
 * Advanced Rick & Morty batch processing workflow utilizing ALL 11 node components:
 *
 * 1. Start Flow initializes execution.
 * 2. REST "Fetch Characters Batch" queries /character?page=1 and extracts results array.
 * 3. Loop "Iterate Characters" runs for-each on the results array (max 3 items),
 *    injecting character, charIdx, and loop stats on every iteration.
 * 4. Loop Body (item port):
 *    - Delay "Rate Throttle" pauses 300ms to respect API rate limits.
 *    - JS Script "Process & Accumulate" reads pm.environment.get('character') & pm.environment.get('charIdx'),
 *      logs progress, accumulates into processedHeroes JSON array, and updates lastHeroStatus.
 * 5. Loop Completion (done port):
 *    - Gateway Router evaluates lastHeroStatus:
 *      * Alive -> Maps Hero Profile via JSON Mapper (transform).
 *      * Dead/Other -> Logs incident via JS Script (audit).
 * 6. Merge Synchronizer joins both branches cleanly using dead-path elimination.
 * 7. Event Throw dispatches 'pipeline_complete' telemetry.
 * 8. Event Catch receives 'pipeline_complete' in parallel swimlane.
 * 9. Terminate successfully closes the workflow.
 */
export function createAdvancedFlowGraph(): FlowGraph {
  return {
    nodes: [
      {
        id: 'node_start',
        type: 'start',
        title: 'Start Pipeline',
        x: 60,
        y: 155,
        status: 'idle'
      },
      {
        id: 'node_fetch_batch',
        type: 'rest',
        title: '1. Fetch Characters Batch',
        x: 180,
        y: 120,
        restData: {
          method: 'GET',
          url: '{{baseUrl}}/character?page=1',
          headers: '',
          body: '',
          bodyType: 'none',
          proxyMode: 'inherit',
          authType: 'inherit',
          captures: [
            { path: 'info.count', name: 'totalCharacters', enabled: true },
            { path: 'results[0].name', name: 'leadHeroName', enabled: true }
          ]
        },
        status: 'idle'
      },
      {
        id: 'node_loop',
        type: 'loop',
        title: '2. Iterate Characters',
        x: 530,
        y: 155,
        loopData: {
          mode: 'for-each',
          arrayPath: 'results',
          itemVar: 'character',
          indexVar: 'charIdx',
          maxIterations: 3,
          delayMs: 250
        },
        status: 'idle'
      },

      // --- LOOP BODY: THROTTLE & PER-ITERATION ACCUMULATION ---
      {
        id: 'node_loop_delay',
        type: 'delay',
        title: '3a. Rate Throttle (300ms)',
        x: 760,
        y: 40,
        delayData: {
          mode: 'delay',
          delayMs: 300,
          ratePerSecond: 10
        },
        status: 'idle'
      },
      {
        id: 'node_loop_process',
        type: 'js',
        title: '3b. Process & Accumulate',
        x: 980,
        y: 20,
        jsData: {
          code: `// Access loop iteration variables: character (JSON string), charIdx, loop_total
const rawChar = pm.environment.get('character');
const char = typeof rawChar === 'string' && rawChar.startsWith('{') ? JSON.parse(rawChar) : {};
const idx = Number(pm.environment.get('charIdx') || 0);
const total = pm.environment.get('loop_total') || '3';

console.log(\`[Batch #\${idx + 1}/\${total}] Character: \${char.name || 'Unknown'} (\${char.species || 'Human'}) - \${char.status || 'Alive'}\`);

// Accumulate character into environment array for downstream reporting
let processed = [];
try {
  processed = JSON.parse(pm.environment.get('processedHeroes') || '[]');
} catch (e) {
  processed = [];
}
processed.push({ id: char.id, name: char.name, status: char.status, species: char.species });
pm.environment.set('processedHeroes', JSON.stringify(processed));

// Forward latest processed character info to environment
pm.environment.set('lastHeroName', char.name || '');
pm.environment.set('lastHeroStatus', char.status || 'Alive');
pm.environment.set('lastHeroSpecies', char.species || 'Human');`
        },
        status: 'idle'
      },

      // --- POST-LOOP: ROUTE BY STATUS ---
      {
        id: 'node_router',
        type: 'router',
        title: '4. Route by Status',
        x: 760,
        y: 220,
        routerData: {
          mode: 'first-match',
          ports: [
            {
              id: 'port_alive',
              label: 'Alive Character',
              slot: 'top',
              slotIndex: 1,
              color: '#10b981'
            },
            {
              id: 'port_dead',
              label: 'Dead / Other',
              slot: 'bottom',
              slotIndex: 3,
              color: '#ef4444'
            }
          ],
          rules: [
            {
              id: 'rule_alive',
              portId: 'port_alive',
              label: 'Status is Alive',
              type: 'jsonpath',
              path: 'lastHeroStatus',
              operator: '==',
              value: 'Alive'
            },
            {
              id: 'rule_fallback',
              portId: 'port_dead',
              label: 'Other / Fallback',
              type: 'otherwise'
            }
          ]
        },
        status: 'idle'
      },

      // --- ALIVE BRANCH: JSON SCHEMA MAPPER ---
      {
        id: 'node_transform',
        type: 'transform',
        title: '5a. Map Hero Profile',
        x: 980,
        y: 200,
        transformData: {
          mappings: [
            {
              id: 'm1',
              sourcePath: 'lastHeroName',
              targetPath: 'hero.name',
              modifier: 'uppercase'
            },
            {
              id: 'm2',
              sourcePath: 'lastHeroStatus',
              targetPath: 'hero.status',
              modifier: 'lowercase'
            },
            {
              id: 'm3',
              sourcePath: 'lastHeroSpecies',
              targetPath: 'hero.species',
              modifier: 'trim'
            }
          ],
          saveToEnvVar: 'heroProfile'
        },
        status: 'idle'
      },

      // --- FALLBACK / DEAD BRANCH: AUDIT RECORD ---
      {
        id: 'node_js_audit',
        type: 'js',
        title: '5b. Archive & Audit Log',
        x: 980,
        y: 310,
        jsData: {
          code: `// Audit fallback / deceased branch
const name = pm.environment.get('lastHeroName') || 'Unknown';
const status = pm.environment.get('lastHeroStatus') || 'Dead';
console.warn(\`[AUDIT] Hero \${name} has status: \${status}. Recording incident log.\`);
pm.environment.set('incidentReport', \`Hero \${name} flagged as \${status}\`);`
        },
        status: 'idle'
      },

      // --- BRANCH CONVERGENCE: SYNCHRONIZER / MERGE ---
      {
        id: 'node_merge',
        type: 'merge',
        title: '6. Synchronize Branches',
        x: 1330,
        y: 240,
        mergeData: {
          strategy: 'wait-all',
          payloadMode: 'pass-active',
          inputs: [
            { id: 'in_1', label: 'Alive Stream', slot: 'top', color: '#10b981' },
            { id: 'in_2', label: 'Incident Stream', slot: 'bottom', color: '#ef4444' }
          ]
        },
        status: 'idle'
      },

      // --- TELEMETRY DISPATCH (EVENT THROW) ---
      {
        id: 'node_throw',
        type: 'event-throw',
        title: '7. Dispatch Telemetry',
        x: 1560,
        y: 245,
        eventData: { eventName: 'pipeline_complete' },
        status: 'idle'
      },

      // --- PARALLEL SWIMLANE: TELEMETRY RECEIVER -> TERMINATE ---
      {
        id: 'node_catch',
        type: 'event-catch',
        title: '8. Telemetry Receiver',
        x: 60,
        y: 460,
        eventData: { eventName: 'pipeline_complete' },
        status: 'idle'
      },
      {
        id: 'node_terminate',
        type: 'terminate',
        title: '9. Workflow Complete',
        x: 190,
        y: 460,
        status: 'idle'
      }
    ],
    connections: [
      { id: 'c_start_fetch', fromId: 'node_start', toId: 'node_fetch_batch', kind: 'solid' },
      { id: 'c_fetch_loop', fromId: 'node_fetch_batch', toId: 'node_loop', kind: 'solid' },

      // Loop body connections (item port -> throttle -> process):
      {
        id: 'c_loop_delay',
        fromId: 'node_loop',
        toId: 'node_loop_delay',
        fromPort: 'item',
        kind: 'solid'
      },
      {
        id: 'c_delay_js',
        fromId: 'node_loop_delay',
        toId: 'node_loop_process',
        kind: 'solid'
      },

      // Loop completion connection (done port -> router):
      {
        id: 'c_loop_router',
        fromId: 'node_loop',
        toId: 'node_router',
        fromPort: 'done',
        kind: 'solid'
      },

      // Router branch connections:
      {
        id: 'c_router_alive',
        fromId: 'node_router',
        toId: 'node_transform',
        fromPort: 'port_alive',
        kind: 'solid'
      },
      {
        id: 'c_router_dead',
        fromId: 'node_router',
        toId: 'node_js_audit',
        fromPort: 'port_dead',
        kind: 'solid'
      },

      // Convergence connections to Merge inputs:
      {
        id: 'c_alive_merge',
        fromId: 'node_transform',
        toId: 'node_merge',
        toPort: 'in_1',
        kind: 'solid'
      },
      {
        id: 'c_dead_merge',
        fromId: 'node_js_audit',
        toId: 'node_merge',
        toPort: 'in_2',
        kind: 'solid'
      },

      // Merge output to Event Throw:
      {
        id: 'c_merge_throw',
        fromId: 'node_merge',
        toId: 'node_throw',
        fromPort: 'joined',
        kind: 'solid'
      },

      // Receiver to Terminate in parallel swimlane:
      { id: 'c_catch_term', fromId: 'node_catch', toId: 'node_terminate', kind: 'solid' }
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
