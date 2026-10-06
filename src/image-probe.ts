/**
 * Endpoint image-capability probe: the pure decision logic plus the probe image.
 *
 * DSH admits images by *declaration*, never by detection: every gate reads
 * `inputModalities` and fails closed, so a model the catalog does not describe
 * (any self-chosen pi-ai route name) is text-only until someone writes
 * `input: [text, image]`. This module answers the question the declaration
 * cannot: does the endpoint actually accept an image?
 *
 * The verdict is deliberately **tri-state**. A single failed request proves
 * nothing — auth, quota, a wrong base URL, or a relay that mangles the request
 * all look like failures — so a probe only reports `rejected` when a text-only
 * control request over the same route succeeded *and* the failure names a
 * capability rather than a transport problem. Everything else is
 * `inconclusive`, which is the honest answer and the one that must never be
 * mistaken for "no image support".
 * @module dsh-sight/image-probe
 */

import type { SightImageProbeVerdict } from './config.ts'

/** What the probe concluded about one route. */
export type ImageProbeVerdict = SightImageProbeVerdict

/** A verdict plus the evidence behind it, shown beside the verdict in the UI. */
export interface ImageProbeOutcome {
  readonly verdict: ImageProbeVerdict
  /** Human-readable evidence; carries the provider's own words where there are any. */
  readonly detail: string
}

/**
 * A 1×1 RGBA PNG (70 bytes) used as the probe payload.
 *
 * Tiny on purpose: the attachment service normalizes and re-encodes whatever it
 * is given, and every provider's image accounting scales with pixel count, so
 * the cheapest legal image is the one that costs least to send and can least
 * plausibly be refused for its own size.
 */
export const PROBE_IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwaDjwHwAFBAKAPJ4DgAAAAABJRU5ErkJggg=='

/** Media type of {@link PROBE_IMAGE_PNG_BASE64}. */
export const PROBE_IMAGE_MEDIA_TYPE = 'image/png'

/** Instruction sent with the probe image; one short reply keeps the cost at the output cap. */
export const PROBE_PROMPT_TEXT = 'Reply with the single word ok.'

/**
 * Output cap for a probe request.
 *
 * Not 1: a thinking model can spend the whole budget on reasoning and return no
 * visible block, which the adapter reports as `EMPTY_RESPONSE` — a *successful*
 * round trip that would look like a failure. A few tokens make a visible reply
 * likely while keeping the cost negligible. `EMPTY_RESPONSE` is additionally
 * treated as acceptance below, because it still proves the endpoint took the
 * request.
 */
export const PROBE_MAX_TOKENS = 16

/**
 * Provider-neutral failure classes that can never mean "this endpoint refuses
 * images". Routing on these is the runtime's own rule for `HarnessError.code`
 * ("route on this, never by parsing `message`"); the capability question is the
 * one case that has no code of its own, which is why the message is consulted
 * only after these are excluded.
 *
 * `EMPTY_RESPONSE` is deliberately absent: it means the request completed but
 * carried no content block, so the endpoint *did* accept the image. The probe
 * treats it as acceptance at the call site.
 */
const TRANSPORT_CODES: ReadonlySet<string> = new Set([
  'ABORTED',
  'AUTH',
  'INVALID_CREDENTIAL',
  'QUOTA',
  'ACCOUNT_QUOTA',
  'RATE_LIMIT',
  'CONTEXT_WINDOW_EXCEEDED',
  'TIMEOUT',
  'NETWORK',
  'NO_ADAPTER',
])

/**
 * Messages DSH itself emits when its *own* declaration gate refuses the
 * request. Seeing one of these means the bytes never left the machine, so the
 * probe learned nothing about the endpoint and must not report `rejected`.
 *
 * Each alternative keeps the emitting adapter's own prefix. A bare
 * "does not support image input" would also match a provider's refusal — the
 * very verdict this check exists to preserve — so the prefix is what
 * distinguishes our local gate from the endpoint's answer.
 */
