/**
 * dsh-sight Host half: registers the `/sight` loopback RPC channel and serves
 * the six Sight endpoints. Plain cordis plugin (no typert, no Remote
 * descriptors) - the community-standard pattern for standalone dsh plugins.
 *
 * Endpoints:
 * - `status`          -> full provider/model modality overview for the settings page
 * - `setVision`       -> write `input: ['text','image']` into the llm-pi-ai profile
 * - `applyDictionary` -> bulk-declare every configured model matching the dictionary
 * - `visionStatus`    -> cheap per-model vision check for the composer badge
 * - `sessionImages`   -> count image-bearing user messages on the model-visible surface
 * - `clearImages`     -> strip images from the model-visible history via surface replace
 * @module dsh-sight
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as figwrightInstall from './figma-plugin-install.ts'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  SIGHT_RPC,
  SIGHT_RPC_CHANNEL,
  type SightApplyDictionaryResult,
  type SightApplyReasoningResult,
  type SightClearFailure,
  type SightClearImagesResult,
  type SightDirListing,
  type SightFigmaMcpApplyRequest,
  type SightFigmaMcpRemoveRequest,
  type SightFigmaMcpStatusResult,
  type SightFigmaMcpWriteResult,
  type SightFigwrightPluginInfo,
  type SightFigwrightPluginUpdateResult,
  type SightModelEntry,
  type SightProviderEntry,
  type SightReadBackend,
  type SightReasoningChange,
  type SightReasoningDictionaryEntry,
  type SightSessionImagesResult,
  type SightStatusResult,
  type SightVisionStatusResult,
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
 * Resolve the entry script of a Figma MCP server. Both packages ship as
 * dependencies of dsh-sight and stay external in the build so the standalone
 * entry files exist on disk for the mcp-client child processes to spawn.
 * - `figma-read-server`: localhost bridge facade (read-only design-to-code,
 *   dual engine: figma-ui-mcp bridge + figwright child, switched at runtime).
 * - `figma-ui-mcp`: localhost plugin bridge (AI-driven design, read/write).
 */
const figmaServerBin = (pkg: string, rel: readonly string[]): string => {
  try {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve(`${pkg}/package.json`)
    return join(dirname(resolved), ...rel)
  } catch {
    return join(homedir(), 'AppData', 'Local', 'Temp', 'figma-ui-mcp-test', 'node_modules', pkg, ...rel)
  }
}

/** Read-only localhost plugin MCP server entry (design-to-code). */
const FIGMA_READ_BIN = join(dirname(fileURLToPath(import.meta.url)), 'figma-read-server.js')
/** Write-capable localhost plugin bridge server entry. */
const FIGMA_WRITE_BIN = figmaServerBin('figma-ui-mcp', ['server', 'index.js'])

