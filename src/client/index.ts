/**
 * dsh-sight browser half: the settings page ("多模态图片直传") and the composer
 * controls (vision badge + clear-images button). Every Host call goes through
 * the plugin-owned `/sight` loopback RPC channel (`connection.rpc.call`).
 * Plain React.createElement (no JSX), inline styles only.
 * @module dsh-sight/client
 */

import React from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  SIGHT_RPC,
  SIGHT_RPC_CHANNEL,
  type SightApplyReasoningResult,
  type SightClearImagesResult,
  type SightModelEntry,
  type SightReasoningChange,
  type SightReasoningDictionaryEntry,
  type SightSessionImagesResult,
  type SightSetVisionResult,
  type SightStatusResult,
  type SightVisionStatusResult,
} from '../config.ts'

/** Required client services: slot UI + the Connection RPC carrier. */
export const inject = ['slots', 'connection']

/** Module-level client context captured by `apply`, used by the React views. */
let clientCtx: ClientContext

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Call one `/sight` endpoint and unwrap the RPC result. */
async function rpc<T>(connection: ConnectionHandle, endpoint: string, payload: unknown): Promise<T> {
  const result = await connection.rpc.call(SIGHT_RPC_CHANNEL, endpoint, payload) as RpcResult<T>
  if (result.ok) return result.value
  throw new Error(`${result.error.code}: ${result.error.message}`)
}

const BUTTON: CSSProperties = {
  border: '1px solid rgba(128,128,128,0.35)',
  background: 'transparent',
  color: 'inherit',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  cursor: 'pointer',
}
const CHIP_ON: CSSProperties = { borderRadius: 999, padding: '1px 8px', fontSize: 11, background: 'rgba(34,197,94,0.16)', color: '#22c55e', whiteSpace: 'nowrap' }
const CHIP_OFF: CSSProperties = { borderRadius: 999, padding: '1px 8px', fontSize: 11, background: 'rgba(128,128,128,0.14)', color: '#9ca3af', whiteSpace: 'nowrap' }
const CHIP_WARN: CSSProperties = { borderRadius: 999, padding: '1px 8px', fontSize: 11, background: 'rgba(250,204,21,0.16)', color: '#eab308', whiteSpace: 'nowrap' }
const CHIP_INFO: CSSProperties = { borderRadius: 999, padding: '1px 8px', fontSize: 11, background: 'rgba(59,130,246,0.16)', color: '#3b82f6', whiteSpace: 'nowrap' }
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: '1px solid rgba(128,128,128,0.15)', fontSize: 13 }
const GROUP: CSSProperties = { border: '1px solid rgba(128,128,128,0.25)', borderRadius: 8, overflow: 'hidden' }
const GROUP_HEAD: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, borderBottom: '1px solid rgba(128,128,128,0.25)' }

function Chip(props: { tone: 'on' | 'off' | 'warn' | 'info'; children?: ReactNode }): ReactElement {
  const style = props.tone === 'on' ? CHIP_ON : props.tone === 'off' ? CHIP_OFF : props.tone === 'warn' ? CHIP_WARN : CHIP_INFO
  return React.createElement('span', { style }, props.children)
}

function ModelRow(props: { model: SightModelEntry; provider: string; busy: string; onToggle: (p: string, m: string, v: boolean) => void }): ReactElement {
  const { model, provider, busy, onToggle } = props
  const statusChip = model.vision
    ? React.createElement(Chip, { tone: 'on' }, '图片直传已启用')
    : React.createElement(Chip, { tone: 'off' }, '仅文本')
  const dictChip = model.matched !== null
    ? React.createElement(Chip, { tone: 'info' }, `字典匹配: ${model.matched}`)
    : React.createElement(Chip, { tone: 'warn' }, '未匹配')
  const reasoningChip = model.reasoning === null || !model.reasoning.declared
    ? React.createElement(Chip, { tone: 'warn' }, '无推理等级')
    : React.createElement(Chip, { tone: 'info' }, `推理: ${model.reasoning.levels.join('/')}`)
  const working = busy === `${provider}/${model.id}`
  return React.createElement(
    'div',
    { style: ROW },
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: model.id }, model.id),
      React.createElement('div', { style: { fontSize: 11, opacity: 0.6 } }, model.name),
    ),
    statusChip,
    dictChip,
    reasoningChip,
    React.createElement(
      'button',
      { type: 'button', style: BUTTON, disabled: busy !== '' || working, onClick: () => onToggle(provider, model.id, !model.vision) },
      working ? '处理中…' : model.vision ? '取消直传标记' : '启用图片直传',
    ),
  )
}

