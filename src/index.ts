/**
 * dsh-sight Host half: registers the `/sight` loopback RPC channel and serves
 * the Sight endpoints. Plain cordis plugin (no typert, no Remote
 * descriptors) - the community-standard pattern for standalone dsh plugins.
 *
 * Endpoints:
 * - `status`          -> provider/model overview for the settings page
 * - `applyReasoning`  -> bulk-fill `reasoningEfforts` from the reasoning dictionary
 * - `figmaMcpStatus`  -> Figma MCP bridge state in the active profile patch
 * - `figmaMcpApply`   -> add or reconfigure one Figma MCP row
 * - `figmaMcpRemove`  -> remove one Figma MCP row
 * - `repoDirList`     -> host-side directory listing for the figwright repo picker
 * - `figwrightPluginUpdate` -> refresh the locally extracted Figwright plugin
 * - `bridgePluginUpdate`    -> rebuild the patched Figma UI MCP Bridge plugin copy
 * @module dsh-sight
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as figwrightInstall from './figma-plugin-install.ts'
import * as bridgePluginInstall from './figma-bridge-plugin.ts'
import * as bridgeServerInstall from './figma-ui-server-patch.ts'
import { reasoningDictionaryEntries, reasoningFamilyOf, decideReasoningFill, describePiAiModelReasoning } from './reasoning-dictionary.ts'
import {
  classifyDeclarationNotApplied,
  classifyImageProbeFailure,
  classifyImageProbeSuccess,
  classifyImageProbeUnsendable,
  PROBE_IMAGE_MEDIA_TYPE,
  PROBE_IMAGE_PNG_BASE64,
  PROBE_MAX_TOKENS,
  PROBE_PROMPT_TEXT,
} from './image-probe.ts'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  SIGHT_RPC,
  SIGHT_RPC_CHANNEL,
  type SightApplyReasoningResult,
  type SightBridgePluginInfo,
  type SightBridgePluginUpdateResult,
  type SightBridgeServerInfo,
  type SightDirListing,
  type SightFigmaMcpApplyRequest,
  type SightFigmaMcpRemoveRequest,
  type SightFigmaMcpStatusResult,
  type SightFigmaMcpWriteResult,
  type SightFigwrightPluginInfo,
  type SightFigwrightPluginUpdateResult,
  type SightImageProbeRequest,
  type SightImageProbeResult,
  type SightImageSupportRequest,
  type SightModelEntry,
  type SightProviderEntry,
  type SightReadBackend,
  type SightReasoningChange,
  type SightReasoningFailure,
  type SightReasoningClearRequest,
  type SightReasoningClearResult,
  type SightReasoningSkip,
  type SightStatusResult,
} from './config.ts'

export const name = 'dsh-sight'

/** Settings namespace carrying the pi-ai provider profiles. */
const NS = 'llm-pi-ai'

/** Settings namespace + provider route for the official DeepSeek channel (a distinct adapter, not a pi-ai provider). */
const DEEPSEEK_NS = 'llm-deepseek'
const DEEPSEEK_PROVIDER = 'deepseek-official'

/** Built-in DSH plugin that connects one stdio MCP server and mounts its tools. */
const FIGMA_MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/**
 * Resolve the installed `figma-ui-mcp` package: the plugin directory whose
 * manifest the settings page points at, the server directory the patched entry
 * is generated from, plus its version. The package ships as a dependency and
 * stays external in the build, so the child process this facade spawns has a
 * real entry file on disk.
 */
const figmaUiPackage = (): { readonly pluginDir: string; readonly serverDir: string; readonly version: string } | null => {
  try {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve('figma-ui-mcp/package.json')
    const root = dirname(resolved)
    const pluginDir = join(root, 'plugin')
    const serverDir = join(root, 'server')
    if (!existsSync(join(pluginDir, 'manifest.json'))) return null
    if (!existsSync(join(serverDir, 'index.js'))) return null
    let version = 'unknown'
    try {
      const pkg = JSON.parse(readFileSync(resolved, 'utf8')) as { version?: unknown }
      if (typeof pkg.version === 'string' && pkg.version.length > 0) version = pkg.version
    } catch { /* keep 'unknown' — the copy is rebuilt whenever the stamp differs */ }
    return { pluginDir, serverDir, version }
  } catch {
    return null
  }
}

/** Read-only localhost plugin MCP server entry (design-to-code). */
const FIGMA_READ_BIN = join(dirname(fileURLToPath(import.meta.url)), 'figma-read-server.js')
/**
 * Write-capable localhost plugin bridge entry: this package's own facade over
 * the `figma-ui-mcp` server, which pins every read/write call to one Figma file
 * instead of letting the bridge pick "whichever plugin polled last".
 */
const FIGMA_WRITE_BIN = join(dirname(fileURLToPath(import.meta.url)), 'figma-ui-server.js')

/** Loose raw pi-ai profile shape read from the stored settings layer. */
interface RawProfile {
  readonly displayName?: string
  readonly api?: string
  readonly models?: readonly RawModel[]
  readonly modelOverrides?: Readonly<Record<string, RawModel | undefined>>
}
interface RawModel {
  readonly id: string
  readonly name?: string
  readonly reasoningEfforts?: Readonly<Record<string, string | null>> | false
  readonly compat?: Readonly<Record<string, unknown>>
  /** pi-ai profile field: the modalities this model accepts. */
  readonly input?: readonly string[]
  /** Official-channel catalog field; the pi-ai profile spells the same fact `input`. */
  readonly inputModalities?: readonly string[]
}
interface RawSection {
  readonly providers?: Readonly<Record<string, RawProfile | undefined>>
}

/** One chunk as the probe consumes it; only the terminal `finish` carries a failure. */
interface ProbeStreamChunk {
  readonly type?: string
  readonly reason?: {
    readonly kind?: string
    readonly failure?: { readonly code?: string; readonly message?: string }
  }
}

/**
 * Host service surfaces narrowed through the plugin ctx. The `settings` service
 * is deliberately NOT declared here: it is used through its own package type
 * (`SettingsForms`), because a hand-written interface once declared a
 * `get(ns)` that DSH 0.2 dropped — that compiled clean and only surfaced as an
 * `internal:` RPC error on the settings page.
 */