const LOCAL_GATE_SIGNAL =
  /pi-ai model "[^"]*" does not support image input|pi-ai image input requires the durable attachment service|pi-ai cannot represent an image|DeepSeek Messages image input requires a vision model|does not declare image input/i

/**
 * Messages that name a capability refusal rather than a transport problem.
 *
 * The negation is required on purpose: a bare `image` match would also catch
 * "image too large" or "image could not be decoded", which are statements about
 * *this* probe image, not about the model.
 */
const CAPABILITY_REFUSAL =
  /(does not|doesn't|cannot|can not|not able to|unable to) (support|accept|allow|handle|process|read|understand)[^.]*\b(image|images|vision|multimodal|modality|content type|media type)\b|(image|images|vision|multimodal|modality|content type|media type)[^.]*\b(not supported|unsupported|not accepted|not allowed|is invalid|is not valid)\b|unsupported (content|media|modality|image)|text[- ]only model/i

/** Render a failure's facts compactly for the detail line. */
function evidence(code: string | undefined, message: string | undefined): string {
  const parts: string[] = []
  if (code !== undefined && code.length > 0) parts.push(code)
  if (message !== undefined && message.length > 0) parts.push(message)
  return parts.length === 0 ? '未提供错误信息' : parts.join(': ')
}

/** The endpoint accepted the probe image. */
export function classifyImageProbeSuccess(): ImageProbeOutcome {
  return { verdict: 'supported', detail: '端点接受了探针图片并正常返回' }
}

/** The probe image could not be sent at all (no attachment store, refused bytes, …). */
export function classifyImageProbeUnsendable(reason: string): ImageProbeOutcome {
  return { verdict: 'inconclusive', detail: `探针图片未能送出：${reason}` }
}

/**
 * The written declaration never reached the adapter, so the image request was
 * refused locally. Reporting this as `rejected` would be a false negative that
 * blames the endpoint for our own stale config.
 * @param modalities - what the adapter reports for the model right now.
 */
export function classifyDeclarationNotApplied(modalities: readonly string[] | undefined): ImageProbeOutcome {
  const seen = modalities === undefined || modalities.length === 0 ? '无模态信息' : modalities.join('/')
  return {
    verdict: 'inconclusive',
    detail: `写入 input 后适配器仍报告「${seen}」，图片请求在本地即被拒绝，未能验证端点`,
  }
}

/**
 * Classify one failed image request.
 * @param facts - whether the control request succeeded, and the terminal failure's code and message.
 * @returns the verdict and the evidence behind it.
 */
export function classifyImageProbeFailure(facts: {
  /** True when a text-only request over the same route already succeeded. */
  readonly controlSucceeded: boolean
  /** Provider-neutral failure class from the terminal finish chunk, when there was one. */
  readonly code?: string | undefined
  /** The provider's or adapter's own words. */
  readonly message?: string | undefined
}): ImageProbeOutcome {
  const shown = evidence(facts.code, facts.message)
  // Without a working control request, a failure is unattributable: it could be
  // the credential, the base URL, the quota, or the image. Say so instead of
  // guessing, because a wrong `rejected` silently disables a vision model.
  if (!facts.controlSucceeded) {
    return { verdict: 'inconclusive', detail: `纯文本对照请求就失败了（${shown}），无法归因于图片` }
  }
  if (facts.code !== undefined && TRANSPORT_CODES.has(facts.code)) {
    return { verdict: 'inconclusive', detail: `失败与内容无关（${shown}）` }
  }
  if (facts.message !== undefined && LOCAL_GATE_SIGNAL.test(facts.message)) {
    return { verdict: 'inconclusive', detail: `请求在本地被 DSH 的声明门拦下（${shown}），未能验证端点` }
  }
  if (facts.message !== undefined && CAPABILITY_REFUSAL.test(facts.message)) {
    return { verdict: 'rejected', detail: `端点明确拒绝了图片（${shown}）` }
  }
  return { verdict: 'inconclusive', detail: `端点返回了无法归因的失败（${shown}）` }
}
