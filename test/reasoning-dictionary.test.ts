/**
 * Unit tests for the reasoning-effort dictionary and its matcher.
 *
 * These lock the two things a hand-written dictionary gets wrong silently: the
 * order of the minor-version splits, and the wire spellings that differ from
 * the level name. They cannot check the dictionary against the installed pi-ai
 * catalog — that catalog lives inside the DSH bundle and is not resolvable from
 * this package — which is exactly why `applyReasoning` consults the adapter
 * before it ever reaches for the dictionary.
 * @module dsh-sight/test/reasoning-dictionary
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideReasoningFill,
  REASONING_DICTIONARY,
  reasoningDictionaryEntries,
  reasoningFamilyOf,
  type ReasoningPreset,
} from '../src/reasoning-dictionary.ts'

/** The matched preset, failing the test rather than returning undefined. */
function presetOf(modelId: string, api?: string): ReasoningPreset {
  const preset = reasoningFamilyOf(modelId, api)
  assert.ok(preset !== undefined, `expected a preset for "${modelId}"${api === undefined ? '' : ` on ${api}`}`)
  return preset
}

/** Level → wire, with an omitted level reported as undefined. */
function effortsOf(modelId: string, api?: string): Record<string, string | null | undefined> {
  return { ...presetOf(modelId, api).efforts }
}

test('matches the most specific minor-version family first', () => {
  assert.equal(presetOf('gpt-5.6-sol', 'openai-responses').family, 'OpenAI GPT-5.2+')
  assert.equal(presetOf('gpt-5.1-codex', 'openai-responses').family, 'OpenAI GPT-5.1')
  assert.equal(presetOf('gpt-5-codex', 'openai-responses').family, 'OpenAI GPT-5')
  assert.equal(presetOf('glm-5.3-flash', 'openai-completions').family, 'Zhipu GLM-5.3')
  assert.equal(presetOf('glm-5.2-highspeed', 'openai-completions').family, 'Zhipu GLM-5.2')
  assert.equal(presetOf('glm-5.1', 'openai-completions').family, 'Zhipu GLM-5')
  assert.equal(presetOf('deepseek-v4.1-flash', 'openai-completions').family, 'DeepSeek V4.1')
  assert.equal(presetOf('deepseek-v4-pro', 'openai-completions').family, 'DeepSeek V4')
})

test('an api mismatch excludes a preset; an unknown api does not', () => {
  // A Claude preset must never land on an OpenAI-compatible relay of the same id.
  assert.equal(reasoningFamilyOf('claude-sonnet-5', 'openai-completions'), undefined)
  assert.equal(reasoningFamilyOf('claude-sonnet-5', 'anthropic-messages')?.family, 'Claude Sonnet 5')
  assert.equal(reasoningFamilyOf('claude-sonnet-5')?.family, 'Claude Sonnet 5')
  // o-series speaks the OpenAI shape, so it is excluded everywhere else.
  assert.equal(reasoningFamilyOf('o3-mini', 'anthropic-messages'), undefined)
  assert.equal(reasoningFamilyOf('o3-mini', 'openai-responses')?.family, 'OpenAI o-series')
  // Gemini reaches DSH through OpenAI-shaped relays, so it carries no api gate.
  assert.equal(reasoningFamilyOf('gemini-3.7-flash', 'openai-completions')?.family, 'Google Gemini 3')
})

test('a family whose thinking cannot be turned off omits `off`', () => {
  // Zhipu GLM-5.3 denies `off` at the vendor, so the level must be absent: an
  // omitted level is pinned unsupported, while `off: null` would mean
  // "supported, send nothing".
  const glm53 = effortsOf('glm-5.3-flash', 'openai-completions')
  assert.equal('off' in glm53, false)
  assert.equal(glm53['low'], 'low')
  assert.equal(glm53['high'], 'high')
  assert.equal(glm53['max'], 'max')
  assert.equal('xhigh' in glm53, false, 'GLM never offers xhigh')
  // GLM-5.2 turns thinking off through the literal `none`.
  assert.equal(effortsOf('glm-5.2', 'openai-completions')['off'], 'none')
  // Claude Opus 5 / Fable 5 cannot stop thinking either.
  assert.equal('off' in presetOf('claude-opus-5', 'anthropic-messages').efforts, false)
  assert.equal('off' in presetOf('claude-fable-5', 'anthropic-messages').efforts, false)
  // …while Sonnet 5 can, and sends nothing for it.
  assert.equal(effortsOf('claude-sonnet-5', 'anthropic-messages')['off'], null)
})