interface LlmServiceLike {
  listModels(provider: string): Promise<readonly { id: string; name: string; inputModalities?: readonly string[] }[]>
  resolveModelInfo(provider: string, model: string): Promise<{
    reasoning?: { efforts?: readonly { id?: string; name?: string }[] }
    inputModalities?: readonly string[]
  }>
  stream(options: {
    provider: string
    model: string
    messages: readonly { readonly role: string; readonly content: readonly unknown[] }[]
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<ProbeStreamChunk>
}

/**
 * Durable attachment store, narrowed to the one call the probe needs. Declared
 * structurally rather than imported: `@deepseek-ai/dsh-attachment` is a DSH
 * runtime package the plugin reaches through the module table, not a build
 * dependency (the same reason `LlmServiceLike` exists).
 */
interface AttachmentStoreLike {
  readonly imageLimits?: { readonly mediaTypes?: readonly string[] }
  saveImages(inputs: readonly { readonly data: Buffer; readonly mediaType: string }[]): Promise<readonly unknown[]>
}

/** Whether a resolved modality list admits images; `null` when it states none. */
function imageAdmitted(modalities: readonly string[] | undefined): boolean | null {
  return Array.isArray(modalities) ? modalities.includes('image') : null
}

/** RPC success arm. */
function ok(value: unknown): ConnectionRpcResult<unknown> {
  return { ok: true, value }
}
/** RPC failure arm. */
function fail(message: string): ConnectionRpcResult<unknown> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** Cap for one `/sight` request body: every endpoint carries a small JSON payload. */
const MAX_SIGHT_BODY_BYTES = 1 << 20

/**
 * Deadline for one probe request. The settings page waits on this RPC, so a
 * route that never answers must fail as `inconclusive` (an aborted request is
 * not a capability verdict) rather than leave the page spinning.
 */
const PROBE_TIMEOUT_MS = 20_000

/** Abort signal handed to the connection-shaped handler; `/sight` work never outlives a request. */
const SIGHT_NEVER_ABORTED = new AbortController().signal

/**
 * Loopback Host/Origin fence for {@link SIGHT_RPC_CHANNEL}, mirroring the
 * `authority: 'loopback'` check Connection applies to a registered channel.
 * Only used on runtimes whose Connection exposes no `requestRejection`.
 * @param req - raw request headers.
 * @returns the HTTP status to reject with, or undefined to let the call through.
 */
function loopbackRejection(req: IncomingMessage): number | undefined {
  const host = req.headers.host
  if (host === undefined) return 403
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return 403
  }
  const parts = hostUrl.hostname.split('.')
  const loopback = hostUrl.hostname === 'localhost' || hostUrl.hostname === '[::1]'
    || (parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255))
  if (!loopback) return 403
  if (req.headers['sec-fetch-site'] === 'cross-site') return 403
  const origin = req.headers.origin
  if (origin === undefined) return undefined
  try {
    return new URL(origin).host === hostUrl.host ? undefined : 403
  } catch {
    return 403
  }
}

/**
 * Endpoint named by a `/sight/<endpoint>` pathname.
 * @param rawUrl - the request target.
 * @returns the endpoint segment, or undefined when the path is not this channel's.
 */
function sightEndpoint(rawUrl: string | undefined): string | undefined {
  const pathname = new URL(rawUrl ?? '/', 'http://dsh.invalid').pathname
  if (!pathname.startsWith(`${SIGHT_RPC_CHANNEL}/`)) return undefined
  const endpoint = pathname.slice(SIGHT_RPC_CHANNEL.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment => segment.length === 0 || !/^[A-Za-z0-9_$.-]+$/.test(segment))) return undefined
  return endpoint
}

/**
 * Buffer one request body, refusing anything past {@link MAX_SIGHT_BODY_BYTES}.
 * @param req - raw request.
 * @returns the decoded body text.
 */
function readSightBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_SIGHT_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Write one JSON response for the browser half. */
function writeSightJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * Host half: serve the `/sight` channel. The route is registered on the web
 * server directly rather than through `connection.rpc.handle`, because
 * Connection 0.1.5+ resolves the web server against its *own* fiber when a
 * caller mounts a channel (`owner.effect(() => owner.webServer.register(route))`
 * after `const owner = this.ctx`), which fails with `cannot get property
 * "webServer" without inject` for every plugin; the request then fell through
 * to the static fallback as HTTP 405. The fence is Connection's own
 * `requestRejection` when the runtime has it, and the equivalent loopback
 * Host/Origin check otherwise. The web server is injected separately so a
 * headless profile (no web server) still gets the rest of the Host half.
 */
