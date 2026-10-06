/**
 * Unit tests for the endpoint image-probe classifier.
 *
 * The classifier is the only part of the probe that can be wrong in a way that
 * matters: a false `rejected` tells the user a vision model cannot read images
 * and quietly leaves it disabled, so these tests pin the cases that must stay
 * `inconclusive`.
 * @module dsh-sight/test/image-probe
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyDeclarationNotApplied,
  classifyImageProbeFailure,
  classifyImageProbeSuccess,
  classifyImageProbeUnsendable,
  PROBE_IMAGE_MEDIA_TYPE,
  PROBE_IMAGE_PNG_BASE64,
} from '../src/image-probe.ts'

test('a succeeded image request is supported', () => {
  assert.equal(classifyImageProbeSuccess().verdict, 'supported')
})

test('the probe image is a real 1x1 PNG the attachment normalizer will accept', () => {
  const bytes = Buffer.from(PROBE_IMAGE_PNG_BASE64, 'base64')
  assert.equal(PROBE_IMAGE_MEDIA_TYPE, 'image/png')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature')
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR')
  assert.equal(bytes.readUInt32BE(16), 1, 'width')
  assert.equal(bytes.readUInt32BE(20), 1, 'height')
  // Re-encoding the bytes must reproduce the constant exactly (canonical base64).
  assert.equal(bytes.toString('base64'), PROBE_IMAGE_PNG_BASE64)
})

test('a capability refusal after a working control request is rejected', () => {
  const outcome = classifyImageProbeFailure({
    controlSucceeded: true,
    code: 'INVALID_REQUEST',
    message: 'This model does not support image input.',
  })
  assert.equal(outcome.verdict, 'rejected')
  // The same words *with* the adapter prefix are DSH's own gate, not the
  // endpoint's answer — the discriminator the classifier depends on.
  const local = classifyImageProbeFailure({
    controlSucceeded: true,
    code: 'UNSUPPORTED_CONTENT',
    message: 'pi-ai model "deepseek-v4.1-flash" does not support image input',
  })
  assert.equal(local.verdict, 'inconclusive')
})

test('an unattributable failure stays inconclusive, never rejected', () => {
  // No working control request: the credential, the URL, or the quota may be at
  // fault, so blaming the endpoint would silently disable a vision model.
  const outcome = classifyImageProbeFailure({
    controlSucceeded: false,
    code: 'AUTH',
    message: 'invalid api key',
  })
  assert.equal(outcome.verdict, 'inconclusive')
  assert.match(outcome.detail, /对照请求/)
})

test('transport and quota failures stay inconclusive even with a control request', () => {
  for (const code of ['AUTH', 'INVALID_CREDENTIAL', 'QUOTA', 'ACCOUNT_QUOTA', 'RATE_LIMIT', 'ABORTED', 'CONTEXT_WINDOW_EXCEEDED']) {
    const outcome = classifyImageProbeFailure({
      controlSucceeded: true,
      code,
      // A message that would otherwise read as a capability refusal.
      message: 'unsupported content type',
    })
    assert.equal(outcome.verdict, 'inconclusive', `${code} must not be read as a capability verdict`)
  }
})

test('EMPTY_RESPONSE is not a transport failure — the round trip completed', () => {
  // A thinking model can spend a small output cap entirely on reasoning and
  // return no visible block; the endpoint still accepted the image, so this
  // must not be classified as a refusal.
  const outcome = classifyImageProbeFailure({
    controlSucceeded: true,
    code: 'EMPTY_RESPONSE',
    message: 'the model returned no content blocks',
  })
  assert.equal(outcome.verdict, 'inconclusive', 'EMPTY_RESPONSE is handled as acceptance at the call site')
})

test("DSH's own declaration gate is inconclusive, not a rejection", () => {
  // These are thrown before any byte leaves the machine, so they say nothing
  // about the endpoint.
  for (const message of [
    'pi-ai model "deepseek-v4.1-flash" does not support image input',
    'pi-ai image input requires the durable attachment service',
    'DeepSeek Messages image input requires a vision model and attachment service',
    'model "x" does not declare image input',
    'pi-ai cannot represent an image in an in-history assistant message',
  ]) {
    const outcome = classifyImageProbeFailure({ controlSucceeded: true, code: 'UNSUPPORTED_CONTENT', message })
    assert.equal(outcome.verdict, 'inconclusive', `local gate must not be reported as an endpoint rejection: ${message}`)
  }
})

test('a statement about this probe image is not a capability refusal', () => {
  // "too large" / "could not decode" are about the payload, not the model.
  for (const message of [
    'image too large: maximum 1048576 bytes',
    'failed to decode image data',
    'request body exceeded the limit',
  ]) {
    const outcome = classifyImageProbeFailure({ controlSucceeded: true, code: 'UNKNOWN', message })
    assert.equal(outcome.verdict, 'inconclusive', `payload-level failure must stay inconclusive: ${message}`)
  }
})

test('other phrasings of a capability refusal are still recognised', () => {
  for (const message of [
    'This endpoint does not accept images.',
    'vision is not supported for this model',
    'unsupported modality: image',
    'content type image_url is not allowed',
    'this is a text-only model',
  ]) {
    const outcome = classifyImageProbeFailure({ controlSucceeded: true, code: 'UNKNOWN', message })
    assert.equal(outcome.verdict, 'rejected', `should be rejected: ${message}`)
  }
})

test('a declaration that never reached the adapter is inconclusive', () => {
  const outcome = classifyDeclarationNotApplied(['text'])
  assert.equal(outcome.verdict, 'inconclusive')
  assert.match(outcome.detail, /text/)
  assert.equal(classifyDeclarationNotApplied(undefined).verdict, 'inconclusive')
})

test('an unsendable probe image is inconclusive', () => {
  const outcome = classifyImageProbeUnsendable('no attachment store is mounted')
  assert.equal(outcome.verdict, 'inconclusive')
  assert.match(outcome.detail, /no attachment store/)
})

test('no failure path can report supported', () => {
  const cases = [
    { controlSucceeded: true, code: 'UNKNOWN', message: 'anything at all' },
    { controlSucceeded: false, code: undefined, message: undefined },
    { controlSucceeded: true, code: 'ABORTED', message: undefined },
  ]
  for (const facts of cases) assert.notEqual(classifyImageProbeFailure(facts).verdict, 'supported')
})
