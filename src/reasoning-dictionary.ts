/**
 * The reasoning-effort dictionary: the fallback used to give a hand-added
 * third-party model a `reasoningEfforts` map when nothing else describes its
 * levels.
 *
 * It is a **fallback only**. A route the installed pi-ai catalog describes
 * already carries a `thinkingLevelMap` transcribed from the vendor, and that
 * map is strictly better than anything here: it is per route (the same model id
 * can offer different levels on different relays) and it can express "supported
 * with the adapter's own wire spelling", which a written map cannot. So
 * `applyReasoning` asks the adapter first and only consults this dictionary for
 * models the adapter does not describe.
 *
 * The wire spellings below were transcribed from the installed pi-ai catalog's
 * vendor routes (zai for GLM, deepseek for DeepSeek, moonshotai for Kimi,
 * openai for GPT, google for Gemini). `off: null` is the one level that may
 * leave its wire value empty: pi-ai reads it as "supported, send nothing",
 * which is the correct dispatch where not thinking is the parameter's absence.
 * An **omitted** level is unsupported, so a family whose thinking cannot be
 * turned off (Claude Opus 5 / Fable 5, GLM-5.3) simply omits `off`.
 * @module dsh-sight/reasoning-dictionary
 */

import type { SightReasoningDictionaryEntry } from './config.ts'

/** Wire protocols speaking Anthropic's Messages compat surface. */
const ANTHROPIC_API = ['anthropic-messages'] as const
/** Wire protocols speaking the OpenAI request shape. */
const OPENAI_STYLE_API = ['openai-completions', 'openai-responses'] as const
/** Claude adaptive thinking: the level reaches the wire as `output_config.effort`. */
const ADAPTIVE = { forceAdaptiveThinking: true } as const
/** Adaptive thinking on a model that also rejects `temperature` alongside it. */
const ADAPTIVE_NO_TEMPERATURE = { forceAdaptiveThinking: true, supportsTemperature: false } as const
/** Claude adaptive levels, shared by the models whose thinking cannot be turned off. */
const ADAPTIVE_LEVELS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const

/** One reasoning-effort family preset. */
export interface ReasoningPreset {
  /** Model-id pattern selecting this family. */
  readonly re: RegExp
  /** Human-readable family name shown on the settings page. */
  readonly family: string
  /** Level → wire spelling; `null` (only valid for `off`) means "send nothing". */
  readonly efforts: Readonly<Record<string, string | null>>
  /** Wire protocols this preset's spellings belong to; absent = any. */
  readonly api?: readonly string[]
  /** Compat flags merged into the model's `compat` block alongside the efforts. */
  readonly compat?: Readonly<Record<string, boolean>>
}

/**
 * Reasoning-effort families, matched in order, most specific first.
 *
 * A family is split by minor version wherever the vendor's own routes disagree
 * about the level set (GLM-5.2 and GLM-5.3 do; GPT-5.1 and GPT-5.2+ do), because
 * one regex covering both would have to claim levels one of them lacks.
 */
