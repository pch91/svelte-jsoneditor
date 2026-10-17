import type { FlowNodeType, FlowNode, FlowNodePort } from './flowTypes.js'
import { createDefaultRouterPorts, createDefaultRouterRules } from './flowTypes.js'

export type FlowCategory = 'network' | 'transform' | 'compute' | 'control' | 'events'

export interface FlowNodeVariantDef {
  type: FlowNodeType
  category: FlowCategory
  label: string
  icon: string
  accent: string
  defaultTitle: string
  status: 'stable' | 'future'
  height: number
  createData(): Partial<FlowNode>
  getOutputPorts(node: FlowNode): FlowNodePort[]
  getInputPorts(node: FlowNode): FlowNodePort[]
}

export const FLOW_NODE_REGISTRY: Record<FlowNodeType, FlowNodeVariantDef> = {
  // --- 🌐 API & Network (Action Heart) ---
  rest: {
    type: 'rest',
    category: 'network',
    label: 'REST Block',
    icon: '🌐',
    accent: '#3883fa',
    defaultTitle: 'HTTP Request',
    status: 'stable',
    height: 124,
    createData: () => ({
      restData: {
        method: 'GET',
        url: 'https://rickandmortyapi.com/api/character/1',
        headers: '',
        headerRows: [],
        queryParams: [],
        body: '',
        bodyType: 'none',
        captures: []
      }
    }),
    getOutputPorts: () => [{ id: 'out', label: 'Response', slot: 'middle', color: '#3883fa' }],
    getInputPorts: () => [{ id: 'in', label: 'Input', slot: 'middle', color: '#3883fa' }]
  },

  // --- ⚡ Compute & Code ---
  js: {
    type: 'js',
    category: 'compute',
    label: 'JS Script',
    icon: '⚡',
    accent: '#a855f7',
    defaultTitle: 'Run JS Script',
    status: 'stable',
    height: 110,
    createData: () => ({
      jsData: {
        code: '// JavaScript Code\n// Access variables via pm.environment.get("key")\n// Use route("portId") or out("portId", data) for multi-port routing\n',
        ports: []
      }
    }),
    getOutputPorts: (node) => {
      if (node.jsData?.ports && node.jsData.ports.length > 0) {
        return node.jsData.ports
      }
      return [{ id: 'out', label: 'Default Out', slot: 'middle', slotIndex: 1, color: '#a855f7' }]
    },
    getInputPorts: () => [{ id: 'in', label: 'Input', slot: 'middle', color: '#a855f7' }]
  },

  // --- 🔄 Data Transformation (JSON Mapper & Merge) ---
  transform: {
    type: 'transform',
    category: 'transform',
    label: 'JSON Mapper',
    icon: '🔄',
    accent: '#06b6d4',
    defaultTitle: 'JSON Schema Mapper',
    status: 'stable',
    height: 60,
    createData: () => ({
      transformData: {
        sampleInput: '{\n  "id": 1,\n  "name": "Sample"\n}',
        mappings: []
      }
    }),
    getOutputPorts: () => [
      { id: 'out', label: 'Mapped Out', slot: 'middle', slotIndex: 1, color: '#06b6d4' }
    ],
    getInputPorts: () => [{ id: 'in', label: 'Input', slot: 'middle', color: '#06b6d4' }]
  },

  merge: {
    type: 'merge',
    category: 'transform',
    label: 'Merge / Join',
    icon: '🔗',
    accent: '#8b5cf6',
    defaultTitle: 'Branch Synchronizer',
    status: 'future',
    height: 60,
    createData: () => ({
      mergeData: {
        strategy: 'wait-all',
        payloadMode: 'pass-active',
        inputs: [
          { id: 'in_1', label: 'Branch 1', slot: 'middle', color: '#8b5cf6' },
          { id: 'in_2', label: 'Branch 2', slot: 'middle', color: '#8b5cf6' }
        ]
      }
    }),
    getOutputPorts: () => [
      { id: 'joined', label: 'Merged Output', slot: 'middle', slotIndex: 1, color: '#8b5cf6' },
      { id: 'timeout', label: 'Timeout Fallback', slot: 'bottom', slotIndex: 3, color: '#ef4444' }
    ],
    getInputPorts: (node) => {
      if (node.mergeData?.inputs && node.mergeData.inputs.length > 0) {
        return node.mergeData.inputs
      }
      return [
        { id: 'in_1', label: 'Branch 1', slot: 'middle', color: '#8b5cf6' },
        { id: 'in_2', label: 'Branch 2', slot: 'middle', color: '#8b5cf6' }
      ]
    }
  },

  // --- 🔀 Flow Control (Decisions & Loops & Delay) ---
  router: {
    type: 'router',
    category: 'control',
    label: 'Router Block',
    icon: '🔀',
    accent: '#f59e0b',
    defaultTitle: 'Gateway Router',
    status: 'stable',
    height: 130,
    createData: () => ({
      routerData: {
        mode: 'first-match',
        ports: createDefaultRouterPorts(),
        rules: createDefaultRouterRules()
      }
    }),
    getOutputPorts: (node) => {
      if (node.routerData?.ports && node.routerData.ports.length > 0) {
        return node.routerData.ports
      }
      return createDefaultRouterPorts()
    },
    getInputPorts: () => [{ id: 'in', label: 'Input', slot: 'middle', color: '#f59e0b' }]
  },

  loop: {
    type: 'loop',
    category: 'control',
    label: 'Loop / Iterator',
    icon: '🔁',
    accent: '#6366f1',
    defaultTitle: 'Iterator Loop',
    status: 'future',
    height: 48,
    createData: () => ({
      loopData: {
        arrayPath: 'items',
        itemVar: 'item',
        maxIterations: 1000,
        status: 'future'
      }
    }),
    getOutputPorts: () => [
      { id: 'item', label: 'Item Body', slot: 'middle', slotIndex: 1, color: '#6366f1' },
      { id: 'done', label: 'Done (Completed)', slot: 'bottom', slotIndex: 3, color: '#10b981' }
    ],
    getInputPorts: () => [{ id: 'in', label: 'Input', slot: 'middle', color: '#6366f1' }]
  },

  delay: {
    type: 'delay',
    category: 'control',
    label: 'Delay / Throttle',
    icon: '⏳',
    accent: '#10b981',
    defaultTitle: 'Time Pause & Throttle',
    status: 'future',
    height: 48,
    createData: () => ({
      delayData: {
        mode: 'delay',
        delayMs: 1500,
        ratePerSecond: 10,
        status: 'future'
      }
    }),
    getOutputPorts: () => [
      { id: 'out', label: 'Proceed (Out)', slot: 'middle', slotIndex: 1, color: '#10b981' },
      {
        id: 'dropped',
        label: 'Dropped (Queue Overflow)',
        slot: 'bottom',
        slotIndex: 3,
        color: '#ef4444'
      }
    ],
    getInputPorts: () => [{ id: 'in', label: 'Input', slot: 'middle', color: '#10b981' }]
  },

  // --- ⭕ Events (BPMN Circles) ---
  start: {
    type: 'start',
    category: 'events',
    label: 'Start Event',
    icon: '▶',
    accent: '#10b981',
    defaultTitle: 'Start',
    status: 'stable',
    height: 50,
    createData: () => ({}),
    getOutputPorts: () => [{ id: 'out', label: 'Start Flow', slot: 'middle', color: '#10b981' }],
    getInputPorts: () => []
  },

  terminate: {
    type: 'terminate',
    category: 'events',
    label: 'Terminate Event',
    icon: '⏹',
    accent: '#ef4444',
    defaultTitle: 'Terminate',
    status: 'stable',
    height: 50,
    createData: () => ({}),
    getOutputPorts: () => [],
    getInputPorts: () => [{ id: 'in', label: 'Terminate Flow', slot: 'middle', color: '#ef4444' }]
  },

  'event-throw': {
    type: 'event-throw',
    category: 'events',
    label: 'Event Throw (Jump)',
    icon: '📡',
    accent: '#3883fa',
    defaultTitle: 'Jump',
    status: 'stable',
    height: 50,
    createData: () => ({
      eventData: { eventName: 'custom-event' }
    }),
    getOutputPorts: () => [{ id: 'out', label: 'Jump Out', slot: 'middle', color: '#3883fa' }],
    getInputPorts: () => [{ id: 'in', label: 'Jump In', slot: 'middle', color: '#3883fa' }]
  },

  'event-catch': {
    type: 'event-catch',
    category: 'events',
    label: 'Event Catch (Receiver)',
    icon: '🎯',
    accent: '#3883fa',
    defaultTitle: 'Receiver',
    status: 'stable',
    height: 50,
    createData: () => ({
      eventData: { eventName: 'custom-event' }
    }),
    getOutputPorts: () => [{ id: 'out', label: 'Receiver Out', slot: 'middle', color: '#3883fa' }],
    getInputPorts: () => [{ id: 'in', label: 'Receiver In', slot: 'middle', color: '#3883fa' }]
  }
}

/** Get all variant definitions for a given category */
export function variantsOf(category: FlowCategory): FlowNodeVariantDef[] {
  return Object.values(FLOW_NODE_REGISTRY).filter((v) => v.category === category)
}

/** Find the category of a node type */
export function categoryOf(type: FlowNodeType): FlowCategory {
  return FLOW_NODE_REGISTRY[type]?.category ?? 'network'
}
