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
  visionStatus: 'visionStatus',
  sessionImages: 'sessionImages',
  clearImages: 'clearImages',
} as const

/** One dictionary entry rendered as a chip on the settings page. */
export interface SightDictionaryEntry {
  readonly family: string
  readonly label: string
}

/** One provider/model row on the settings page. */
export interface SightModelEntry {
  readonly id: string
  readonly name: string
  readonly vision: boolean
  readonly declared: boolean
  readonly matched: string | null
  readonly source: string
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
