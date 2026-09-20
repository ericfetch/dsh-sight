/**
 * dsh-sight browser half: the settings page (reasoning-effort declarations)
 * and the Figma MCP bridge pages. Every Host call goes through the
 * plugin-owned `/sight` loopback RPC channel (`connection.rpc.call`).
 * Plain React.createElement (no JSX), inline styles only.
 * @module dsh-sight/client
 */

import React from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  SIGHT_RPC,
  SIGHT_RPC_CHANNEL,
  type SightApplyReasoningResult,
  type SightBridgePluginUpdateResult,
  type SightDirListing,
  type SightFigmaMcpApplyRequest,
  type SightFigmaMcpRemoveRequest,
  type SightFigmaMcpStatusResult,
  type SightFigmaMcpWriteResult,
  type SightFigwrightPluginUpdateResult,
  type SightModelEntry,
  type SightReasoningChange,
  type SightReasoningDictionaryEntry,
  type SightReadBackend,
  type SightStatusResult,
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

/** Format user-facing error message, giving actionable hints for version mismatches / restart requirements. */
function formatErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('unknown dsh-sight endpoint')) {
    return '检测到插件已更新，但后端服务尚未重新加载。请完全退出并重启 DSH Desktop 客户端以生效。'
  }
  return msg
}

function Chip(props: { tone: 'on' | 'off' | 'warn' | 'info'; children?: ReactNode }): ReactElement {
  const style = props.tone === 'on' ? CHIP_ON : props.tone === 'off' ? CHIP_OFF : props.tone === 'warn' ? CHIP_WARN : CHIP_INFO
  return React.createElement('span', { style }, props.children)
}

/** Inline host-backed directory browser for picking the figwright repo root. */
function RepoDirPicker(props: { value: string; onPick: (path: string) => void; onClose: () => void }): ReactElement {
  const [path, setPath] = React.useState<string | null>(null)
  const [parent, setParent] = React.useState<string | null>(null)
  const [dirs, setDirs] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [pickError, setPickError] = React.useState<string | null>(null)
  const [jump, setJump] = React.useState('')

  const browse = React.useCallback((target: string | undefined): void => {
    setBusy(true)
    setPickError(null)
    rpc<SightDirListing>(
      clientCtx.get('connection') as unknown as ConnectionHandle,
      SIGHT_RPC.repoDirList,
      target === undefined || target.trim().length === 0 ? {} : { path: target.trim() },
    )
      .then(listing => {
        setPath(listing.path)
        setParent(listing.parent)
        setDirs([...listing.dirs])
        setPickError(listing.error)
      })
      .catch((e: unknown) => setPickError(formatErrorMessage(e)))
      .finally(() => setBusy(false))
  }, [])

  // Start where the field currently points, or at the home directory.
  React.useEffect(() => {
    browse(props.value)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const basename = (dir: string): string => dir.split(/[\\/]/).filter(part => part.length > 0).pop() ?? dir
  const dirRows = dirs.length === 0
    ? [React.createElement('div', { key: 'empty', style: { fontSize: 12, opacity: 0.6, padding: '6px 0' } }, '（没有子目录）')]
    : dirs.map(dir => React.createElement('div', {
        key: dir,
        title: dir,
        onClick: () => { if (!busy) browse(dir) },
        style: {
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
          background: dir === props.value ? 'rgba(59,130,246,0.14)' : 'transparent',
        },
      },
        React.createElement('span', { style: { opacity: 0.7 } }, '📁'),
        React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, basename(dir)),
        dir === props.value ? React.createElement('span', { style: { color: '#60a5fa', fontSize: 11 } }, '当前') : null,
      ))

  const inputStyle: CSSProperties = {
    flex: 1, minWidth: 0, border: '1px solid rgba(128,128,128,0.35)', background: 'rgba(0,0,0,0.18)',
    color: 'inherit', borderRadius: 4, padding: '5px 8px', fontSize: 12, fontFamily: 'monospace',
  }
  return React.createElement('div', {
    style: { border: '1px solid rgba(59,130,246,0.35)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(59,130,246,0.05)' },
  },
    React.createElement('div', { style: { fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 } },
      React.createElement('span', { style: { flex: 1 } }, '选择项目根目录'),
      parent !== null
        ? React.createElement('button', { type: 'button', style: { ...BUTTON, padding: '1px 8px', fontSize: 11 }, disabled: busy, onClick: () => browse(parent) }, '⬆ 上一级')
        : null,
    ),
    React.createElement('div', { style: { fontSize: 11, opacity: 0.75, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 } }, path ?? '加载中…'),
    React.createElement('div', { style: { display: 'flex', gap: 6 } },
      React.createElement('input', {
        type: 'text', value: jump, spellCheck: false, placeholder: '或直接输入绝对路径后回车', style: inputStyle,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setJump(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && !busy) browse(jump.trim()) },
      }),
      React.createElement('button', { type: 'button', style: BUTTON, disabled: busy || jump.trim().length === 0, onClick: () => browse(jump.trim()) }, '前往'),
    ),
    React.createElement('div', { style: { maxHeight: 200, overflowY: 'auto', border: '1px solid rgba(128,128,128,0.15)', borderRadius: 4, padding: '4px', display: 'flex', flexDirection: 'column', gap: 1 } }, ...dirRows),
    pickError !== null
      ? React.createElement('div', { style: { fontSize: 11, color: '#f87171' } }, pickError)
      : null,
    React.createElement('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      React.createElement('button', { type: 'button', style: BUTTON, disabled: busy || path === null, onClick: () => { if (path !== null) props.onPick(path) } },
        busy ? '读取中…' : `选择此目录${path !== null ? `（${basename(path)}）` : ''}`),
      React.createElement('button', { type: 'button', style: BUTTON, disabled: busy, onClick: props.onClose }, '取消'),
    ),
  )
}

