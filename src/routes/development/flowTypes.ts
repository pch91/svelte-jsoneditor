import type { CaptureRule } from './tabUtils.js'
import type { HeaderRow, QueryParam } from './requestsUtils.js'

export type FlowNodeType = 'rest' | 'js' | 'start' | 'terminate' | 'event-throw' | 'event-catch'

export interface FlowNodeEventData {
  eventName: string
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
}

export type FlowNodeExecutionStatus = 'idle' | 'waiting' | 'running' | 'success' | 'error'

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
  kind: ConnectionKind // 'solid' = espera todos executarem (join); 'dotted' = não espera (assíncrono)
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
  initialGlobalEnv: Record<string, string> = {}
): {
  success: boolean
  updatedEnv: Record<string, string>
  updatedGlobalEnv: Record<string, string>
  logs: string[]
  error?: string
} {
  const currentEnv = { ...initialEnv }
  const currentGlobals = { ...initialGlobalEnv }
  const logs: string[] = []

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

  try {
    const fn = new Function('pm', 'env', 'globals', 'console', `"use strict";\n${code}`)
    fn(pm, envHelper, globalsHelper, mockConsole)
    return {
      success: true,
      updatedEnv: currentEnv,
      updatedGlobalEnv: currentGlobals,
      logs
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logs.push(`[ERRO] ${msg}`)
    return {
      success: false,
      updatedEnv: currentEnv,
      updatedGlobalEnv: currentGlobals,
      logs,
      error: msg
    }
  }
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
      title: `Passo ${index + 1} (${item.method ?? 'GET'})`,
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
 * 1. Start node (Bola Verde)
 * 2. REST: GET character 1 -> captures charId, charStatus, charName
 * 3. JS: Script with if condition, reading and writing environment variables
 * 4. Event Throw (Bola Azul Cheia): broadcast "valida total"
 * 5. Event Catch (Bola Azul Pontilhada): catch "valida total"
 * 6. REST: GET episode with {{charId}} -> captures episodeName
 * 7. Terminate (Bola Vermelha): halts execution
 */
export function createDefaultFlowGraph(): FlowGraph {
  return {
    nodes: [
      {
        id: 'node_start',
        type: 'start',
        title: 'Início',
        x: 60,
        y: 123,
        status: 'idle'
      },
      {
        id: 'node_1',
        type: 'rest',
        title: '1. Buscar Personagem',
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
        title: '2. Script de Validação',
        x: 490,
        y: 80,
        jsData: {
          code: `// Obtém variáveis capturadas do passo anterior
const charId = pm.environment.get("charId");
const charName = pm.environment.get("charName") || "Rick Sanchez";
const charStatus = pm.environment.get("charStatus") || "Alive";

console.log(\`Personagem: \${charName} (ID: \${charId}), Status: \${charStatus}\`);

// Validação condicional com IF e atualização de ambiente
if (charStatus === "Alive" && Number(charId) > 0) {
  console.log("Validação aprovada: Personagem ativo e válido!");
  pm.environment.set("isValidCharacter", "true");
  pm.environment.set("customHeader", "RickMorty-Verified");
  pm.environment.set("charIdTimesTwo", Number(charId || 1) * 2);
} else {
  console.warn("Validação alternativa acionada para fallback");
  pm.environment.set("isValidCharacter", "false");
  pm.environment.set("customHeader", "RickMorty-Fallback");
}

console.log("Variáveis de ambiente atualizadas com sucesso!");`
        },
        status: 'idle'
      },
      {
        id: 'node_event_throw',
        type: 'event-throw',
        title: 'Salto: valida total',
        eventData: { eventName: 'valida total' },
        x: 820,
        y: 123,
        status: 'idle'
      },
      {
        id: 'node_event_catch',
        type: 'event-catch',
        title: 'Receptor: valida total',
        eventData: { eventName: 'valida total' },
        x: 60,
        y: 303,
        status: 'idle'
      },
      {
        id: 'node_3',
        type: 'rest',
        title: '3. Buscar Episódio',
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
        title: 'Fim do Fluxo',
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