/** Curated dictionary of popular multimodal models (regex against lowercase model ids). */
const VISION_DICTIONARY: readonly { readonly re: RegExp; readonly family: string }[] = [
  { re: /^qwen-vl/, family: 'Qwen-VL' },
  { re: /^qwen2-vl/, family: 'Qwen-VL' },
  { re: /^qwen2\.5-vl/, family: 'Qwen-VL' },
  { re: /^qwen3-vl/, family: 'Qwen-VL' },
  { re: /^qwen2\.5-omni/, family: 'Qwen-Omni' },
  { re: /^qwen3-omni/, family: 'Qwen-Omni' },
  { re: /^qwen-omni/, family: 'Qwen-Omni' },
  { re: /^qwen-turbo/, family: 'Qwen-Turbo' },
  { re: /^gpt-4o/, family: 'OpenAI GPT-4o' },
  { re: /^gpt-4\.1/, family: 'OpenAI GPT-4.1' },
  { re: /^gpt-4-turbo/, family: 'OpenAI GPT-4 Turbo' },
  { re: /^chatgpt-4o/, family: 'OpenAI ChatGPT-4o' },
  { re: /^gpt-5/, family: 'OpenAI GPT-5' },
  { re: /^o4-mini/, family: 'OpenAI o-series' },
  { re: /^o3/, family: 'OpenAI o-series' },
  { re: /^gemini-/, family: 'Google Gemini' },
  { re: /^claude-3-5-/, family: 'Anthropic Claude 3.5' },
  { re: /^claude-3-7-/, family: 'Anthropic Claude 3.7' },
  { re: /^claude-4-/, family: 'Anthropic Claude 4' },
  { re: /^claude-opus-4/, family: 'Anthropic Claude Opus 4' },
  { re: /^claude-sonnet-4/, family: 'Anthropic Claude Sonnet 4' },
  { re: /^claude-haiku-4/, family: 'Anthropic Claude Haiku 4' },
  { re: /^claude-opus-/, family: 'Anthropic Claude Opus' },
  { re: /^claude-sonnet-/, family: 'Anthropic Claude Sonnet' },
  { re: /^claude-haiku-/, family: 'Anthropic Claude Haiku' },
  { re: /^claude-3-/, family: 'Anthropic Claude 3' },
  { re: /^moonshot-v1-.*-vision-preview/, family: 'Kimi (Moonshot)' },
  { re: /^kimi-vl/, family: 'Kimi (Moonshot)' },
  { re: /^glm-4v/, family: 'Zhipu GLM-4V' },
  { re: /^glm-4\.1v/, family: 'Zhipu GLM-4.1V' },
  { re: /^glm-5/, family: 'Zhipu GLM-5' },
  { re: /^doubao-.*vision/, family: 'Doubao Vision' },
  { re: /^deepseek-vl/, family: 'DeepSeek-VL' },
  { re: /^llava/, family: 'LLaVA' },
  { re: /^internvl/, family: 'InternVL' },
  { re: /^phi-3-vision/, family: 'Phi-3 Vision' },
  { re: /^phi-4-multimodal/, family: 'Phi-4 Multimodal' },
  { re: /^pixtral/, family: 'Mistral Pixtral' },
  { re: /^cogvlm/, family: 'CogVLM' },
  { re: /^minicpm-v/, family: 'MiniCPM-V' },
  { re: /^step-1v/, family: 'Step-1V' },
  { re: /^hunyuan-vision/, family: 'Hunyuan Vision' },
  { re: /^nova-/, family: 'Amazon Nova' },
  { re: /^grok-2-vision/, family: 'xAI Grok' },
  { re: /^grok-4/, family: 'xAI Grok' },
  { re: /^qwen3\.7-plus/, family: 'Qwen 3.7 Plus' },
  { re: /^kimi-k3/, family: 'Kimi K3' },
]

/** First dictionary family matching a model id, or undefined. */
function familyOf(modelId: string): string | undefined {
  const id = modelId.toLowerCase()
  for (const entry of VISION_DICTIONARY) {
    if (entry.re.test(id)) return entry.family
  }
  return undefined
}

/**
 * Reasoning-effort dictionary. Keys are the pi-ai canonical thinking levels a
 * hand-declared model may offer; values are the wire spellings sent on the
 * request. The effort vocabulary follows each family's official API docs
 * (DeepSeek: off/high/max; Grok 4.x: low/medium/high/xhigh; GLM-5.2:
 * max/xhigh/high/medium/low/minimal/none; Kimi K3: low/high/max; GPT-5:
 * low/medium/high). Matching a model id to a family here makes `applyReasoning`
 * fill in a missing `reasoningEfforts` block for a freshly-added third-party
 * channel, so the model picker gains its supported reasoning levels without
 * hand-editing settings.
 *
 * `off: null` is the one level that may leave its wire value empty - pi-ai
 * reads it as "supported, send nothing" (thinking left to the provider).
 */