function SightPage(): ReactElement {
  const [data, setData] = React.useState<SightStatusResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState('')
  const [reasoningResult, setReasoningResult] = React.useState<SightApplyReasoningResult | null>(null)

  const load = React.useCallback(() => {
    rpc<SightStatusResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.status, {})
      .then(value => { setData(value); setError(null) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  React.useEffect(() => { load() }, [load])

  const toggle = (provider: string, model: string, vision: boolean): void => {
    if (busy !== '') return
    setBusy(`${provider}/${model}`)
    rpc<SightSetVisionResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.setVision, { provider, model, vision })
      .then(() => load())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(''))
  }

  const applyDictionary = (): void => {
    if (busy !== '') return
    setBusy('apply')
    rpc(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.applyDictionary, {})
      .then(() => load())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(''))
  }

  const applyReasoning = (): void => {
    if (busy !== '') return
    setBusy('reasoning')
    rpc<SightApplyReasoningResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.applyReasoning, {})
      .then(value => { setReasoningResult(value); load() })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(''))
  }

  const children: ReactNode[] = []
  children.push(React.createElement('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, '多模态图片直传 (Sight)'))
  children.push(React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.75, lineHeight: 1.6 } },
    '在输入框粘贴或拖入的图片会以原生图片内容直接发送给多模态模型（不经文本转换）。' +
    '下方可逐个模型声明「支持图片」，或一键应用字典匹配。' +
    '新增第三方渠道后，「自动补推理等级」会按模型家族写入其支持的推理档位（reasoningEfforts）。' +
    '声明写入 llm-pi-ai 配置，下次请求即生效。'))
  children.push(React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
    React.createElement('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: applyDictionary },
      busy === 'apply' ? '应用中…' : '一键应用字典匹配'),
    React.createElement('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: applyReasoning },
      busy === 'reasoning' ? '补档中…' : '自动补推理等级'),
    React.createElement('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: load }, '刷新'),
  ))

  if (error !== null) {
    children.push(React.createElement('div', { style: { color: '#ef4444', fontSize: 12, whiteSpace: 'pre-wrap' } }, error))
  }

  if (reasoningResult !== null) {
    const lines: ReactNode[] = []
    lines.push(React.createElement('div', { style: { fontSize: 12, fontWeight: 600 } },
      `自动补推理等级完成：${reasoningResult.applied} 个模型，${reasoningResult.providers} 个渠道。`))
    if (Array.isArray(reasoningResult.changes) && reasoningResult.changes.length > 0) {
      lines.push(React.createElement('div', { style: { fontSize: 12, opacity: 0.75, marginTop: 4 } },
        ...reasoningResult.changes.flatMap((change: SightReasoningChange, index: number) => [
          React.createElement('div', { key: `c${index}` },
            `· ${change.provider}/${change.model} → ${change.family} [${change.efforts.map(e => e.wire || e.level).join(', ')}]`),
        ]),
      ))
    }
    children.push(React.createElement('div', { style: { border: '1px solid rgba(34,197,94,0.35)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#4ade80', background: 'rgba(34,197,94,0.08)' } }, ...lines))
  }

  if (data === null) {
    children.push(React.createElement('div', { style: { fontSize: 12, opacity: 0.65 } }, busy === '' ? '加载中…' : '处理中…'))
  } else {
    const providers = data.providers
    if (Array.isArray(providers) && providers.length > 0) {
      for (const group of providers) {
        const rows = group.models.map((model: SightModelEntry) => React.createElement(ModelRow, {
          key: model.id, model, provider: group.provider, busy, onToggle: toggle,
        }))
        const head = React.createElement('div', { style: GROUP_HEAD },
          React.createElement('span', null, group.name),
          React.createElement('span', { style: { fontSize: 12, opacity: 0.65 } }, group.provider),
        )
        children.push(React.createElement('div', { style: GROUP, key: group.provider },
          head,
          ...(rows.length > 0 ? rows : [React.createElement('div', { style: { ...ROW, fontSize: 12, opacity: 0.65 } }, '该 provider 暂无可用模型')]),
          group.error === null
            ? null
            : React.createElement('div', { style: { color: '#ef4444', fontSize: 12, whiteSpace: 'pre-wrap', padding: '7px 12px' } }, group.error),
        ))
      }
    } else {
      children.push(React.createElement('div', { style: { fontSize: 12, opacity: 0.65 } }, '未发现 llm-pi-ai 配置的 provider。'))
    }
    if (Array.isArray(data.dictionary) && data.dictionary.length > 0) {
      children.push(React.createElement('div', { style: { fontSize: 12, opacity: 0.65 } }, '内置多模态模型字典（正则匹配模型 id）：'))
      children.push(React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
        ...data.dictionary.map(entry => React.createElement(Chip, { key: `${entry.family}${entry.label}`, tone: 'info' }, `${entry.family} (${entry.label})`)),
      ))
    }
    if (Array.isArray(data.reasoningDictionary) && data.reasoningDictionary.length > 0) {
      children.push(React.createElement('div', { style: { fontSize: 12, opacity: 0.65, marginTop: 8 } }, '推理等级字典（正则匹配模型 id → 支持的档位）：'))
      children.push(React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
        ...data.reasoningDictionary.map((entry: SightReasoningDictionaryEntry) =>
          React.createElement(Chip, { key: `${entry.family}${entry.label}`, tone: 'info' },
            `${entry.family} [${entry.efforts.map(e => e.wire || e.level).join(', ')}]`)),
      ))
    }
  }

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 } }, ...children)
}