export function apply(ctx: Context): void {
  ctx.inject(['connection', 'settings', 'llm'], (sightCtx) => {
    const connection = sightCtx.get('connection') as unknown as HostConnectionHandle
    // Injected above, so the service is present; the property access carries the
    // real `SettingsForms` type instead of a local shape that could drift.
    const settings = sightCtx.settings
    void (settings as unknown as { get(ns: string): unknown })
    const llm = sightCtx.get('llm') as unknown as LlmServiceLike

    /**
     * Durable attachment store, when the composition mounts one. Injected as a
     * nested optional service rather than a fourth required one: a profile
     * without attachments must still get the rest of the Host half, and only the
     * image probe degrades (to `inconclusive`).
     */
    let attachments: AttachmentStoreLike | undefined
    sightCtx.inject(['attachments'], (attachCtx) => {
      attachments = attachCtx.get('attachments') as unknown as AttachmentStoreLike
    })

    /**
     * Live descriptor of one settings namespace, or undefined when the running
     * composition carries no such entry. Intentionally uncaught: a settings read
     * that fails must surface on the page instead of reading as "no providers".
     */
    const descriptorOf = (ns: string): SettingsDescriptor | undefined =>
      settings.describe().find(descriptor => descriptor.ns === ns)

    /** Provider map of one resolved settings value (`llm-pi-ai` shape), or undefined. */
    const providersOf = (value: unknown): Readonly<Record<string, RawProfile | undefined>> | undefined => {
      if (value === null || typeof value !== 'object') return undefined
      const providers = (value as { providers?: unknown }).providers
      return providers !== null && typeof providers === 'object'
        ? providers as Readonly<Record<string, RawProfile | undefined>>
        : undefined
    }

    /** Raw (stored) user section of the llm-pi-ai namespace, or undefined. */
    const rawSection = (): RawSection | undefined => {
      try {
        const user = descriptorOf(NS)?.user
        return user !== null && typeof user === 'object' ? user as RawSection : undefined
      } catch {
        return undefined
      }
    }

    /** Effective (base + user) provider map of the pi-ai namespace, or undefined when unreadable. */
    const effectiveProviders = (): Readonly<Record<string, RawProfile | undefined>> | undefined => {
      try {
        return providersOf(descriptorOf(NS)?.value)
      } catch {
        return undefined
      }
    }

    /**
     * Wire protocol of a route: the stored `api`, else the resolved one, else
     * undefined. The resolved map is read once by the caller so a settings read
     * is never repeated per provider.
     */
    const routeApi = (
      provider: string,
      raw: RawProfile | undefined,
      effective: Readonly<Record<string, RawProfile | undefined>> | undefined,
    ): string | undefined => {
      if (typeof raw?.api === 'string') return raw.api
      const api = effective?.[provider]?.api
      return typeof api === 'string' ? api : undefined
    }

    /** Full overview for the settings page. */
    const status = async (): Promise<SightStatusResult> => {
      const rawProviders = rawSection()?.providers
      const reasoningDictionary = reasoningDictionaryEntries()
      const providers: SightProviderEntry[] = []
      // The configured provider set is the *effective* config (base + user).
      const configured = providersOf(descriptorOf(NS)?.value)
      if (configured !== undefined) {
        for (const [provider, profile] of Object.entries(configured)) {
          const models: SightModelEntry[] = []
          let error: string | null = null
          try {
            const listed = await llm.listModels(provider)
            models.push(...await Promise.all(listed.map(async (m): Promise<SightModelEntry> => {
              let adapterReasoning: readonly { id?: string; name?: string }[] | undefined
              try {
                const info = await llm.resolveModelInfo(provider, m.id)
                adapterReasoning = info.reasoning?.efforts
              } catch {
                adapterReasoning = undefined
              }
              const adapterLevels = Array.isArray(adapterReasoning)
                ? adapterReasoning
                    .map(e => (typeof e?.id === 'string' && e.id.length > 0 ? e.id : undefined))
                    .filter((id): id is string => id !== undefined)
                : undefined
              const entry = (rawProviders?.[provider]?.models?.find(x => x !== null && typeof x === 'object' && x.id === m.id))
                ?? (rawProviders?.[provider]?.modelOverrides?.[m.id])
              // A stored map outranks the adapter here: on a pi-ai route the
              // adapter's levels are derived FROM that map, so asking it first
              // would report every declared model as "adapter".
              const reasoning = describePiAiModelReasoning({
                adapterLevels,
                declaredEfforts: entry?.reasoningEfforts,
              })
              return {
                id: m.id,
                name: m.name,
                reasoning,
                // The adapter's resolved modalities are exactly what prompt
                // admission checks, so this answers "can I paste an image here".
                image: imageAdmitted(m.inputModalities),
              }
            })))
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught)
          }
          providers.push({ provider, name: profile?.displayName ?? provider, models, error, probeable: true })
        }
      }
      // The official DeepSeek channel is a distinct adapter (deepseek-official)
      // configured under the llm-deepseek namespace, not a pi-ai provider. List
      // it as its own group so its configured models and reasoning levels appear
      // on the settings page.
      try {
        const deepseekValue = descriptorOf(DEEPSEEK_NS)?.value
        const deepseekModels = ((): readonly RawModel[] => {
          if (deepseekValue === null || typeof deepseekValue !== 'object') return []
          const models = (deepseekValue as { models?: unknown }).models
          return Array.isArray(models) ? models as readonly RawModel[] : []
        })()
        if (deepseekModels.length > 0) {
          const models: SightModelEntry[] = await Promise.all(deepseekModels.map(async (dm): Promise<SightModelEntry> => {
            const id = typeof dm?.id === 'string' ? dm.id : ''
            if (id.length === 0) return { id: '', name: '', reasoning: null, image: null }
            let adapterReasoning: readonly { id?: string; name?: string }[] | undefined
            try {
              const info = await llm.resolveModelInfo(DEEPSEEK_PROVIDER, id)
              adapterReasoning = info.reasoning?.efforts
            } catch {
              adapterReasoning = undefined
            }
            const reasoning = ((): SightModelEntry['reasoning'] => {
              // The official channel's adapter resolves its levels from the
              // channel's own thinking setting and always reports the same four,
              // so the adapter outranks the catalog entry's `reasoningEfforts`
              // here — the opposite of the pi-ai branch above.
              if (Array.isArray(adapterReasoning)) {
                const levels = adapterReasoning.map(e => (typeof e?.id === 'string' && e.id.length > 0 ? e.id : undefined))
                  .filter((l): l is string => l !== undefined)
                if (levels.length > 0) return { source: 'adapter', levels }
              }
              if (dm?.reasoningEfforts !== undefined && dm.reasoningEfforts !== false && dm.reasoningEfforts !== null) {
                return { source: 'declared', levels: Object.keys(dm.reasoningEfforts) }
              }
              return null
            })()
            return {
              id,
              name: typeof dm?.name === 'string' && dm.name.length > 0 ? dm.name : id,
              reasoning,
              // The official channel's catalog carries the modality directly.
              image: imageAdmitted(dm?.inputModalities),
            }
          }))
          providers.push({ provider: DEEPSEEK_PROVIDER, name: 'DeepSeek 官方', models, error: null, probeable: false })
        }
      } catch (de) {
        providers.push({ provider: DEEPSEEK_PROVIDER, name: 'DeepSeek 官方', models: [], error: de instanceof Error ? de.message : String(de), probeable: false })
      }
      return { namespace: NS, reasoningDictionary, providers }
    }

    /**
     * Whether the adapter already resolves reasoning levels for one model.
     *
     * This is the guard that keeps the dictionary a *fallback*: a route the
     * installed pi-ai catalog describes carries a `thinkingLevelMap` transcribed
     * from the vendor, and pi-ai replaces — never merges — that map when a
     * `reasoningEfforts` block appears beside it. Writing the dictionary there
     * would therefore narrow the model (the vendor's `minimal` disappears) or
     * invent levels the vendor denies. Resolution failing means the catalog does
     * not describe the model, which is exactly when the dictionary is needed.
     * @param provider - provider route key.
     * @param model - model id on that route.
     * @returns true when the adapter already describes this model's levels.
     */
    const adapterDescribesReasoning = async (provider: string, model: string): Promise<boolean> => {
      try {
        const info = await llm.resolveModelInfo(provider, model)
        return info.reasoning !== undefined
      } catch {
        return false
      }
    }

    /** One dictionary preset flattened for the result payload. */
    const presetEfforts = (match: { readonly efforts: Readonly<Record<string, string | null>> }): readonly { level: string; wire: string }[] =>
      Object.entries(match.efforts).map(([level, wire]) => ({ level, wire: wire ?? '' }))

    /**
     * Bulk-write a reasoning-effort map for every configured model the adapter
     * cannot describe, matching the reasoning dictionary, and not yet declaring
     * a map. The dictionary is a fallback in both shapes:
     *
     * - a hand-declared `models` entry whose id the installed catalog describes
     *   keeps the catalog's own levels (see {@link adapterDescribesReasoning});
     * - a catalog-backed `modelOverrides` entry is filled only when the adapter
     *   reports no reasoning for it.
     *
     * Existing declared maps are left untouched — including a wrong one, which
     * is why the result reports every skipped model and the UI shows them.
     * Channels are written one at a time, so a channel the settings validator
     * refuses is reported in `failed` instead of discarding the whole pass.
     */
    const applyReasoning = async (): Promise<SightApplyReasoningResult> => {
      const rawProviders = rawSection()?.providers
      const skipped: SightReasoningSkip[] = []
      const failed: SightReasoningFailure[] = []
      if (rawProviders === undefined || typeof rawProviders !== 'object') {
        return { applied: 0, providers: 0, changes: [], skipped, failed }
      }
      let applied = 0
      let touchedProviders = 0
      const changes: SightReasoningChange[] = []
      // One resolved read for the whole pass: `routeApi` falls back to the
      // effective `api` for providers whose protocol is inherited, not stored.
      const effective = effectiveProviders()
      for (const [provider, profile] of Object.entries(rawProviders)) {
        if (profile === undefined || typeof profile !== 'object') continue
        const api = routeApi(provider, profile, effective)
        const rawModels = Array.isArray(profile.models) ? profile.models : undefined
        if (rawModels !== undefined) {
          // Sequential rather than `map`: the adapter guard is asynchronous, and
          // a hand-declared list is short enough that the round-trips do not
          // matter next to the settings write that follows.
          const next: unknown[] = []
          let changedCount = 0
          for (const m of rawModels) {
            if (m === null || typeof m !== 'object' || typeof m.id !== 'string') {
              next.push(m)
              continue
            }
            const decision = await decideReasoningFill({
              modelId: m.id,
              api,
              declaredEfforts: m.reasoningEfforts,
              adapterDescribes: () => adapterDescribesReasoning(provider, m.id),
            })
            if (decision.kind === 'unmatched') {
              next.push(m)
              continue
            }
            if (decision.kind === 'skip') {
              skipped.push({ provider, model: m.id, reason: decision.reason })
              next.push(m)
              continue
            }
            const match = decision.preset
            changedCount += 1
            changes.push({ provider, model: m.id, family: match.family, efforts: presetEfforts(match) })
            next.push(match.compat === undefined
              ? { ...m, reasoningEfforts: { ...match.efforts } }
              : { ...m, reasoningEfforts: { ...match.efforts }, compat: { ...m.compat, ...match.compat } })
          }
          if (changedCount > 0) {
            try {
              await settings.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }])
              applied += changedCount
              touchedProviders += 1
            } catch (error) {
              failed.push({ provider, error: error instanceof Error ? error.message : String(error) })
              // The change list describes what was *attempted*; drop this
              // channel's rows so it never reads as applied.
              changes.splice(changes.length - changedCount, changedCount)
            }
          }
          continue
        }
        const ops: SettingsPathOp[] = []
        let planned = 0
        try {
          const models = await llm.listModels(provider)
          for (const m of models) {
            const decision = await decideReasoningFill({
              modelId: m.id,
              api,
              declaredEfforts: profile.modelOverrides?.[m.id]?.reasoningEfforts,
              adapterDescribes: () => adapterDescribesReasoning(provider, m.id),
            })
            if (decision.kind === 'unmatched') continue
            if (decision.kind === 'skip') {
              skipped.push({ provider, model: m.id, reason: decision.reason })
              continue
            }
            const match = decision.preset
            ops.push({
              op: 'set',
              path: ['providers', provider, 'modelOverrides', m.id, 'reasoningEfforts'],
              value: { ...match.efforts },
            })
            for (const [key, value] of Object.entries(match.compat ?? {})) {
              ops.push({ op: 'set', path: ['providers', provider, 'modelOverrides', m.id, 'compat', key], value })
            }
            planned += 1
            changes.push({ provider, model: m.id, family: match.family, efforts: presetEfforts(match) })
          }
          if (ops.length > 0) {
            await settings.mutate(NS, ops)
            applied += planned
            touchedProviders += 1
          }
        } catch (error) {
          failed.push({ provider, error: error instanceof Error ? error.message : String(error) })
          changes.splice(changes.length - planned, planned)
        }
      }
      return { applied, providers: touchedProviders, changes, skipped, failed }
    }

    /**
     * Drop one model's written declaration so the adapter describes it again.
     *
     * This is the only repair available to the plugin: it cannot read the
     * installed catalog, so it can never compute the "right" map for a catalog
     * model — but once the stored `reasoningEfforts` (and the compat keys the
     * matching preset would have written) are gone, pi-ai falls back to the
     * catalog's own `thinkingLevelMap`, which is the vendor's. Undeclaring is
     * therefore strictly safer than overwriting.
     * @param req - the provider and model to undeclare.
     * @returns whether the write landed, and why not when it did not.
     */
    const clearReasoning = async (req: SightReasoningClearRequest): Promise<SightReasoningClearResult> => {
      const provider = typeof req.provider === 'string' ? req.provider : ''
      const model = typeof req.model === 'string' ? req.model : ''
      if (provider.length === 0 || model.length === 0) return { ok: false, error: 'provider 与 model 必填' }
      const profile = rawSection()?.providers?.[provider]
      if (profile === undefined || typeof profile !== 'object') {
        return { ok: false, error: `未找到渠道 ${provider}` }
      }
      // Remove exactly what `applyReasoning` would have written for this model:
      // its `reasoningEfforts`, plus the preset's compat keys. A compat key the
      // user set by hand and no preset declares is left alone, and a key that is
      // not there is never named — an `unset` on an absent path would leave an
      // empty `compat: {}` behind.
      const preset = reasoningFamilyOf(model, routeApi(provider, profile, effectiveProviders()))
      const models = Array.isArray(profile.models) ? profile.models : undefined
      const index = models?.findIndex(entry => entry !== null && typeof entry === 'object' && entry.id === model) ?? -1
      const target = models !== undefined && index >= 0
        ? { entry: models[index] as { reasoningEfforts?: unknown; compat?: Readonly<Record<string, unknown>> }, base: ['providers', provider, 'models', String(index)] as string[] }
        : { entry: profile.modelOverrides?.[model], base: ['providers', provider, 'modelOverrides', model] as string[] }
      if (target.entry === undefined || typeof target.entry !== 'object') {
        return { ok: false, error: `${provider}/${model} 没有可清除的声明` }
      }
      const ops: SettingsPathOp[] = []
      if (target.entry.reasoningEfforts !== undefined) {
        ops.push({ op: 'unset', path: [...target.base, 'reasoningEfforts'] })
      }
      for (const key of Object.keys(preset?.compat ?? {})) {
        if (target.entry.compat?.[key] === undefined) continue
        ops.push({ op: 'unset', path: [...target.base, 'compat', key] })
      }
      if (ops.length === 0) return { ok: false, error: `${provider}/${model} 没有可清除的声明` }
      try {
        await settings.mutate(NS, ops)
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    /**
     * Where one model's `input` lives in the stored profile, plus what was there
     * before the probe touched it. Restoring needs both facts: a field that was
     * absent must be removed again, not set to the schema's materialized default.
     */
    interface InputSnapshot {
      readonly path: readonly string[]
      readonly had: boolean
      readonly value: unknown
    }

    /** Locate one model's `input` field in the stored profile, or null when the model is not stored. */
    const locateModelInput = (provider: string, profile: RawProfile, model: string): InputSnapshot | null => {
      const models = Array.isArray(profile.models) ? profile.models : undefined
      const index = models?.findIndex(entry => entry !== null && typeof entry === 'object' && entry.id === model) ?? -1
      if (models !== undefined && index >= 0) {
        const entry = models[index] as { input?: unknown } | undefined
        return { path: ['providers', provider, 'models', String(index), 'input'], had: entry?.input !== undefined, value: entry?.input }
      }
      const override = profile.modelOverrides?.[model] as { input?: unknown } | undefined
      if (override === undefined) return null
      return { path: ['providers', provider, 'modelOverrides', model, 'input'], had: override.input !== undefined, value: override.input }
    }

    /** Put a model's `input` back exactly as {@link locateModelInput} found it. */
    const restoreModelInput = async (snapshot: InputSnapshot): Promise<void> => {
      await settings.mutate(NS, [snapshot.had
        ? { op: 'set', path: [...snapshot.path], value: snapshot.value }
        : { op: 'unset', path: [...snapshot.path] }])
    }

    /**
     * Run one probe request and reduce it to the two facts the classifier needs.
     *
     * Failures arrive as a terminal `finish` chunk with `reason.kind === 'error'`
     * (the runtime turns every adapter dispatch and iteration failure into one),
     * not as a throw — middleware and consumer throws are the only ones that
     * propagate, and those are caught here too so a probe never escapes as an
     * RPC error.
     * @param input - the route, the content to send, and the caller's abort signal.
     * @returns whether the request was accepted, and the failure's code and message when not.
     */
    const runProbeRequest = async (input: {
      readonly provider: string
      readonly model: string
      readonly content: readonly unknown[]
      readonly signal: AbortSignal
    }): Promise<{ ok: boolean; code?: string | undefined; message?: string | undefined }> => {
      try {
        for await (const chunk of llm.stream({
          provider: input.provider,
          model: input.model,
          messages: [{ role: 'user', content: input.content }],
          maxTokens: PROBE_MAX_TOKENS,
          signal: input.signal,
        })) {
          if (chunk.type !== 'finish') continue
          const kind = chunk.reason?.kind
          if (kind !== 'error' && kind !== 'aborted') return { ok: true }
          const code = chunk.reason?.failure?.code
          const message = chunk.reason?.failure?.message
          // An empty completion still proves the endpoint took the request: the
          // round trip finished, so the image was accepted.
          if (code === 'EMPTY_RESPONSE') return { ok: true }
          return { ok: false, code, message }
        }
        return { ok: false, message: '流已结束但没有收到 finish 块' }
      } catch (error) {
        const code = (error as { code?: unknown }).code
        return {
          ok: false,
          code: typeof code === 'string' ? code : undefined,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }

    /**
     * Test whether one pi-ai route's endpoint actually accepts an image.
     *
     * DSH admits images by declaration, so the endpoint can only be asked once
     * `input` includes `image` — the local gate refuses before any byte leaves
     * otherwise. The probe therefore:
     *
     * 1. sends a **text-only control request** to prove the route, credential,
     *    and base URL work (and to give a failure something to be attributed to);
     * 2. writes `input: [text, image]` when it is not already there;
     * 3. re-reads the adapter's resolved modalities — if the declaration did not
     *    take effect the request would be refused locally, which must not be
     *    mistaken for an endpoint refusal;
     * 4. mints the 1×1 probe image through the durable attachment store and
     *    sends it;
     * 5. keeps the declaration on acceptance and **restores the exact snapshot**
     *    on anything else, so a rejected or inconclusive probe leaves no trace.
     * @param req - the provider and model to test.
     * @returns the tri-state verdict with its evidence.
     */
    const probeImage = async (req: SightImageProbeRequest): Promise<SightImageProbeResult> => {
      const provider = typeof req.provider === 'string' ? req.provider : ''
      const model = typeof req.model === 'string' ? req.model : ''
      if (provider.length === 0 || model.length === 0) {
        return { verdict: 'inconclusive', detail: 'provider 与 model 必填', declared: false }
      }
      if (provider === DEEPSEEK_PROVIDER) {
        return {
          verdict: 'inconclusive',
          detail: '官方渠道的图片能力写在渠道目录的 inputModalities 里，本探测不写该目录',
          declared: false,
        }
      }
      const profile = rawSection()?.providers?.[provider]
      if (profile === undefined || typeof profile !== 'object') {
        return { verdict: 'inconclusive', detail: `未找到渠道 ${provider}`, declared: false }
      }
      const snapshot = locateModelInput(provider, profile, model)
      if (snapshot === null) {
        return { verdict: 'inconclusive', detail: `${provider}/${model} 不在该渠道的 models/modelOverrides 里`, declared: false }
      }

      // 1) Control request. Text only, so it needs no declaration and proves the
      // route before anything is written.
      const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
      const control = await runProbeRequest({
        provider,
        model,
        content: [{ type: 'text', text: PROBE_PROMPT_TEXT }],
        signal,
      })
      if (!control.ok) {
        return {
          ...classifyImageProbeFailure({ controlSucceeded: false, code: control.code, message: control.message }),
          declared: imageAdmitted((await llm.resolveModelInfo(provider, model)).inputModalities) === true,
        }
      }

      // 2) Declare, unless the model already reports image support.
      const before = await llm.resolveModelInfo(provider, model)
      const alreadyDeclared = imageAdmitted(before.inputModalities) === true
      let wroteDeclaration = false
      if (!alreadyDeclared) {
        try {
          await settings.mutate(NS, [{ op: 'set', path: [...snapshot.path], value: ['text', 'image'] }])
          wroteDeclaration = true
        } catch (error) {
          return {
            verdict: 'inconclusive',
            detail: `写入 input 失败：${error instanceof Error ? error.message : String(error)}`,
            declared: false,
          }
        }
      }

      /** Roll the declaration back when the probe did not earn it. */
      const rollback = async (): Promise<boolean> => {
        if (!wroteDeclaration) return alreadyDeclared
        try {
          await restoreModelInput(snapshot)
          return false
        } catch {
          // The declaration stays; say so rather than claiming a clean rollback.
          return true
        }
      }

      // 3) The declaration must actually reach the adapter, or the next request
      // is refused locally and the endpoint is never consulted.
      const after = await llm.resolveModelInfo(provider, model)
      if (imageAdmitted(after.inputModalities) !== true) {
        return { ...classifyDeclarationNotApplied(after.inputModalities), declared: await rollback() }
      }

      // 4) Mint the probe image. A missing store or refused bytes is not a
      // statement about the endpoint.
      if (attachments === undefined) {
        return { ...classifyImageProbeUnsendable('未挂载附件服务'), declared: await rollback() }
      }
      let probeRef: unknown
      try {
        const accepted = attachments.imageLimits?.mediaTypes
        if (Array.isArray(accepted) && !accepted.includes(PROBE_IMAGE_MEDIA_TYPE)) {
          return { ...classifyImageProbeUnsendable(`附件服务不接受 ${PROBE_IMAGE_MEDIA_TYPE}`), declared: await rollback() }
        }
        const refs = await attachments.saveImages([
          { data: Buffer.from(PROBE_IMAGE_PNG_BASE64, 'base64'), mediaType: PROBE_IMAGE_MEDIA_TYPE },
        ])
        probeRef = refs[0]
        if (probeRef === undefined) return { ...classifyImageProbeUnsendable('附件服务未返回引用'), declared: await rollback() }
      } catch (error) {
        return {
          ...classifyImageProbeUnsendable(error instanceof Error ? error.message : String(error)),
          declared: await rollback(),
        }
      }

      // 5) The image request itself.
      const image = await runProbeRequest({
        provider,
        model,
        content: [
          { type: 'text', text: PROBE_PROMPT_TEXT },
          { type: 'image', attachment: probeRef },
        ],
        signal,
      })
      if (image.ok) return { ...classifyImageProbeSuccess(), declared: true }
      const outcome = classifyImageProbeFailure({ controlSucceeded: true, code: image.code, message: image.message })
      return { ...outcome, declared: await rollback() }
    }

    // ── Figma MCP bridge ────────────────────────────────────────────────────
    //
    // DSH exposes a built-in `@deepseek-ai/dsh-mcp-client` that connects to any
    // stdio MCP server and mounts its tools for the model. The Figma desktop
    // MCP endpoint (Dev Mode) is enterprise-gated, so for personal accounts we
    // run a local read-only facade over the Figma Desktop plugin bridge. The
    // only wiring is a row in the profile's `cordis.patch.yml`; the facade
    // enforces read-only tool and operation allowlists.

    /** Active profile name: the desktop launcher pins `desktop`; fall back to scanning. */
    const activeProfile = (): string => {
      const pinned = process.env.DSH_DESKTOP_DEFAULT_PROFILE
      if (typeof pinned === 'string' && pinned.length > 0) return pinned
      try {
        const dir = join(dshHome(), 'profiles')
        if (existsSync(dir)) {
          const candidates = readdirSync(dir).filter(name => existsSync(join(dir, name, 'cordis.patch.yml')))
          const single = candidates[0]
          if (candidates.length === 1 && single !== undefined) return single
        }
      } catch { /* fall through to default */ }
      return 'desktop'
    }

    /** DSH home directory: `$DSH_HOME` else `~/.dsh`. */
    const dshHome = (): string => {
      const env = process.env.DSH_HOME
      return typeof env === 'string' && env.trim().length > 0 ? env.trim() : join(homedir(), '.dsh')
    }

    /** Absolute path of the active profile's patch layer. */
    const patchPath = (): string => join(dshHome(), 'profiles', activeProfile(), 'cordis.patch.yml')

    /** Read the patch file as a mutable array of top-level patch entries. */
    const readPatch = (): unknown[] => {
      const file = patchPath()
      if (!existsSync(file)) return []
      const text = readFileSync(file, 'utf8')
      const stripped = text.replace(/^\uFEFF/, '')
      try {
        const value = parseYaml(stripped)
        return Array.isArray(value) ? value as unknown[] : []
      } catch {
        throw new Error(`cannot parse ${file}`)
      }
    }

    /**
     * Find the `insert` entry carrying one Figma MCP row. Matches by the
     * mcp-client plugin name AND the mode's serverName (`figma-read` for the
     * read-only plugin server, `figma-ui` for the plugin bridge) so unrelated mcp-client
     * rows are never touched.
     */
    const findFigmaRow = (patch: unknown[], mode: 'read' | 'write'): { insertEntry: Record<string, unknown>; row: Record<string, unknown>; index: number } | null => {
      const serverNames = mode === 'read' ? new Set(['figma-read', 'figma']) : new Set(['figma-ui'])
      for (const entry of patch) {
        if (entry === null || typeof entry !== 'object') continue
        const e = entry as Record<string, unknown>
        if (typeof e.insert !== 'object' || e.insert === null) continue
        const list = Array.isArray(e.insert) ? e.insert : [e.insert]
        for (let i = 0; i < list.length; i++) {
          const row = list[i]
          if (row === null || typeof row !== 'object') continue
          const r = row as Record<string, unknown>
          if (r.name !== FIGMA_MCP_PLUGIN) continue
          const config = r.config
          if (config === null || typeof config !== 'object') continue
          const c = config as Record<string, unknown>
          if (typeof c.serverName === 'string' && serverNames.has(c.serverName)) return { insertEntry: e, row: r, index: i }
        }
      }
      return null
    }

    /** Read one mode's presence + token flag from a found row. */
    const rowStatus = (found: { row: Record<string, unknown> } | null): { configured: boolean; hasToken: boolean } => {
      if (found === null) return { configured: false, hasToken: false }
      let hasToken = false
      const config = found.row.config
      if (config !== null && typeof config === 'object') {
        const c = config as Record<string, unknown>
        if (c.env !== null && typeof c.env === 'object') {
          const env = c.env as Record<string, unknown>
          hasToken = typeof env.FIGMA_API_KEY === 'string' && env.FIGMA_API_KEY.length > 0
        }
      }
      return { configured: true, hasToken }
    }

    /**
     * App-managed Figma UI MCP Bridge plugin copy, carrying the per-file
     * session patch. Rebuilt from the installed package whenever the upstream
     * version or the patch revision moved, so opening the settings page is
     * always enough to get a current copy to import.
     */
    const bridgePluginDir = (): string => bridgePluginInstall.bridgePluginDir(dirname(patchPath()))

    const bridgePluginState = (): SightBridgePluginInfo => {
      const upstream = figmaUiPackage()
      if (upstream === null) {
        return { patched: false, upstreamVersion: null, manifestPath: null, error: '未找到 figma-ui-mcp 依赖' }
      }
      return bridgePluginInstall.ensureBridgePlugin(bridgePluginDir(), upstream.pluginDir, upstream.version)
    }

    /** Upstream plugin manifest — the fallback when the patch cannot be applied. */
    const upstreamManifestPath = (): string | null => {
      const upstream = figmaUiPackage()
      return upstream === null ? null : join(upstream.pluginDir, 'manifest.json')
    }

    /**
     * Generated figma-ui-mcp entry. The write facade regenerates it on every
     * start, so this is only what the settings page reports.
     */
    const bridgeServerDir = (): string => bridgeServerInstall.bridgeServerDir(dirname(patchPath()))

    const bridgeServerState = (): SightBridgeServerInfo => {
      const upstream = figmaUiPackage()
      if (upstream === null) return { patched: false, entryPath: null, error: '未找到 figma-ui-mcp 依赖' }
      return bridgeServerInstall.ensureBridgeServer(bridgeServerDir(), upstream.serverDir, upstream.version)
    }

    /** Force a rebuild of both patched assets (the settings page's "重新生成" action). */
    const bridgePluginRefresh = (): SightBridgePluginUpdateResult => {
      try { rmSync(bridgePluginDir(), { recursive: true, force: true }) } catch { /* best effort */ }
      try { rmSync(bridgeServerDir(), { recursive: true, force: true }) } catch { /* best effort */ }
      const state = bridgePluginState()
      return { ok: state.patched, ...state, bridgeServer: bridgeServerState() }
    }

    // Read-mode engine choice lives in a small state file next to the patch,
    // because the facade process needs a live channel to flip engines without
    // a restart. The patch row itself stays engine-agnostic: it spawns the
    // same figma-read-server entry, which reads this file (via the
    // SIGHT_READ_STATE env the row carries) on every tool listing/call and
    // swaps its tool registry + sends `tools/list_changed` when it changes.

    interface SightReadStateFile { backend?: unknown; repoDir?: unknown }

    const sightReadStatePath = (): string => join(dirname(patchPath()), 'sight-figma-read.json')

    /** Active read-mode backend + grounding directory; defaults to figma-ui-mcp. */
    const readSightReadState = (): { backend: SightReadBackend; repoDir: string | null } => {
      try {
        const file = sightReadStatePath()
        if (!existsSync(file)) return { backend: 'figma-ui-mcp', repoDir: null }
        const value = JSON.parse(readFileSync(file, 'utf8')) as SightReadStateFile
        const backend: SightReadBackend = value.backend === 'figwright' ? 'figwright' : 'figma-ui-mcp'
        const repoDir = typeof value.repoDir === 'string' && value.repoDir.length > 0 ? value.repoDir : null
        return { backend, repoDir }
      } catch {
        return { backend: 'figma-ui-mcp', repoDir: null }
      }
    }

    /** Atomically persist the read-mode engine choice. */
    const writeSightReadState = (backend: SightReadBackend, repoDir: string | null): void => {
      const file = sightReadStatePath()
      const dir = dirname(file)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify({ backend, repoDir }, null, 2), 'utf8')
      renameSync(tmp, file)
    }

    /** Drop the read-mode engine state (used when the read row is removed). */
    const clearSightReadState = (): void => {
      try { rmSync(sightReadStatePath(), { force: true }) } catch { /* best effort */ }
    }

    // Which Figma file the write facade targets. With one file connected the
    // facade auto-selects; with several it refuses to guess unless a target is
    // pinned here (the `figma_files` tool writes this file through the env the
    // write row carries).

    const sightUiStatePath = (): string => join(dirname(patchPath()), 'sight-figma-ui.json')

    /** Drop the pinned write target (used when the write row is removed). */
    const clearSightUiState = (): void => {
      try { rmSync(sightUiStatePath(), { force: true }) } catch { /* best effort */ }
    }

    /** Validate the grounding directory a user picked for the figwright engine. */
    const validateRepoDir = (repoDir: string): string | null => {
      if (!isAbsolute(repoDir)) return 'repoDir 必须是绝对路径'
      try {
        if (!statSync(repoDir).isDirectory()) return `repoDir 不是目录: ${repoDir}`
      } catch {
        return `repoDir 不存在: ${repoDir}`
      }
      return null
    }

    /**
     * List a directory's subdirectories for the settings-page repoDir picker.
     * Browsing stays on the host (the browser cannot reveal absolute paths),
     * travels only over the loopback channel, and never leaves the machine.
     * An omitted/invalid request path falls back to the home directory.
     */
    const listRepoDirs = (requestPath: string | undefined): SightDirListing => {
      const path = typeof requestPath === 'string' && requestPath.length > 0 && isAbsolute(requestPath)
        ? requestPath
        : homedir()
      try {
        const entries = readdirSync(path, { withFileTypes: true })
        const dirs = entries
          .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
          .map(entry => entry.name)
          .filter(name => !name.startsWith('.'))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
          .map(name => join(path, name))
        const parent = dirname(path) === path ? null : dirname(path)
        return { path, parent, dirs, error: null }
      } catch (error) {
        return { path, parent: null, dirs: [], error: error instanceof Error ? error.message : String(error) }
      }
    }

    /** Serialize the patch array back to the file (UTF-8, no BOM). */
    const writePatch = (patch: unknown[]): void => {
      const file = patchPath()
      const dir = dirname(file)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(file, stringifyYaml(patch), 'utf8')
    }

    /** Where the latest Figwright plugin copy is kept (single, overwritten). */
    const figwrightPluginDir = (): string => figwrightInstall.figwrightPluginDir(dirname(patchPath()))
    const figwrightPluginState = (): SightFigwrightPluginInfo => figwrightInstall.readFigwrightPluginAt(figwrightPluginDir())
    const figwrightPluginUpdate = (): Promise<SightFigwrightPluginUpdateResult> =>
      figwrightInstall.installLatestFigwrightPlugin(figwrightPluginDir())

    /** Status: both capabilities' presence in the patch. */
    const figmaMcpStatus = (): SightFigmaMcpStatusResult => {
      const file = patchPath()
      try {
        const patch = readPatch()
        // The manifest path is available regardless of whether the write row is
        // configured (the package ships as a dependency), so the UI guides the
        // user to import it BEFORE enabling.
        const bridge = bridgePluginState()
        const bridgeServer = bridgeServerState()
        const manifest = bridge.manifestPath ?? upstreamManifestPath()
        const read = rowStatus(findFigmaRow(patch, 'read'))
        const write = rowStatus(findFigmaRow(patch, 'write'))
        const readEngine = readSightReadState()
        return {
          // figma-ui-mcp: the manifest is the patched copy of the shared dep's
          // plugin (also used by the write row). figwright: the plugin ships via
          // GitHub release zip, so there is no local manifest to point at.
          read: {
            ...read,
            backend: readEngine.backend,
            repoDir: readEngine.repoDir,
            manifestPath: readEngine.backend === 'figma-ui-mcp' ? manifest : null,
            figwrightPlugin: figwrightPluginState(),
            bridgePlugin: bridge,
            bridgeServer,
          },
          write: {
            ...write,
            backend: 'figma-ui-mcp',
            repoDir: null,
            manifestPath: manifest,
            figwrightPlugin: { installedTag: null, manifestPath: null },
            bridgePlugin: bridge,
            bridgeServer,
          },
          patchPath: file,
          profile: activeProfile(),
          error: null,
        }
      } catch (error) {
        const none: SightBridgePluginInfo = { patched: false, upstreamVersion: null, manifestPath: null, error: null }
        const noneServer: SightBridgeServerInfo = { patched: false, entryPath: null, error: null }
        return {
          read: { configured: false, hasToken: false, manifestPath: null, backend: 'figma-ui-mcp', repoDir: null, figwrightPlugin: { installedTag: null, manifestPath: null }, bridgePlugin: none, bridgeServer: noneServer },
          write: { configured: false, hasToken: false, manifestPath: null, backend: 'figma-ui-mcp', repoDir: null, figwrightPlugin: { installedTag: null, manifestPath: null }, bridgePlugin: none, bridgeServer: noneServer },
          patchPath: file,
          profile: activeProfile(),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    /**
     * Write (or update) one Figma MCP row.
     * - read mode: local plugin bridge facade, no token or external network.
     *   The engine (figma-ui-mcp | figwright) and grounding directory are
     *   persisted to the sight state file; the spawned facade watches it and
     *   swaps its read-only tool surface live.
     * - write mode: bare stdio entry, talks to the Figma Desktop plugin over
     *   localhost - no token, no proxy.
     */
    const figmaMcpApply = async (req: SightFigmaMcpApplyRequest): Promise<SightFigmaMcpWriteResult> => {
      const mode = req.mode
      if (mode !== 'read' && mode !== 'write') {
        return { ok: false, patchPath: patchPath(), error: 'mode must be "read" or "write"' }
      }
      let row: Record<string, unknown>
      if (mode === 'read') {
        const backend: SightReadBackend = req.backend === 'figwright' ? 'figwright' : 'figma-ui-mcp'
        let repoDir: string | null = null
        const rawRepoDir = typeof req.repoDir === 'string' ? req.repoDir.trim() : ''
        if (rawRepoDir.length > 0) {
          const invalid = validateRepoDir(rawRepoDir)
          if (invalid !== null) return { ok: false, patchPath: patchPath(), error: invalid }
          repoDir = rawRepoDir
        }
        // The row is engine-agnostic; the facade reads SIGHT_READ_STATE to pick
        // the engine and swaps tools live (tools/list_changed).
        row = {
          id: 'figma-read-mcp',
          name: FIGMA_MCP_PLUGIN,
          config: {
            transport: 'stdio',
            serverName: 'figma-read',
            command: 'node',
            args: [FIGMA_READ_BIN],
            env: { SIGHT_READ_STATE: sightReadStatePath() },
          },
        }
        try {
          const patch = readPatch()
          let found = findFigmaRow(patch, 'read')
          // Remove every legacy REST/read row, including duplicates, so an old
          // token-bearing child process cannot survive the migration.
          while (found !== null) {
            const list = Array.isArray(found.insertEntry.insert) ? found.insertEntry.insert : [found.insertEntry.insert]
            list.splice(found.index, 1)
            found.insertEntry.insert = list
            found = findFigmaRow(patch, 'read')
          }
          patch.push({ insert: [row] })
          writePatch(patch)
          writeSightReadState(backend, repoDir)
        } catch (error) {
          return { ok: false, patchPath: patchPath(), error: error instanceof Error ? error.message : String(error) }
        }
        return { ok: true, patchPath: patchPath(), error: null }
      }
      row = {
        id: 'figma-ui-mcp',
        name: FIGMA_MCP_PLUGIN,
        config: {
          transport: 'stdio',
          serverName: 'figma-ui',
          command: 'node',
          args: [FIGMA_WRITE_BIN],
          // The facade pins each read/write to one Figma file; the pinned
          // session id lives in this state file (figma_files writes it).
          env: { SIGHT_UI_STATE: sightUiStatePath() },
        },
      }
      try {
        const patch = readPatch()
        let found = findFigmaRow(patch, 'write')
        if (found !== null) {
          const list = Array.isArray(found.insertEntry.insert) ? found.insertEntry.insert : [found.insertEntry.insert]
          list[found.index] = row
          found.insertEntry.insert = list
        } else {
          patch.push({ insert: [row] })
        }
        writePatch(patch)
        return { ok: true, patchPath: patchPath(), error: null }
      } catch (error) {
        return { ok: false, patchPath: patchPath(), error: error instanceof Error ? error.message : String(error) }
      }
    }

    /** Remove one Figma MCP row. */
    const figmaMcpRemove = (mode: 'read' | 'write'): SightFigmaMcpWriteResult => {
      try {
        const patch = readPatch()
        let found = findFigmaRow(patch, mode)
        while (found !== null) {
          const list = Array.isArray(found.insertEntry.insert) ? found.insertEntry.insert : [found.insertEntry.insert]
          list.splice(found.index, 1)
          found.insertEntry.insert = list
          found = findFigmaRow(patch, mode)
        }
        writePatch(patch)
        if (mode === 'read') clearSightReadState()
        else clearSightUiState()
        return { ok: true, patchPath: patchPath(), error: null }
      } catch (error) {
        return { ok: false, patchPath: patchPath(), error: error instanceof Error ? error.message : String(error) }
      }
    }

    const handler: ConnectionRpcHandler = async (endpoint, payload) => {
      try {
        switch (endpoint) {
          case SIGHT_RPC.status:
            return ok(await status())
          case SIGHT_RPC.applyReasoning:
            return ok(await applyReasoning())
          case SIGHT_RPC.clearReasoning: {
            const p = payload as Partial<SightReasoningClearRequest>
            return ok(await clearReasoning({
              provider: typeof p.provider === 'string' ? p.provider : '',
              model: typeof p.model === 'string' ? p.model : '',
            }))
          }
          case SIGHT_RPC.probeImage: {
            const p = payload as Partial<SightImageProbeRequest>
            return ok(await probeImage({
              provider: typeof p.provider === 'string' ? p.provider : '',
              model: typeof p.model === 'string' ? p.model : '',
            }))
          }
          case SIGHT_RPC.imageSupport: {
            const p = payload as Partial<SightImageSupportRequest>
            const provider = typeof p.provider === 'string' ? p.provider : ''
            const model = typeof p.model === 'string' ? p.model : ''
            if (provider.length === 0 || model.length === 0) return ok({ image: null })
            try {
              const info = await llm.resolveModelInfo(provider, model)
              return ok({ image: imageAdmitted(info.inputModalities) })
            } catch {
              // An unresolvable route states nothing; admission treats that as refusal.
              return ok({ image: null })
            }
          }
          case SIGHT_RPC.figmaMcpStatus:
            return ok(figmaMcpStatus())
          case SIGHT_RPC.figmaMcpApply: {
            const p = payload as Partial<SightFigmaMcpApplyRequest>
            return ok(await figmaMcpApply(p as SightFigmaMcpApplyRequest))
          }
          case SIGHT_RPC.figmaMcpRemove: {
            const p = payload as Partial<SightFigmaMcpRemoveRequest>
            if (p.mode !== 'read' && p.mode !== 'write') return fail('figmaMcpRemove requires { mode }')
            return ok(figmaMcpRemove(p.mode))
          }
          case SIGHT_RPC.repoDirList: {
            const p = payload as { path?: unknown }
            return ok(listRepoDirs(typeof p.path === 'string' ? p.path : undefined))
          }
          case SIGHT_RPC.figwrightPluginUpdate:
            return ok(await figwrightPluginUpdate())
          case SIGHT_RPC.bridgePluginUpdate:
            return ok(bridgePluginRefresh())
          default:
            return fail(`unknown dsh-sight endpoint "${String(endpoint)}"`)
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    }

    /** Connection's own browser fence when the runtime provides one, else the loopback equivalent. */
    const connectionFence = connection as unknown as { requestRejection?(req: IncomingMessage): number | undefined }
    const reject = typeof connectionFence.requestRejection === 'function'
      ? (req: IncomingMessage): number | undefined => connectionFence.requestRejection?.(req)
      : loopbackRejection

    sightCtx.inject(['webServer'], (webCtx) => {
      const webServer = webCtx.get('webServer') as unknown as {
        register(route: {
          kind: 'prefix'
          path: string
          handler(req: IncomingMessage, res: ServerResponse): Promise<void>
        }): () => void
      }

      webCtx.effect(() => webServer.register({
        kind: 'prefix',
        path: SIGHT_RPC_CHANNEL,
        handler: async (req, res) => {
          const rejection = reject(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          const endpoint = sightEndpoint(req.url)
          if (req.method !== 'POST' || endpoint === undefined) {
            res.writeHead(404)
            res.end()
            return
          }
          if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            res.writeHead(415)
            res.end('content type must be application/json')
            return
          }
          let envelope: { rpcId?: unknown; method?: unknown; payload?: unknown }
          try {
            envelope = JSON.parse(await readSightBody(req)) as typeof envelope
          } catch {
            res.writeHead(400)
            res.end('body is not JSON')
            return
          }
          const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : 'invalid-request'
          if (envelope.method !== endpoint) {
            writeSightJson(res, {
              type: 'server-response',
              rpcId,
              result: fail(`method ${JSON.stringify(String(envelope.method))} does not match endpoint ${JSON.stringify(endpoint)}`),
            })
            return
          }
          try {
            writeSightJson(res, {
              type: 'server-response',
              rpcId,
              result: await handler(endpoint, envelope.payload, SIGHT_NEVER_ABORTED, connection.operator),
            })
          } catch (error) {
            res.writeHead(500)
            res.end(`handler failure: ${String(error)}`)
          }
        },
      }), 'dsh-sight: /sight route')
    })
  })
}