export const REASONING_DICTIONARY: readonly ReasoningPreset[] = [
  // Anthropic: adaptive thinking (the level is sent as `effort`).
  { re: /^claude-opus-5/, family: 'Claude Opus 5', api: ANTHROPIC_API, efforts: ADAPTIVE_LEVELS, compat: ADAPTIVE_NO_TEMPERATURE },
  { re: /^claude-fable-5/, family: 'Claude Fable 5', api: ANTHROPIC_API, efforts: ADAPTIVE_LEVELS, compat: ADAPTIVE },
  { re: /^claude-sonnet-5/, family: 'Claude Sonnet 5', api: ANTHROPIC_API, efforts: { off: null, ...ADAPTIVE_LEVELS }, compat: ADAPTIVE },
  { re: /^claude-opus-4-[78]/, family: 'Claude Opus 4.7/4.8', api: ANTHROPIC_API, efforts: { off: null, ...ADAPTIVE_LEVELS }, compat: ADAPTIVE_NO_TEMPERATURE },
  { re: /^claude-(opus|sonnet)-4-6/, family: 'Claude 4.6', api: ANTHROPIC_API, efforts: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' }, compat: ADAPTIVE },
  // Anthropic: budget-based thinking (the level picks a token budget).
  { re: /^claude-(opus|sonnet|haiku)-4|^claude-3-7-sonnet/, family: 'Claude 4.x / 3.7', api: ANTHROPIC_API, efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  // OpenAI GPT-6 line.
  { re: /^gpt-6/, family: 'OpenAI GPT-6', api: OPENAI_STYLE_API, efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  // OpenAI GPT-5 line: levels differ per minor version (pi-ai catalog).
  { re: /^gpt-5\.[2-6]/, family: 'OpenAI GPT-5.2+', api: OPENAI_STYLE_API, efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },
  { re: /^gpt-5\.1/, family: 'OpenAI GPT-5.1', api: OPENAI_STYLE_API, efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' } },
  { re: /^gpt-5/, family: 'OpenAI GPT-5', api: OPENAI_STYLE_API, efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' } },
  { re: /^o3/, family: 'OpenAI o-series', api: OPENAI_STYLE_API, efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { re: /^o4/, family: 'OpenAI o-series', api: OPENAI_STYLE_API, efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  // Google Gemini 3: served through OpenAI-shaped relays, so no api restriction.
  { re: /^gemini-3/, family: 'Google Gemini 3', efforts: { low: 'low', medium: 'medium', high: 'high' } },
  { re: /^grok-4/, family: 'xAI Grok 4.x', efforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },
  // DeepSeek V4.1 gained `low`; the vendor's V4 line (pro/flash) is off/high/max.
  { re: /^deepseek-v4\.1/, family: 'DeepSeek V4.1', efforts: { off: null, low: 'low', high: 'high', max: 'max' } },
  { re: /^deepseek-v4/, family: 'DeepSeek V4', efforts: { off: null, high: 'high', max: 'max' } },
  // Zhipu GLM-5: 5.2 spells "off" as `none`, 5.3 cannot turn thinking off at all.
  { re: /^glm-5\.3/, family: 'Zhipu GLM-5.3', efforts: { low: 'low', high: 'high', max: 'max' } },
  { re: /^glm-5\.2/, family: 'Zhipu GLM-5.2', efforts: { off: 'none', high: 'high', max: 'max' } },
  { re: /^glm-5/, family: 'Zhipu GLM-5', efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { re: /^kimi-k3/, family: 'Kimi K3', efforts: { off: null, low: 'low', high: 'high', max: 'max' } },
  { re: /^qwen3/, family: 'Qwen 3', efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { re: /^minimax/, family: 'MiniMax', efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
]

/**
 * First reasoning-dictionary family matching a model id on a route speaking
 * `api`. An unknown api (catalog route without an explicit `api`) does not
 * exclude a preset; a known mismatching api does.
 * @param modelId - the configured model id.
 * @param api - the route's resolved wire protocol, when known.
 * @returns the matching preset, or undefined when no family claims the model.
 */
export function reasoningFamilyOf(modelId: string, api?: string): ReasoningPreset | undefined {
  const id = modelId.toLowerCase()
  for (const entry of REASONING_DICTIONARY) {
    if (!entry.re.test(id)) continue
    if (api !== undefined && entry.api !== undefined && !entry.api.includes(api)) continue
    return entry
  }
  return undefined
}

/**
 * The dictionary as plain JSON for the settings page.
 * @returns one row per family, wire spellings rendered as text.
 */
export function reasoningDictionaryEntries(): readonly SightReasoningDictionaryEntry[] {
  return REASONING_DICTIONARY.map(entry => ({
    family: entry.family,
    label: entry.re.source,
    efforts: Object.entries(entry.efforts).map(([level, wire]) => ({ level, wire: wire ?? '' })),
  }))
}

/** What `applyReasoning` should do with one model. */
export type ReasoningFillDecision =
  /** Write this preset's `reasoningEfforts` (and `compat`, when it has one). */
  | { readonly kind: 'fill'; readonly preset: ReasoningPreset }
  /** Leave the model alone: a map is already declared, or the adapter describes it. */
  | { readonly kind: 'skip'; readonly reason: 'declared' | 'adapter' }
  /** Leave the model alone: no dictionary family claims its id. */
  | { readonly kind: 'unmatched' }

/**
 * Decide one model's fate, in the order the guarantees depend on.
 *
 * A stored `reasoningEfforts` wins first, so a hand-written map — right or
 * wrong — is never overwritten, and the adapter is not even asked. Then the
 * adapter: a route the installed catalog describes already carries the vendor's
 * own `thinkingLevelMap`, and writing the dictionary beside it would *replace*
 * that map (pi-ai replaces, never merges), narrowing the model or inventing
 * levels. Only a model neither layer describes falls through to the dictionary.
 * @param input - the model id, its route's protocol, its stored map, and a resolver for the adapter's own answer.
 * @returns the decision to apply.
 */
export async function decideReasoningFill(input: {
  readonly modelId: string
  readonly api?: string | undefined
  /** The stored `reasoningEfforts` value; anything but `undefined` counts as declared. */
  readonly declaredEfforts: unknown
  /** Asked only when nothing is declared; true when the adapter already describes this model's levels. */
  readonly adapterDescribes: () => Promise<boolean>
}): Promise<ReasoningFillDecision> {
  if (input.declaredEfforts !== undefined) return { kind: 'skip', reason: 'declared' }
  const preset = reasoningFamilyOf(input.modelId, input.api)
  if (preset === undefined) return { kind: 'unmatched' }
  if (await input.adapterDescribes()) return { kind: 'skip', reason: 'adapter' }
  return { kind: 'fill', preset }
}
