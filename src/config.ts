/**
 * Shared wire vocabulary between the Host and browser halves: the loopback
 * RPC channel, its endpoints, and the plain-JSON request/result types.
 * @module dsh-sight/config
 */

/** Dedicated, loopback-only RPC channel registered by the Host half. */
export const SIGHT_RPC_CHANNEL = '/sight'

/** Endpoints accepted by {@link SIGHT_RPC_CHANNEL}. */
export const SIGHT_RPC = {
  status: 'status',
  setVision: 'setVision',
  applyDictionary: 'applyDictionary',
  applyReasoning: 'applyReasoning',
  visionStatus: 'visionStatus',
  sessionImages: 'sessionImages',
  clearImages: 'clearImages',
  figmaMcpStatus: 'figmaMcpStatus',
  figmaMcpApply: 'figmaMcpApply',
  figmaMcpRemove: 'figmaMcpRemove',
} as const

/** One dictionary entry rendered as a chip on the settings page. */
export interface SightDictionaryEntry {
  readonly family: string
  readonly label: string
}

/** One reasoning-effort dictionary entry rendered as a chip on the settings page. */
export interface SightReasoningDictionaryEntry {
  readonly family: string
  readonly label: string
  readonly efforts: readonly { readonly level: string; readonly wire: string }[]
}

/** One provider/model row on the settings page. */
export interface SightModelEntry {
  readonly id: string
  readonly name: string
  readonly vision: boolean
  readonly declared: boolean
  readonly matched: string | null
  readonly source: string
  /**
   * Reasoning-effort levels this model actually exposes, and where they came
   * from: `adapter` = resolved from the installed adapter/catalog (e.g. the
   * official DeepSeek channel always carries off/high/max); `declared` = from a
   * `reasoningEfforts` map written in the pi-ai settings. `null` when the model
   * exposes no reasoning levels at all.
   */
  readonly reasoning: { readonly source: 'adapter' | 'declared'; readonly levels: readonly string[] } | null
}

/** One configured pi-ai provider group on the settings page. */
export interface SightProviderEntry {
  readonly provider: string
  readonly name: string
  readonly models: readonly SightModelEntry[]
  readonly error: string | null
}

/** Result of {@link SIGHT_RPC.status}. */
export interface SightStatusResult {
  readonly namespace: string
  readonly dictionary: readonly SightDictionaryEntry[]
  readonly reasoningDictionary: readonly SightReasoningDictionaryEntry[]
  readonly providers: readonly SightProviderEntry[]
}

/** Result of {@link SIGHT_RPC.setVision}. */
export interface SightSetVisionResult {
  readonly ok: boolean
}

/** Result of {@link SIGHT_RPC.applyDictionary}. */
export interface SightApplyDictionaryResult {
  readonly applied: number
  readonly providers: number
}

/** One model whose reasoning-effort map was written by {@link SIGHT_RPC.applyReasoning}. */
export interface SightReasoningChange {
  readonly provider: string
  readonly model: string
  readonly family: string
  readonly efforts: readonly { readonly level: string; readonly wire: string }[]
}

/** Result of {@link SIGHT_RPC.applyReasoning}. */
export interface SightApplyReasoningResult {
  readonly applied: number
  readonly providers: number
  readonly changes: readonly SightReasoningChange[]
}

/** Result of {@link SIGHT_RPC.visionStatus} (composer badge). */
export interface SightVisionStatusResult {
  readonly vision: boolean
  readonly source: string
  readonly matched: string | null
}

/** Result of {@link SIGHT_RPC.sessionImages}. */
export interface SightSessionImagesResult {
  readonly count: number
}

/** One per-node replacement failure reported by {@link SIGHT_RPC.clearImages}. */
export interface SightClearFailure {
  readonly seq: number
  readonly error: string
}

/** Result of {@link SIGHT_RPC.clearImages}. */
export interface SightClearImagesResult {
  readonly cleared: number
  readonly total: number
  readonly failures: readonly SightClearFailure[]
}

/**
 * Status of the Figma MCP bridge on the settings page. The raw Figma token is
 * never echoed back to the browser — only whether one is already configured.
 */
export interface SightFigmaMcpStatusResult {
  /** Whether the current profile's `cordis.patch.yml` declares a Figma MCP row. */
  readonly configured: boolean
  /** The `cordis.patch.yml` absolute path (for the "restart to apply" hint). */
  readonly patchPath: string
  /** Profile name the patch belongs to (e.g. `desktop`). */
  readonly profile: string
  /** Whether a Figma token is present in the current configuration. */
  readonly hasToken: boolean
  /** Proxy URL in use, or null. */
  readonly proxy: string | null
  /** The command line that would run the Figma MCP server (sans token), or null. */
  readonly command: string | null
  /** Any error reading the patch file (e.g. parse failure). */
  readonly error: string | null
}

/** Request payload for {@link SIGHT_RPC.figmaMcpApply}. */
export interface SightFigmaMcpApplyRequest {
  /** Figma Personal Access Token (required). */
  readonly token: string
  /** Optional proxy URL (e.g. `http://127.0.0.1:7897`) for restricted networks. */
  readonly proxy?: string
}

/** Result of {@link SIGHT_RPC.figmaMcpApply} / {@link SIGHT_RPC.figmaMcpRemove}. */
export interface SightFigmaMcpWriteResult {
  readonly ok: boolean
  readonly patchPath: string
  readonly error: string | null
}
