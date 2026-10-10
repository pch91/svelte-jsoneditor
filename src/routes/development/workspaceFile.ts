/**
 * Workspace file (".jsew" = JSON Editor Workspace).
 *
 * A single portable file that contains the whole Level 1 workspace (primary tabs,
 * sub-tabs and their documents, request forms, split layout), plus the Spatial Flow
 * graph and the environments. It is plain JSON so it can be diffed and versioned.
 */

import { parseFlowFile, serializeFlowFile } from './flowTypes.js'
import type { FlowGraph } from './flowTypes.js'
import type { StoredWorkspace } from './workspaceStorage.js'

export const WORKSPACE_FILE_FORMAT = 'svelte-jsoneditor-workspace'
export const WORKSPACE_FILE_VERSION = 1
export const WORKSPACE_FILE_EXT = '.jsew'

export interface WorkspaceBundle {
  workspace: StoredWorkspace
  flowGraph?: FlowGraph
  environments?: Record<string, Record<string, string>>
  globalEnvironment?: Record<string, string>
  activeEnvName?: string
}

export function serializeWorkspaceFile(bundle: WorkspaceBundle): string {
  return JSON.stringify(
    {
      format: WORKSPACE_FILE_FORMAT,
      version: WORKSPACE_FILE_VERSION,
      savedAt: new Date().toISOString(),
      workspace: bundle.workspace,
      flow: bundle.flowGraph ? JSON.parse(serializeFlowFile(bundle.flowGraph)).graph : undefined,
      environments: bundle.environments ?? {},
      globalEnvironment: bundle.globalEnvironment ?? {},
      activeEnvName: bundle.activeEnvName ?? ''
    },
    null,
    2
  )
}

/** Parse and validate a workspace file. Throws an Error with a readable message when invalid. */
export function parseWorkspaceFile(text: string): WorkspaceBundle {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }
  if (!data || typeof data !== 'object' || data.format !== WORKSPACE_FILE_FORMAT) {
    throw new Error('Not a workspace file (.jsew)')
  }
  const ws = data.workspace as StoredWorkspace | undefined
  if (!ws || !Array.isArray(ws.tabs) || ws.tabs.length === 0) {
    throw new Error('Workspace file has no tabs')
  }
  for (const t of ws.tabs) {
    if (typeof t?.id !== 'number' || typeof t.title !== 'string' || typeof t.text !== 'string') {
      throw new Error('Workspace file contains an invalid tab')
    }
  }
  if (typeof ws.nextTabId !== 'number') {
    ws.nextTabId = Math.max(...ws.tabs.map((t) => t.id)) + 1
  }
  const bundle: WorkspaceBundle = { workspace: ws }
  if (data.flow) {
    bundle.flowGraph = parseFlowFile(JSON.stringify(data.flow))
  }
  if (data.environments && typeof data.environments === 'object') {
    bundle.environments = data.environments as Record<string, Record<string, string>>
  }
  if (data.globalEnvironment && typeof data.globalEnvironment === 'object') {
    bundle.globalEnvironment = data.globalEnvironment as Record<string, string>
  }
  if (typeof data.activeEnvName === 'string') {
    bundle.activeEnvName = data.activeEnvName
  }
  return bundle
}