function ModelRow(props: { model: SightModelEntry }): ReactElement {
  const { model } = props
  const reasoningChip = model.reasoning === null
    ? React.createElement(Chip, { tone: 'warn' }, '无推理等级')
    : model.reasoning.source === 'declared'
      ? React.createElement(Chip, { tone: 'info' }, `推理(声明): ${model.reasoning.levels.join('/')}`)
      : React.createElement(Chip, { tone: 'on' }, `推理: ${model.reasoning.levels.join('/')}`)
  return React.createElement(
    'div',
    { style: ROW },
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: model.id }, model.id),
      React.createElement('div', { style: { fontSize: 11, opacity: 0.6 } }, model.name),
    ),
    reasoningChip,
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
      .catch((e: unknown) => setError(formatErrorMessage(e)))
  }, [])

  React.useEffect(() => { load() }, [load])

  const applyReasoning = (): void => {
    if (busy !== '') return
    setBusy('reasoning')
    rpc<SightApplyReasoningResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.applyReasoning, {})
      .then(value => { setReasoningResult(value); load() })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
      .finally(() => setBusy(''))
  }

  const children: ReactNode[] = []
  children.push(React.createElement('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, '模型推理等级 (Sight)'))
  children.push(React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.75, lineHeight: 1.6 } },
    '新增第三方渠道后，「自动补推理等级」会按模型家族写入其支持的推理档位（reasoningEfforts），' +
    '模型选择器随即出现这些档位。声明写入 llm-pi-ai 配置，下次请求即生效。'))
  children.push(React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
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
          key: model.id, model,
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

/** Independent settings page for the Figma MCP bridge (own sidebar entry). */
function FigmaMcpPage(): ReactElement {
  const [status, setStatus] = React.useState<SightFigmaMcpStatusResult | null>(null)
  const [busy, setBusy] = React.useState('')
  const [readMessage, setReadMessage] = React.useState<string | null>(null)
  const [writeMessage, setWriteMessage] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // Engine controls for the read-only design-to-code facade.
  const [backend, setBackend] = React.useState<SightReadBackend>('figma-ui-mcp')
  const [repoDir, setRepoDir] = React.useState('')
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [fwMessage, setFwMessage] = React.useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [bridgeMessage, setBridgeMessage] = React.useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const load = React.useCallback(() => {
    rpc<SightFigmaMcpStatusResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.figmaMcpStatus, {})
      .then(value => { setStatus(value); setError(null) })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
  }, [])

  React.useEffect(() => { load() }, [load])

  // Seed the engine + directory controls from the latest backend status.
  React.useEffect(() => {
    const read = status?.read
    if (read === undefined) return
    setBackend(read.backend)
    setRepoDir(read.repoDir ?? '')
  }, [status])

  const engineLabel = backend === 'figwright' ? 'figwright' : 'figma-ui-mcp'

  const applyRead = (): void => {
    if (busy !== '') return
    setBusy('read')
    setReadMessage(null); setError(null)
    const wasConfigured = status?.read?.configured === true
    const req: SightFigmaMcpApplyRequest = { mode: 'read', backend, repoDir: repoDir.trim() }
    rpc<SightFigmaMcpWriteResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.figmaMcpApply, req)
      .then(value => {
        if (!value.ok) {
          setReadMessage(`写入失败: ${value.error ?? 'unknown'}`)
        } else {
          const pluginHint = backend === 'figwright'
            ? '请确认 Figma Desktop 中已运行「Figwright」插件(Connected)。'
            : '请确认 Figma Desktop 中已运行「Figma UI MCP Bridge (Sight)」插件(绿点)。'
          setReadMessage(
            `${wasConfigured ? '引擎设置已保存' : '已启用'}(${engineLabel}引擎)。工具列表会即时刷新,当前对话即可使用新工具;若未刷新,重启 DSH Desktop 即生效。${pluginHint}`,
          )
        }
        load()
      })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
      .finally(() => setBusy(''))
  }

  const removeRead = (): void => {
    if (busy !== '') return
    setBusy('read')
    setReadMessage(null); setError(null)
    const req: SightFigmaMcpRemoveRequest = { mode: 'read' }
    rpc<SightFigmaMcpWriteResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.figmaMcpRemove, req)
      .then(value => { setReadMessage(value.ok ? '已停用。' : `移除失败: ${value.error ?? 'unknown'}`); load() })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
      .finally(() => setBusy(''))
  }

  const applyWrite = (): void => {
    if (busy !== '') return
    setBusy('write')
    setWriteMessage(null); setError(null)
    const req: SightFigmaMcpApplyRequest = { mode: 'write' }
    rpc<SightFigmaMcpWriteResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.figmaMcpApply, req)
      .then(value => { setWriteMessage(value.ok ? '已启用，请重启 DSH Desktop 生效。' : `写入失败: ${value.error ?? 'unknown'}`); load() })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
      .finally(() => setBusy(''))
  }

  const removeWrite = (): void => {
    if (busy !== '') return
    setBusy('write')
    setWriteMessage(null); setError(null)
    const req: SightFigmaMcpRemoveRequest = { mode: 'write' }
    rpc<SightFigmaMcpWriteResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.figmaMcpRemove, req)
      .then(value => { setWriteMessage(value.ok ? '已停用。' : `移除失败: ${value.error ?? 'unknown'}`); load() })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
      .finally(() => setBusy(''))
  }

  const children: ReactNode[] = []
  children.push(React.createElement('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, 'Figma MCP'))
  children.push(React.createElement('p', { style: { margin: 0, fontSize: 13, opacity: 0.75, lineHeight: 1.6 } },
    '分两步接入 Figma：先用只读插件读取设计稿生成代码；需要 AI 直接修改画布时，再单独启用写入能力。'))

  if (error !== null) {
    children.push(React.createElement('div', {
      style: {
        color: '#f87171',
        background: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 13,
        lineHeight: 1.5,
      },
    }, error))
  }

  const readCfg = status?.read
  const writeCfg = status?.write
  // The figma-ui plugin manifest ships with the figma-ui-mcp dependency, used
  // by ② and by ①'s figma-ui-mcp engine. The figwright engine's plugin is
  // installed from the project's GitHub release zip (no local manifest path).
  const manifestPath = writeCfg?.manifestPath ?? readCfg?.manifestPath ?? null

  const copyPath = (path: string): void => {
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const copyManifestPath = (): void => {
    if (manifestPath) copyPath(manifestPath)
  }

  /** One-click: download the latest Figwright plugin zip on the host and extract it next to the profile config. */
  const updateFigwrightPlugin = (): void => {
    if (busy !== '') return
    setBusy('plugin')
    setFwMessage(null); setError(null)
    rpc<SightFigwrightPluginUpdateResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.figwrightPluginUpdate, {})
      .then(value => {
        if (!value.ok) {
          setFwMessage({ tone: 'err', text: `下载失败: ${value.error ?? 'unknown'}` })
        } else if (value.upToDate) {
          setFwMessage({ tone: 'ok', text: `已是最新版本 ${value.tag ?? ''}，无需重复下载。` })
        } else {
          setFwMessage({ tone: 'ok', text: `下载完成 ${value.tag ?? ''}：manifest 已解压就绪，在 Figma 中导入一次即可。` })
        }
        load()
      })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
      .finally(() => setBusy(''))
  }

  /**
   * Rebuild the patched Figma UI MCP Bridge copy: the host copies the installed
   * upstream plugin and re-applies the per-file session patch (needed after a
   * figma-ui-mcp upgrade, or when the copy was imported from an older path).
   */
  const rebuildBridgePlugin = (): void => {
    if (busy !== '') return
    setBusy('bridge')
    setBridgeMessage(null); setError(null)
    rpc<SightBridgePluginUpdateResult>(clientCtx.get('connection') as unknown as ConnectionHandle, SIGHT_RPC.bridgePluginUpdate, {})
      .then(value => {
        if (value.ok) {
          setBridgeMessage({ tone: 'ok', text: `副本已生成（上游 ${value.upstreamVersion ?? 'unknown'}）：用上面的路径在 Figma 中重新导入一次即可。` })
        } else {
          setBridgeMessage({ tone: 'err', text: `生成失败: ${value.error ?? 'unknown'}` })
        }
        load()
      })
      .catch((e: unknown) => setError(formatErrorMessage(e)))
      .finally(() => setBusy(''))
  }

  // ── 公共卡片: Figma 桌面端插件安装（按引擎选择，可同时安装） ──────
  children.push(React.createElement('div', { style: { ...GROUP, background: 'rgba(128,128,128,0.04)' } },
    React.createElement('div', { style: GROUP_HEAD },
      React.createElement('span', null, 'Figma 桌面端插件安装'),
      React.createElement('span', { style: { fontSize: 11, opacity: 0.6 } }, '两个后端插件 · 可同时安装'),
    ),
    React.createElement('div', { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 } },
      React.createElement('div', { style: { fontSize: 12, opacity: 0.8, lineHeight: 1.6 } },
        '「设计稿 → 代码」的两种底层引擎与「AI 主动设计」各自使用独立的本地桥接插件，互不冲突、可同时安装；在 Figma 中运行哪个，取决于当前要用的能力（①的引擎选择、②）。'),
      React.createElement('div', { style: { fontSize: 12, opacity: 0.9, lineHeight: 1.7, background: 'rgba(128,128,128,0.08)', borderRadius: 6, padding: '10px 12px', border: '1px solid rgba(128,128,128,0.18)' } },
        React.createElement('div', { style: { fontWeight: 600 } }, '插件 A — Figma UI MCP Bridge (Sight)（用于 ① 原引擎 / ② AI 主动设计）'),
        React.createElement('div', { style: { marginTop: 4 } }, '① 打开 ', React.createElement('b', null, 'Figma 桌面客户端'), '（网页版无法连接本地 localhost）'),
        React.createElement('div', null, '② 顶部菜单：Plugins → Development → Import plugin from manifest...'),
        React.createElement('div', null, '③ 导入下方插件清单文件：'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, background: 'rgba(0,0,0,0.15)', borderRadius: 4, padding: '6px 8px' } },
          React.createElement('div', { style: { fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', flex: 1, opacity: 0.85 } },
            manifestPath ?? '（正在检测插件路径…）'),
          manifestPath !== null
            ? React.createElement('button', {
                type: 'button',
                style: { ...BUTTON, padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 24 },
                onClick: copyManifestPath,
              }, copied ? '已复制 ✓' : '复制路径')
            : null,
        ),
        React.createElement('div', { style: { marginTop: 6 } }, '④ 在 Figma 中运行「', React.createElement('b', null, 'Figma UI MCP Bridge (Sight)'), '」插件，看到绿点即已成功连接。'),
        (() => {
          const bp = writeCfg?.bridgePlugin ?? readCfg?.bridgePlugin ?? null
          const bs = writeCfg?.bridgeServer ?? readCfg?.bridgeServer ?? null
          const rows: ReactNode[] = []
          rows.push(React.createElement('div', { key: 'state', style: { marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            React.createElement(Chip, { tone: bp?.patched === true ? 'on' : 'warn' },
              bp?.patched === true ? `多文件路由补丁 ${bp.upstreamVersion ?? ''}` : '未打多文件路由补丁'),
            React.createElement(Chip, { tone: bs?.patched === true ? 'on' : 'warn' },
              bs?.patched === true ? '服务端入口已补丁' : '服务端入口未补丁'),
            React.createElement('button', {
              type: 'button',
              style: { ...BUTTON, padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 24 },
              disabled: busy !== '',
              onClick: rebuildBridgePlugin,
            }, busy === 'bridge' ? '生成中…' : '重新生成副本'),
          ))
          rows.push(React.createElement('div', { key: 'why', style: { marginTop: 4, fontSize: 11, opacity: 0.6, lineHeight: 1.5 } },
            '这个副本给每个 Figma 文件一个独立的桥接会话：同时开着多个文件时，读写锁定到指定文件，而不是随缘落笔（上游插件不报身份，所有文件共用一条队列，写入可能落到另一个文件）。'))
          if (bp?.patched === false && bp.error !== null) {
            rows.push(React.createElement('div', { key: 'err', style: { marginTop: 4, fontSize: 11, color: '#eab308', lineHeight: 1.5 } },
              `补丁未生成：${bp.error}（当前回退到上游插件，单文件可用）`))
          } else if (bs?.patched === false && bs.error !== null) {
            rows.push(React.createElement('div', { key: 'serr', style: { marginTop: 4, fontSize: 11, color: '#eab308', lineHeight: 1.5 } },
              `服务端入口未补丁：${bs.error}（写入端仍可用，但桥接被其他进程占用时无法锁定文件）`))
          } else if (bp?.patched === true) {
            rows.push(React.createElement('div', { key: 'reimport', style: { marginTop: 4, fontSize: 11, color: '#eab308', lineHeight: 1.5 } },
              'Figma 导入时会复制插件到自己的目录：若之前导入过旧插件，请先删除那一项，再用上面的路径重新导入一次，否则多文件路由不生效。'))
          }
          if (bridgeMessage !== null) {
            rows.push(React.createElement('div', { key: 'msg', style: { marginTop: 4, fontSize: 12, color: bridgeMessage.tone === 'ok' ? '#4ade80' : '#f87171' } }, bridgeMessage.text))
          }
          return rows
        })(),
        React.createElement('div', { style: { fontWeight: 600, marginTop: 12 } }, '插件 B — Figwright（用于 ① 接地引擎，仓库级组件/Token 匹配）'),
        (() => {
          const fwPlugin = readCfg?.figwrightPlugin
          const fwManifest = fwPlugin?.manifestPath ?? null
          const rows: ReactNode[] = []
          if (fwManifest !== null) {
            rows.push(React.createElement('div', { key: 'ready', style: { marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
              React.createElement(Chip, { tone: 'on' }, fwPlugin?.installedTag !== null && fwPlugin?.installedTag !== undefined ? `已就绪 ${fwPlugin.installedTag}` : '已就绪'),
              React.createElement('div', { style: { fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', flex: 1, minWidth: 0, opacity: 0.85 } }, fwManifest),
              React.createElement('button', {
                type: 'button',
                style: { ...BUTTON, padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 24 },
                onClick: () => copyPath(fwManifest),
              }, copied ? '已复制 ✓' : '复制路径'),
            ))
          } else {
            rows.push(React.createElement('div', { key: 'hint', style: { marginTop: 6, fontSize: 12, opacity: 0.85 } },
              '① 一键下载最新版插件 zip 并自动解压（保存在本机配置文件旁，仅保留最新一份）：'))
          }
          rows.push(React.createElement('div', { key: 'actions', style: { marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            React.createElement('button', {
              type: 'button',
              style: { ...BUTTON, whiteSpace: 'nowrap' },
              disabled: busy !== '',
              onClick: updateFigwrightPlugin,
            }, busy === 'plugin' ? '下载中…' : (fwManifest !== null ? '检查并更新' : '一键下载最新版')),
            React.createElement('a', {
              href: 'https://github.com/awdr74100/figwright/releases/latest',
              target: '_blank',
              rel: 'noreferrer',
              style: { ...BUTTON, display: 'inline-block', textDecoration: 'none', whiteSpace: 'nowrap' },
            }, '手动下载（Releases）'),
          ))
          if (fwMessage !== null) {
            rows.push(React.createElement('div', { key: 'msg', style: { marginTop: 6, fontSize: 12, color: fwMessage.tone === 'ok' ? '#4ade80' : '#f87171' } }, fwMessage.text))
          }
          const importStep = fwManifest !== null
            ? '选择上方路径里的 manifest.json'
            : '选择解压目录里的 manifest.json'
          rows.push(React.createElement('div', { key: 'steps', style: { marginTop: 6 } },
            React.createElement('div', null, `② 顶部菜单：Plugins → Development → Import plugin from manifest... ${importStep}`),
            React.createElement('div', { style: { marginTop: 4 } }, '③ 在 Figma 中运行「', React.createElement('b', null, 'Figwright'), '」插件，面板显示 Connected 即已成功连接。'),
          ))
          rows.push(React.createElement('div', { key: 'note', style: { marginTop: 4, fontSize: 11, opacity: 0.6 } },
            'Figma 导入时会复制插件到自己的目录，此副本删除也不影响运行；保留一份最新版只是为了随时可重新导入/升级（上游发新版时再点一次「检查并更新」）。'))
          return rows
        })(),
      ),
      React.createElement('div', { style: { fontSize: 11, opacity: 0.6, lineHeight: 1.5 } },
        '提示：两个插件都只连接本机 127.0.0.1 的桥接服务，不上传任何数据；修改启停或引擎后，按下方提示重启/刷新 DSH。'),
    ),
  ))

  // ── 区块 1: 设计稿 → 代码（本地只读插件，双引擎可切换） ──────────
  const engines: { id: SightReadBackend; label: string; note: string }[] = [
    { id: 'figma-ui-mcp', label: 'figma-ui-mcp', note: '原引擎 · 保留 get_css / export_svg / figma_rules' },
    { id: 'figwright', label: 'figwright', note: '接地引擎 · 扫描本机工程，复用既有组件 / Token / 图标' },
  ]
  children.push(React.createElement('div', { style: { ...GROUP, marginTop: 10 } },
    React.createElement('div', { style: GROUP_HEAD },
      React.createElement('span', null, '① 设计稿 → 代码'),
      React.createElement('span', { style: { fontSize: 11, opacity: 0.6 } }, '安全只读'),
      readCfg === undefined
        ? null
        : readCfg.configured
          ? React.createElement(Chip, { tone: 'on' }, `已启用 · ${readCfg.backend}引擎`)
          : React.createElement(Chip, { tone: 'off' }, '未启用'),
    ),
    React.createElement('div', { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 } },
      React.createElement('div', { style: { fontSize: 12, opacity: 0.8, lineHeight: 1.6 } },
        '让模型读取 Figma 画布并生成前端代码（React/Vue/CSS 等）。严格只读：只能提取图层、样式、Token、截图与仓库匹配信息，绝不修改画布，也不向任何远端发送数据。'),
      React.createElement('div', { style: { fontSize: 12, fontWeight: 600 } }, '底层引擎（随时切换，即时生效）'),
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        ...engines.map(option => {
          const selected = backend === option.id
          return React.createElement('button', {
            key: option.id,
            type: 'button',
            onClick: () => setBackend(option.id),
            style: {
              ...BUTTON,
              flex: '1 1 220px',
              textAlign: 'left',
              padding: '7px 10px',
              borderColor: selected ? 'rgba(59,130,246,0.85)' : 'rgba(128,128,128,0.35)',
              background: selected ? 'rgba(59,130,246,0.12)' : 'transparent',
            },
          },
            React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: selected ? '#60a5fa' : undefined } },
              selected ? `✓ ${option.label}` : option.label),
            React.createElement('div', { style: { fontSize: 11, opacity: 0.65, marginTop: 2 } }, option.note),
          )
        }),
      ),
      backend === 'figwright'
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            React.createElement('div', { style: { fontSize: 12, opacity: 0.8 } },
              '目标代码目录（可选）— 仅本机读取，用于把 Figma 组件/Token/图标匹配到你工程中的实现，不上传任何代码：'),
            React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              React.createElement('input', {
                type: 'text',
                value: repoDir,
                spellCheck: false,
                placeholder: '/Users/you/my-project（可手输，或点「浏览…」选择项目根目录）',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRepoDir(e.target.value),
                style: { flex: 1, minWidth: 0, border: '1px solid rgba(128,128,128,0.35)', background: 'rgba(0,0,0,0.18)', color: 'inherit', borderRadius: 4, padding: '5px 8px', fontSize: 12, fontFamily: 'monospace' },
              }),
              React.createElement('button', { type: 'button', style: { ...BUTTON, whiteSpace: 'nowrap' }, disabled: busy !== '', onClick: () => setPickerOpen(true) }, '浏览…'),
              repoDir !== ''
                ? React.createElement('button', { type: 'button', style: { ...BUTTON, whiteSpace: 'nowrap' }, disabled: busy !== '', onClick: () => setRepoDir('') }, '清除')
                : null,
            ),
            pickerOpen
              ? React.createElement(RepoDirPicker, {
                  value: repoDir,
                  onPick: (picked: string) => { setRepoDir(picked); setPickerOpen(false) },
                  onClose: () => setPickerOpen(false),
                })
              : null,
            React.createElement('div', { style: { fontSize: 11, opacity: 0.6 } },
              '切换引擎后，模型可见的工具列表会立即刷新（当前对话即可使用新工具）；若未刷新，重启 DSH Desktop 即生效。'),
          )
        : React.createElement('div', { style: { fontSize: 11, opacity: 0.6 } },
            '切换引擎后，模型可见的工具列表会立即刷新（当前对话即可使用新工具）；若未刷新，重启 DSH Desktop 即生效。'),
      readMessage !== null
        ? React.createElement('div', { style: { fontSize: 12, color: '#4ade80', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 6, padding: '6px 10px' } }, readMessage)
        : null,
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', { type: 'button', style: BUTTON, disabled: busy !== '' || status === null, onClick: applyRead },
          busy === 'read' ? '配置中…' : (readCfg !== undefined && readCfg.configured ? '保存引擎设置' : '启用')),
        readCfg !== undefined && readCfg.configured
          ? React.createElement('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: removeRead }, '停用')
          : null,
      ),
    ),
  ))

  // ── 区块 2: AI 主动设计（需要 Figma 插件） ──────────────────────────
  children.push(React.createElement('div', { style: { ...GROUP, marginTop: 10 } },
    React.createElement('div', { style: GROUP_HEAD },
      React.createElement('span', null, '② AI 主动设计'),
      React.createElement('span', { style: { fontSize: 11, opacity: 0.6 } }, '完整读写'),
      writeCfg === undefined
        ? null
        : writeCfg.configured
          ? React.createElement(Chip, { tone: 'on' }, '已启用')
          : React.createElement(Chip, { tone: 'off' }, '未启用'),
    ),
    React.createElement('div', { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 } },
      React.createElement('div', { style: { fontSize: 12, opacity: 0.8, lineHeight: 1.6 } },
        '让模型直接在 Figma 画布上自动绘制、批量生成与修改设计。拥有完整读写权限，支持执行画布构建与排版指令。'),
      writeMessage !== null
        ? React.createElement('div', { style: { fontSize: 12, color: '#4ade80', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 6, padding: '6px 10px' } }, writeMessage)
        : null,
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: applyWrite },
          busy === 'write' ? '写入中…' : '启用'),
        writeCfg !== undefined && writeCfg.configured
          ? React.createElement('button', { type: 'button', style: BUTTON, disabled: busy !== '', onClick: removeWrite }, '停用')
          : null,
      ),
      status !== null
        ? React.createElement('div', { style: { fontSize: 11, opacity: 0.5, marginTop: 4 } }, `配置文件: ${status.patchPath}`)
        : null,
    ),
  ))

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 } }, ...children)
}

/** Mount the Sight browser surfaces. */
export function apply(ctx: ClientContext): void {
  clientCtx = ctx

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'sight-models', order: 12, label: () => '模型推理等级' },
    () => React.createElement(SightPage, null),
  ))

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'sight-figma-mcp', order: 13, label: () => 'Figma MCP' },
    () => React.createElement(FigmaMcpPage, null),
  ))
}