const REASONING_DICTIONARY: readonly { readonly re: RegExp; readonly family: string; readonly efforts: Readonly<Record<string, string | null>> }[] = [
  { re: /^gpt-5/, family: 'OpenAI GPT-5', efforts: { off: null, high: 'high', xhigh: 'xhigh', max: 'max' } },
  { re: /^o3/, family: 'OpenAI o-series', efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { re: /^o4/, family: 'OpenAI o-series', efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { re: /^grok-4/, family: 'xAI Grok 4.x', efforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },
  { re: /^deepseek-v4/, family: 'DeepSeek V4', efforts: { off: null, high: 'high', max: 'max' } },
  { re: /^glm-5/, family: 'Zhipu GLM-5', efforts: { off: null, high: 'high', xhigh: 'xhigh', max: 'max' } },
  { re: /^kimi-k3/, family: 'Kimi K3', efforts: { off: null, low: 'low', high: 'high', max: 'max' } },
  { re: /^qwen3/, family: 'Qwen 3', efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { re: /^minimax/, family: 'MiniMax', efforts: { off: null, high: 'high' } },
]

/** First reasoning-dictionary family matching a model id, or undefined. */
function reasoningFamilyOf(modelId: string): typeof REASONING_DICTIONARY[number] | undefined {
  const id = modelId.toLowerCase()
  for (const entry of REASONING_DICTIONARY) {
    if (entry.re.test(id)) return entry
  }
  return undefined
}

/** Loose raw pi-ai profile shape read from the stored settings layer. */
interface RawProfile {
  readonly displayName?: string
  readonly models?: readonly RawModel[]
  readonly modelOverrides?: Readonly<Record<string, RawModel | undefined>>
}
interface RawModel {
  readonly id: string
  readonly name?: string
  readonly input?: readonly string[]
  readonly reasoningEfforts?: Readonly<Record<string, string | null>> | false
}
interface RawSection {
  readonly providers?: Readonly<Record<string, RawProfile | undefined>>
}

/** Host service surfaces narrowed through the plugin ctx. */
interface SettingsServiceLike {
  describe(): readonly { ns: string; user?: unknown }[]
  get(ns: string): unknown
  mutate(ns: string, ops: readonly SettingsPathOp[]): Promise<void>
}
interface LlmServiceLike {
  listModels(provider: string): Promise<readonly { id: string; name: string }[]>
  resolveModelInfo(provider: string, model: string): Promise<{
    inputModalities?: readonly string[]
    reasoning?: { efforts?: readonly { id?: string; name?: string }[] }
  }>
}
interface AgentsServiceLike {
  get(id: SessionId): Agent | undefined
}

/** RPC success arm. */
function ok(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}
/** RPC failure arm. */
function fail(message: string): RpcResult<unknown> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** Cap for one `/sight` request body: every endpoint carries a small JSON payload. */
const MAX_SIGHT_BODY_BYTES = 1 << 20

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
  ctx.inject(['connection', 'settings', 'llm', 'agents'], (sightCtx) => {
    const connection = sightCtx.get('connection') as unknown as HostConnectionHandle
    const settings = sightCtx.get('settings') as unknown as SettingsServiceLike
    const llm = sightCtx.get('llm') as unknown as LlmServiceLike
    const agents = sightCtx.get('agents') as unknown as AgentsServiceLike

    /** Raw (stored) user section of the llm-pi-ai namespace, or undefined. */
    const rawSection = (): RawSection | undefined => {
      try {
        const descriptor = settings.describe().find(d => d.ns === NS)
        const user = descriptor?.user
        return user !== null && typeof user === 'object' ? user as RawSection : undefined
      } catch {
        return undefined
      }
    }

    /** Whether the raw profile already declares image input for one model. */
    const rawDeclaresImage = (profile: RawProfile | undefined, model: string): boolean => {
      if (profile === undefined) return false
      if (Array.isArray(profile.models)) {
        const entry = profile.models.find(m => m !== null && typeof m === 'object' && m.id === model)
        return Array.isArray(entry?.input) && entry.input.includes('image')
      }
      const override = profile.modelOverrides?.[model]
      return Array.isArray(override?.input) && override.input.includes('image')
    }

    /** Whether the raw profile already declares a reasoning-effort map for one model. */
    const rawDeclaresReasoning = (profile: RawProfile | undefined, model: string): boolean => {
      if (profile === undefined) return false
      if (Array.isArray(profile.models)) {
        const entry = profile.models.find(m => m !== null && typeof m === 'object' && m.id === model)
        const efforts = entry?.reasoningEfforts
        return efforts !== undefined && efforts !== false && efforts !== null
      }
      const override = profile.modelOverrides?.[model]
      const efforts = override?.reasoningEfforts
      return efforts !== undefined && efforts !== false && efforts !== null
    }

    /** Write the vision declaration for one model into the llm-pi-ai user section. */
    const writeModelVision = async (provider: string, model: string, vision: boolean): Promise<void> => {
      const profile = rawSection()?.providers?.[provider]
      if (profile === undefined || typeof profile !== 'object') {
        throw new Error(`provider "${provider}" is not configured under ${NS}`)
      }
      const rawModels = Array.isArray(profile.models) ? profile.models : undefined
      const ops: SettingsPathOp[] = []
      if (rawModels !== undefined) {
        const target = rawModels.find(m => m !== null && typeof m === 'object' && m.id === model)
        if (target === undefined) throw new Error(`model "${model}" is not listed in provider "${provider}" models`)
        const next = rawModels.map(m => {
          if (m === null || typeof m !== 'object' || m.id !== model) return m
          if (vision) return { ...m, input: ['text', 'image'] }
          const { input: _dropped, ...rest } = m
          return rest
        })
        ops.push({ op: 'set', path: ['providers', provider, 'models'], value: next })
      } else if (vision) {
        ops.push({ op: 'set', path: ['providers', provider, 'modelOverrides', model, 'input'], value: ['text', 'image'] })
      } else {
        ops.push({ op: 'unset', path: ['providers', provider, 'modelOverrides', model, 'input'] })
      }
      await settings.mutate(NS, ops)
    }

    /** Full overview for the settings page. */
    const status = async (): Promise<SightStatusResult> => {
      const rawProviders = rawSection()?.providers
      const dictionary = VISION_DICTIONARY.map(entry => ({ family: entry.family, label: entry.re.source }))
      const reasoningDictionary: readonly SightReasoningDictionaryEntry[] = REASONING_DICTIONARY.map(entry => ({
        family: entry.family,
        label: entry.re.source,
        efforts: Object.entries(entry.efforts).map(([level, wire]) => ({ level, wire: wire ?? '' })),
      }))
      const providers: SightProviderEntry[] = []
      const section = settings.get(NS) as { providers?: Readonly<Record<string, RawProfile | undefined>> } | undefined
      const configured = section?.providers
      if (configured !== undefined && typeof configured === 'object') {
        for (const [provider, profile] of Object.entries(configured)) {
          const models: SightModelEntry[] = []
          let error: string | null = null
          try {
            const listed = await llm.listModels(provider)
            models.push(...await Promise.all(listed.map(async (m): Promise<SightModelEntry> => {
              let vision = false
              let adapterReasoning: readonly { id?: string; name?: string }[] | undefined
              try {
                const info = await llm.resolveModelInfo(provider, m.id)
                vision = Array.isArray(info.inputModalities) && info.inputModalities.includes('image')
                adapterReasoning = info.reasoning?.efforts
              } catch {
                vision = false
              }
              const matched = familyOf(m.id)
              const declared = rawDeclaresImage(rawProviders?.[provider], m.id)
              const reasoning = ((): SightModelEntry['reasoning'] => {
                // The adapter's own resolution wins: an installed catalog or the
                // official channel already describes the levels it serves. Only
                // when the adapter reports none do we fall back to a
                // `reasoningEfforts` map declared in the pi-ai settings.
                if (Array.isArray(adapterReasoning)) {
                  const levels = adapterReasoning
                    .map(e => (typeof e?.id === 'string' && e.id.length > 0 ? e.id : undefined))
                    .filter((id): id is string => id !== undefined)
                  if (levels.length > 0) return { source: 'adapter', levels }
                }
                const entry = (rawProviders?.[provider]?.models?.find(x => x !== null && typeof x === 'object' && x.id === m.id))
                  ?? (rawProviders?.[provider]?.modelOverrides?.[m.id])
                const efforts = entry?.reasoningEfforts
                if (efforts !== undefined && efforts !== false && efforts !== null) {
                  return { source: 'declared', levels: Object.keys(efforts) }
                }
                return null
              })()
              return {
                id: m.id,
                name: m.name,
                vision,
                declared,
                matched: matched === undefined ? null : matched,
                source: declared ? 'declared' : vision ? 'adapter' : matched === undefined ? 'none' : 'dictionary',
                reasoning,
              }
            })))
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught)
          }
          providers.push({ provider, name: profile?.displayName ?? provider, models, error })
        }
      }
      // The official DeepSeek channel is a distinct adapter (deepseek-official)
      // configured under the llm-deepseek namespace, not a pi-ai provider. List
      // it as its own group so its models appear on the settings page. Its
      // adapter reports text-only inputModalities, so models render as
      // "text-only" — that is the platform's real capability, not a missing
      // declaration.
      try {
        const deepseekSection = settings.get(DEEPSEEK_NS) as { models?: readonly RawModel[] } | undefined
        const deepseekModels = Array.isArray(deepseekSection?.models) ? deepseekSection.models : []
        if (deepseekModels.length > 0) {
          const models: SightModelEntry[] = await Promise.all(deepseekModels.map(async (dm): Promise<SightModelEntry> => {
            const id = typeof dm?.id === 'string' ? dm.id : ''
            if (id.length === 0) return { id: '', name: '', vision: false, declared: false, matched: null, source: 'none', reasoning: null }
            let vision = false
            let adapterReasoning: readonly { id?: string; name?: string }[] | undefined
            try {
              const info = await llm.resolveModelInfo(DEEPSEEK_PROVIDER, id)
              vision = Array.isArray(info.inputModalities) && info.inputModalities.includes('image')
              adapterReasoning = info.reasoning?.efforts
            } catch {
              vision = false
            }
            const matched = familyOf(id)
            const declared = Array.isArray(dm.input) && dm.input.includes('image')
            const reasoning = ((): SightModelEntry['reasoning'] => {
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
              vision,
              declared,
              matched: matched === undefined ? null : matched,
              source: declared ? 'declared' : vision ? 'adapter' : matched === undefined ? 'none' : 'dictionary',
              reasoning,
            }
          }))
          providers.push({ provider: DEEPSEEK_PROVIDER, name: 'DeepSeek 官方', models, error: null })
        }
      } catch (de) {
        providers.push({ provider: DEEPSEEK_PROVIDER, name: 'DeepSeek 官方', models: [], error: de instanceof Error ? de.message : String(de) })
      }
      return { namespace: NS, dictionary, reasoningDictionary, providers }
    }

    /** Bulk-declare image input for every configured model matching the dictionary. */
    const applyDictionary = async (): Promise<SightApplyDictionaryResult> => {
      const rawProviders = rawSection()?.providers
      if (rawProviders === undefined || typeof rawProviders !== 'object') return { applied: 0, providers: 0 }
      let applied = 0
      let touchedProviders = 0
      for (const [provider, profile] of Object.entries(rawProviders)) {
        if (profile === undefined || typeof profile !== 'object') continue
        const rawModels = Array.isArray(profile.models) ? profile.models : undefined
        if (rawModels !== undefined) {
          let changed = false
          const next = rawModels.map(m => {
            if (m === null || typeof m !== 'object' || typeof m.id !== 'string') return m
            if (familyOf(m.id) === undefined) return m
            if (Array.isArray(m.input) && m.input.includes('image')) return m
            changed = true
            return { ...m, input: ['text', 'image'] }
          })
          if (changed) {
            await settings.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }])
            applied += next.filter(m => m !== null && typeof m === 'object' && Array.isArray(m.input) && m.input.includes('image')).length
            touchedProviders += 1
          }
          continue
        }
        const ops: SettingsPathOp[] = []
        try {
          const models = await llm.listModels(provider)
          for (const m of models) {
            if (familyOf(m.id) === undefined) continue
            const override = profile.modelOverrides?.[m.id]
            if (Array.isArray(override?.input) && override.input.includes('image')) continue
            ops.push({ op: 'set', path: ['providers', provider, 'modelOverrides', m.id, 'input'], value: ['text', 'image'] })
            applied += 1
          }
          if (ops.length > 0) {
            await settings.mutate(NS, ops)
            touchedProviders += 1
          }
        } catch {
          // A model not in the catalog is refused by the namespace validator.
        }
      }
      return { applied, providers: touchedProviders }
    }

    /**
     * Bulk-write a reasoning-effort map for every configured model matching the
     * reasoning dictionary and not yet declaring one. Hand-declared models in a
     * `models` list always gain the dictionary map (they have no other source
     * of reasoning); catalog-backed `modelOverrides` models are filled only when
     * the adapter does not already describe reasoning for them, so an installed
     * catalog's own levels are never overridden. Existing declared maps are
     * left untouched.
     */
    const applyReasoning = async (): Promise<SightApplyReasoningResult> => {
      const rawProviders = rawSection()?.providers
      if (rawProviders === undefined || typeof rawProviders !== 'object') {
        return { applied: 0, providers: 0, changes: [] }
      }
      let applied = 0
      let touchedProviders = 0
      const changes: SightReasoningChange[] = []
      for (const [provider, profile] of Object.entries(rawProviders)) {
        if (profile === undefined || typeof profile !== 'object') continue
        const rawModels = Array.isArray(profile.models) ? profile.models : undefined
        if (rawModels !== undefined) {
          let changed = false
          const next = rawModels.map((m): unknown => {
            if (m === null || typeof m !== 'object' || typeof m.id !== 'string') return m
            if (rawDeclaresReasoning(profile, m.id)) return m
            const match = reasoningFamilyOf(m.id)
            if (match === undefined) return m
            changed = true
            changes.push({
              provider,
              model: m.id,
              family: match.family,
              efforts: Object.entries(match.efforts).map(([level, wire]) => ({ level, wire: wire ?? '' })),
            })
            return { ...m, reasoningEfforts: { ...match.efforts } }
          })
          if (changed) {
            await settings.mutate(NS, [{ op: 'set', path: ['providers', provider, 'models'], value: next }])
            applied += next.filter(m => m !== null && typeof m === 'object'
              && (m as RawModel).reasoningEfforts !== undefined && (m as RawModel).reasoningEfforts !== false).length
            touchedProviders += 1
          }
          continue
        }
        const ops: SettingsPathOp[] = []
        try {
          const models = await llm.listModels(provider)
          for (const m of models) {
            if (rawDeclaresReasoning(profile, m.id)) continue
            const match = reasoningFamilyOf(m.id)
            if (match === undefined) continue
            try {
              const info = await llm.resolveModelInfo(provider, m.id)
              if (info.reasoning !== undefined) continue // adapter already describes reasoning
            } catch {
              // resolution failed: still fill from the dictionary
            }
            ops.push({
              op: 'set',
              path: ['providers', provider, 'modelOverrides', m.id, 'reasoningEfforts'],
              value: { ...match.efforts },
            })
            applied += 1
            changes.push({
              provider,
              model: m.id,
              family: match.family,
              efforts: Object.entries(match.efforts).map(([level, wire]) => ({ level, wire: wire ?? '' })),
            })
          }
          if (ops.length > 0) {
            await settings.mutate(NS, ops)
            touchedProviders += 1
          }
        } catch {
          // A model not in the catalog is refused by the namespace validator.
        }
      }
      return { applied, providers: touchedProviders, changes }
    }

    /** Cheap per-model vision status for the composer badge. */
    const visionStatus = async (provider: string, model: string): Promise<SightVisionStatusResult> => {
      try {
        const info = await llm.resolveModelInfo(provider, model)
        const vision = Array.isArray(info.inputModalities) && info.inputModalities.includes('image')
        const matched = familyOf(model)
        const declared = rawDeclaresImage(rawSection()?.providers?.[provider], model)
        return {
          vision,
          source: declared ? 'declared' : vision ? 'adapter' : matched === undefined ? 'none' : 'dictionary',
          matched: matched === undefined ? null : matched,
        }
      } catch {
        return { vision: false, source: 'unknown', matched: null }
      }
    }

    /** Surface-node seqs of user messages whose model-visible content has an image. */
    const imageNodeSeqs = (session: Session): readonly number[] => {
      const seqs: number[] = []
      const nodes = session.surface.nodes
      const events = session.events
      for (const seq of nodes) {
        const event = events[seq]
        if (event === undefined || event.type !== 'user/message') continue
        const data = event.data
        if (data !== null && typeof data === 'object' && Array.isArray(data.content)
          && data.content.some(block => block !== null && typeof block === 'object'
            && (block as ContentBlock).type === 'image')) {
          seqs.push(seq)
        }
      }
      return seqs
    }

    /** Count of image-bearing user messages on the current model-visible surface. */
    const sessionImages = (sessionId: string): SightSessionImagesResult => {
      const agent = agents.get(sessionId as SessionId)
      if (agent === undefined) return { count: 0 }
      return { count: imageNodeSeqs(agent.session).length }
    }

    /** Strip image blocks; ensure a text block remains. */
    const stripImageBlocks = (content: readonly ContentBlock[]): ContentBlock[] => {
      const kept = content.filter(block => block.type !== 'image')
      if (kept.length === 0) kept.push({ type: 'text', text: '[图片已移除]' })
      return kept
    }

    /**
     * Replace every image-bearing user message on the surface with a stripped
     * copy (one `user/message` event per node, `op: 'replace'`). The original
     * events stay in the log; only the model-visible history changes, so the
     * `session.selectModel` gate passes for text-only models again.
     */
    const clearImages = async (sessionId: string): Promise<SightClearImagesResult> => {
      const agent = agents.get(sessionId as SessionId)
      if (agent === undefined) throw new Error(`session "${sessionId}" is not loaded in this process`)
      const session = agent.session
      const appender = session as unknown as {
        append(type: string, data: unknown, opts: { surfaceOp: unknown; sourceEventSeqs: readonly number[] }): unknown
      }
      const seqs = imageNodeSeqs(session)
      const failures: SightClearFailure[] = []
      let cleared = 0
      for (const seq of seqs) {
        const original = session.events[seq]
        if (original === undefined || original.type !== 'user/message') continue
        const content = stripImageBlocks((original.data as { content: ContentBlock[] }).content)
        const message = {
          id: `sight-clear-${seq}` as `sight-clear-${number}` & string,
          role: 'user' as const,
          content,
          source: { kind: 'user' as const },
        }
        try {
          appender.append('user/message', message, {
            surfaceOp: { op: 'replace', start: seq, end: seq },
            sourceEventSeqs: [seq],
          })
          cleared += 1
        } catch (error) {
          failures.push({ seq, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { cleared, total: seqs.length, failures }
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

    /** Resolve the Figma plugin manifest path for the write bridge (unconditional — the package ships as a dep). */
    const figmaManifestPath = (): string | null => {
      try {
        const require = createRequire(import.meta.url)
        const resolved = require.resolve('figma-ui-mcp/package.json')
        const candidate = join(dirname(resolved), 'plugin', 'manifest.json')
        return existsSync(candidate) ? candidate : null
      } catch {
        return null
      }
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
        const manifest = figmaManifestPath()
        const read = rowStatus(findFigmaRow(patch, 'read'))
        const write = rowStatus(findFigmaRow(patch, 'write'))
        const readEngine = readSightReadState()
        return {
          // figma-ui-mcp: the manifest is the shared dep's plugin (also used by
          // the write row). figwright: the plugin ships via GitHub release zip,
          // so there is no local manifest to point at.
          read: {
            ...read,
            backend: readEngine.backend,
            repoDir: readEngine.repoDir,
            manifestPath: readEngine.backend === 'figma-ui-mcp' ? manifest : null,
            figwrightPlugin: figwrightPluginState(),
          },
          write: {
            ...write,
            backend: 'figma-ui-mcp',
            repoDir: null,
            manifestPath: manifest,
            figwrightPlugin: { installedTag: null, manifestPath: null },
          },
          patchPath: file,
          profile: activeProfile(),
          error: null,
        }
      } catch (error) {
        return {
          read: { configured: false, hasToken: false, manifestPath: null, backend: 'figma-ui-mcp', repoDir: null, figwrightPlugin: { installedTag: null, manifestPath: null } },
          write: { configured: false, hasToken: false, manifestPath: null, backend: 'figma-ui-mcp', repoDir: null, figwrightPlugin: { installedTag: null, manifestPath: null } },
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
          case SIGHT_RPC.setVision: {
            const p = payload as { provider?: unknown; model?: unknown; vision?: unknown }
            if (typeof p.provider !== 'string' || typeof p.model !== 'string' || typeof p.vision !== 'boolean') {
              return fail('setVision requires { provider, model, vision }')
            }
            await writeModelVision(p.provider, p.model, p.vision)
            return ok({ ok: true })
          }
          case SIGHT_RPC.applyDictionary:
            return ok(await applyDictionary())
          case SIGHT_RPC.applyReasoning:
            return ok(await applyReasoning())
          case SIGHT_RPC.visionStatus: {
            const p = payload as { provider?: unknown; model?: unknown }
            if (typeof p.provider !== 'string' || typeof p.model !== 'string') {
              return fail('visionStatus requires { provider, model }')
            }
            return ok(await visionStatus(p.provider, p.model))
          }
          case SIGHT_RPC.sessionImages: {
            const p = payload as { sessionId?: unknown }
            if (typeof p.sessionId !== 'string') return fail('sessionImages requires { sessionId }')
            return ok(sessionImages(p.sessionId))
          }
          case SIGHT_RPC.clearImages: {
            const p = payload as { sessionId?: unknown }
            if (typeof p.sessionId !== 'string') return fail('clearImages requires { sessionId }')
            return ok(await clearImages(p.sessionId))
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
              result: await handler(endpoint, envelope.payload, SIGHT_NEVER_ABORTED),
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