/** Minimal model-directory shape read from the client runtime. */
interface ModelDirectoryLike {
  directoryFor(id: string): { store: { getSnapshot(): { current: { provider: string; model: string } | null }; subscribe(fn: () => void): () => void } }
}

/** Composer badge: current model accepts direct image input. */
function VisionBadge(props: { sessionId: string }): ReactElement | null {
  const [vision, setVision] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    let alive = true
    let models: ModelDirectoryLike | undefined
    try { models = clientCtx.get('modelDirectories') as unknown as ModelDirectoryLike } catch { models = undefined }
    if (models === undefined) {
      setLoading(false)
      return
    }
    let directory: { store: { getSnapshot(): { current: { provider: string; model: string } | null }; subscribe(fn: () => void): () => void } }
    try { directory = models.directoryFor(props.sessionId) } catch {
      setLoading(false)
      return
    }
    const refresh = (): void => {
      const current = directory.store.getSnapshot().current
      if (current === null || current === undefined) {
        setLoading(false)
        return
      }
      rpc<SightVisionStatusResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.visionStatus, {
        provider: current.provider,
        model: current.model,
      })
        .then(value => { if (alive) { setLoading(false); setVision(value.vision) } })
        .catch(() => { if (alive) { setLoading(false); setVision(false) } })
    }
    refresh()
    let stop = (): void => {}
    try { stop = directory.store.subscribe(refresh) } catch { /* store may be gone */ }
    return () => { alive = false; stop() }
  }, [props.sessionId])

  if (loading || !vision) return null
  return React.createElement('span', {
    style: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', borderRadius: 999, fontSize: 12, background: 'rgba(34,197,94,0.16)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' },
    title: '当前模型支持多模态：粘贴/拖入的图片将直接发送给模型（不经文本转换）',
  },
    React.createElement('span', { 'aria-hidden': true }, '🖼'),
    React.createElement('span', null, '图片直传'),
  )
}