test('Claude adaptive presets carry the compat their level needs', () => {
  assert.deepEqual(presetOf('claude-sonnet-5', 'anthropic-messages').compat, { forceAdaptiveThinking: true })
  assert.deepEqual(presetOf('claude-opus-5', 'anthropic-messages').compat, { forceAdaptiveThinking: true, supportsTemperature: false })
  assert.equal(presetOf('claude-opus-4-6', 'anthropic-messages').compat?.forceAdaptiveThinking, true)
})

test('GPT-6 and Gemini 3 are covered; unmapped families stay unmapped', () => {
  assert.equal(effortsOf('gpt-6-sol', 'openai-responses')['off'], 'none')
  assert.equal(effortsOf('gpt-6-sol', 'openai-responses')['max'], 'max')
  assert.deepEqual(presetOf('gemini-3.7-flash').efforts, { low: 'low', medium: 'medium', high: 'high' })
  // A relay-only alias the dictionary has no family for must not be guessed at.
  assert.equal(reasoningFamilyOf('codex-auto-review', 'openai-responses'), undefined)
})

test('every preset satisfies the pi-ai validator it feeds', () => {
  for (const entry of REASONING_DICTIONARY) {
    const levels = Object.entries(entry.efforts)
    assert.ok(levels.length > 0, `${entry.family} declares no level`)
    // pi-ai refuses a map whose only level is `off`.
    assert.ok(levels.some(([level]) => level !== 'off'), `${entry.family} offers no level beyond off`)
    for (const [level, wire] of levels) {
      if (wire === null) {
        assert.equal(level, 'off', `${entry.family}.${level} may not leave its wire value empty`)
        continue
      }
      assert.notEqual(wire.length, 0, `${entry.family}.${level} has an empty wire value`)
    }
  }
})

test('the page rendering spells an empty wire as text', () => {
  const rendered = reasoningDictionaryEntries()
  assert.equal(rendered.length, REASONING_DICTIONARY.length)
  const sonnet = rendered.find(entry => entry.family === 'Claude Sonnet 5')
  assert.ok(sonnet !== undefined)
  assert.equal(sonnet.efforts.find(effort => effort.level === 'off')?.wire, '')
  assert.equal(sonnet.label, '^claude-sonnet-5')
})

test('the adapter outranks the dictionary, so a catalog model is never narrowed', async () => {
  // The live regression this guards: zai-coding-cn/glm-5.3-flash is a catalog
  // model listed in `models`, and the dictionary used to overwrite the vendor's
  // {low, high, max} with {off, high, xhigh, max}.
  let asked = 0
  const decision = await decideReasoningFill({
    modelId: 'glm-5.3-flash',
    api: 'openai-completions',
    declaredEfforts: undefined,
    adapterDescribes: async () => { asked += 1; return true },
  })
  assert.deepEqual(decision, { kind: 'skip', reason: 'adapter' })
  assert.equal(asked, 1)
})

test('a declared map wins and the adapter is never asked', async () => {
  let asked = 0
  const decision = await decideReasoningFill({
    modelId: 'glm-5.3-flash',
    api: 'openai-completions',
    declaredEfforts: { off: null, high: 'high' },
    adapterDescribes: async () => { asked += 1; return true },
  })
  assert.deepEqual(decision, { kind: 'skip', reason: 'declared' })
  assert.equal(asked, 0, 'a stored map must short-circuit before any adapter round-trip')
  // `reasoningEfforts: false` is a declaration too, not a gap to fill.
  const disabled = await decideReasoningFill({
    modelId: 'glm-5.3-flash',
    declaredEfforts: false,
    adapterDescribes: async () => { asked += 1; return false },
  })
  assert.deepEqual(disabled, { kind: 'skip', reason: 'declared' })
})

test('a model only the dictionary describes is filled', async () => {
  const decision = await decideReasoningFill({
    modelId: 'glm-5.3-flash',
    api: 'openai-completions',
    declaredEfforts: undefined,
    adapterDescribes: async () => false,
  })
  assert.equal(decision.kind, 'fill')
  assert.equal(decision.kind === 'fill' ? decision.preset.family : '', 'Zhipu GLM-5.3')
})

test('an unmapped id is reported as unmatched, not guessed at', async () => {
  let asked = 0
  const decision = await decideReasoningFill({
    modelId: 'codex-auto-review',
    api: 'openai-responses',
    declaredEfforts: undefined,
    adapterDescribes: async () => { asked += 1; return false },
  })
  assert.deepEqual(decision, { kind: 'unmatched' })
  assert.equal(asked, 0, 'the adapter is not consulted for an id no family claims')
})
