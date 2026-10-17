/**
 * Bridge between Svelte-JSONEditor Web App and the Browser Extension
 * Supports Chrome, Edge and Firefox.
 */

export interface ExtensionStatus {
  isInstalled: boolean
  version?: string
  globalPaused?: boolean
  groups?: Array<{ groupId: string; name: string; paused: boolean }>
}

interface ExtRuntimeApi {
  runtime?: {
    sendMessage: (
      message: unknown,
      callback?: (response: { success?: boolean; version?: string }) => void
    ) => void
  }
}

const EXTENSION_ENABLED_KEY = 'svelte_jsoneditor_p2p_extension_relay_enabled'

export class ExtensionBridge {
  private static extensionId = 'p2p-swarm-relay@svelte-jsoneditor.local'

  /**
   * Returns whether the user has opted-in to use the background extension relay.
   * Default: FALSE (as explicitly required by user).
   */
  public static isRelayEnabled(): boolean {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(EXTENSION_ENABLED_KEY) === 'true'
  }

  public static setRelayEnabled(enabled: boolean): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(EXTENSION_ENABLED_KEY, enabled ? 'true' : 'false')
  }

  /**
   * Checks if the extension is currently installed and responding in the browser.
   */
  public static async checkInstalled(): Promise<ExtensionStatus> {
    const win =
      typeof window !== 'undefined'
        ? (window as unknown as { browser?: ExtRuntimeApi; chrome?: ExtRuntimeApi })
        : null
    const extApi: ExtRuntimeApi | null = win?.browser || win?.chrome || null

    if (!extApi?.runtime?.sendMessage) {
      return { isInstalled: false }
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ isInstalled: false })
      }, 600)

      try {
        extApi.runtime!.sendMessage({ action: 'PING_EXTENSION' }, (response) => {
          clearTimeout(timeout)
          if (response && response.success) {
            resolve({
              isInstalled: true,
              version: response.version
            })
          } else {
            resolve({ isInstalled: false })
          }
        })
      } catch {
        clearTimeout(timeout)
        resolve({ isInstalled: false })
      }
    })
  }

  /**
   * Automatically registers an active group with the extension so it acts as a background bridge.
   */
  public static async registerGroup(
    groupId: string,
    name: string,
    folderId?: number | string
  ): Promise<boolean> {
    const win =
      typeof window !== 'undefined'
        ? (window as unknown as { browser?: ExtRuntimeApi; chrome?: ExtRuntimeApi })
        : null
    const extApi: ExtRuntimeApi | null = win?.browser || win?.chrome || null

    if (!extApi?.runtime?.sendMessage) return false

    return new Promise((resolve) => {
      try {
        extApi.runtime!.sendMessage(
          { action: 'REGISTER_GROUP', groupId, name, folderId },
          (response) => {
            resolve(!!response?.success)
          }
        )
      } catch {
        resolve(false)
      }
    })
  }
}