/** Clear-images button: strips images from the MODEL-visible history (surface replace). */
function ClearImagesButton(props: { sessionId: string; session: unknown }): ReactElement | null {
  const [count, setCount] = React.useState<number | null>(null)
  const [phase, setPhase] = React.useState<'idle' | 'confirm' | 'busy' | 'done'>('idle')
  const [error, setError] = React.useState<string | null>(null)

  const fingerprint = React.useMemo(() => {
    const snapshot = props.session as { nodes?: readonly { seq: number }[] } | null | undefined
    const nodes = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.nodes)
      ? snapshot.nodes
      : []
    return nodes.map(node => String(node.seq)).join(',')
  }, [props.session])

  const refresh = React.useCallback(() => {
    rpc<SightSessionImagesResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.sessionImages, { sessionId: props.sessionId })
      .then(value => {
        setCount(value.count)
        if (value.count === 0) setPhase('idle')
      })
      .catch(() => setCount(0))
  }, [props.sessionId])

  React.useEffect(() => {
    setError(null)
    refresh()
  }, [refresh, fingerprint])

  if (count === null || count === 0) return null

  const clear = (): void => {
    if (phase === 'confirm') {
      setPhase('busy')
      setError(null)
      rpc<SightClearImagesResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.clearImages, { sessionId: props.sessionId })
        .then(() => { setPhase('done'); setCount(0) })
        .catch((e: unknown) => {
          setPhase('idle')
          setError(e instanceof Error ? e.message : String(e))
        })
    } else {
      setPhase('confirm')
    }
  }

  const label = phase === 'confirm' ? '确认清除' : phase === 'busy' ? '清除中…' : phase === 'done' ? '已清除 ✓' : `清除图片 (${count})`
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px',
    borderRadius: 999, fontSize: 12, cursor: phase === 'busy' ? 'default' : 'pointer',
    background: phase === 'done' ? 'rgba(34,197,94,0.14)' : phase === 'confirm' ? 'rgba(239,68,68,0.22)' : 'rgba(239,68,68,0.10)',
    color: phase === 'done' ? '#4ade80' : '#f87171',
    border: '1px solid rgba(239,68,68,0.35)', whiteSpace: 'nowrap', opacity: phase === 'busy' ? 0.6 : 1,
  }
  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      style: base,
      disabled: phase === 'busy',
      title: '从模型上下文移除历史图片（界面转录保留），之后即可切换到纯文本模型。再点一次确认。',
      onClick: clear,
      onBlur: () => { if (phase === 'confirm') setPhase('idle') },
    },
      React.createElement('span', { 'aria-hidden': true }, phase === 'done' ? '✓' : '🗑'),
      React.createElement('span', null, label),
    ),
    error === null
      ? null
      : React.createElement('span', { style: { color: '#f87171', fontSize: 12 }, title: error }, '!'),
  )
}

/** Mount the Sight browser surfaces. */
export function apply(ctx: ClientContext): void {
  clientCtx = ctx

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'sight-vision', order: 12, label: () => '多模态图片直传' },
    () => React.createElement(SightPage, null),
  ))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'sight-vision-badge', order: 20 },
    (props: { sessionId: string }) => React.createElement(VisionBadge, { sessionId: props.sessionId }),
  ))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'sight-clear-images', order: 30 },
    (props: { sessionId: string; session: unknown }) => React.createElement(ClearImagesButton, {
      sessionId: props.sessionId,
      session: props.session,
    }),
  ))
}
