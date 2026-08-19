/**
 * dsh-sight Host half: registers the `/sight` loopback RPC channel and serves
 * the six Sight endpoints. Plain cordis plugin (no typert, no Remote
 * descriptors) — the community-standard pattern for standalone dsh plugins.
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
import {
  SIGHT_RPC,
  SIGHT_RPC_CHANNEL,
  type SightApplyDictionaryResult,
  type SightClearFailure,
  type SightClearImagesResult,
  type SightModelEntry,
  type SightProviderEntry,
  type SightSessionImagesResult,
  type SightStatusResult,
  type SightVisionStatusResult,
} from './config.ts'

export const name = 'dsh-sight'

/** Settings namespace carrying the pi-ai provider profiles. */
const NS = 'llm-pi-ai'

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
  resolveModelInfo(provider: string, model: string): Promise<{ inputModalities?: readonly string[] }>
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

/**
 * Host half: serve the `/sight` loopback channel. The channel is registered on
 * the Connection service with `authority: 'loopback'`, so only the plugin's
 * own browser half (and any local page) may call it.
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
              try {
                const info = await llm.resolveModelInfo(provider, m.id)
                vision = Array.isArray(info.inputModalities) && info.inputModalities.includes('image')
              } catch {
                vision = false
              }
              const matched = familyOf(m.id)
              const declared = rawDeclaresImage(rawProviders?.[provider], m.id)
              return {
                id: m.id,
                name: m.name,
                vision,
                declared,
                matched: matched === undefined ? null : matched,
                source: declared ? 'declared' : vision ? 'adapter' : matched === undefined ? 'none' : 'dictionary',
              }
            })))
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught)
          }
          providers.push({ provider, name: profile?.displayName ?? provider, models, error })
        }
      }
      return { namespace: NS, dictionary, providers }
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
          default:
            return fail(`unknown dsh-sight endpoint "${String(endpoint)}"`)
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    }

    sightCtx.effect(
      () => connection.rpc.handle(SIGHT_RPC_CHANNEL, handler, { authority: 'loopback' }),
      'dsh-sight: loopback RPC',
    )
  })
}
