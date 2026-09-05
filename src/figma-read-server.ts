#!/usr/bin/env node
/**
 * Read-only MCP facade over two local Figma bridges, switchable at runtime.
 *
 * The bridge plugins can write, but this server intentionally exposes only
 * read tools and rejects every non-read operation before it reaches either
 * bridge. Two engines are supported:
 *
 * - `figma-ui-mcp`: the legacy engine. HTTP long-poll BridgeServer on
 *   127.0.0.1 (the "Figma UI MCP Bridge" plugin). Tool surface is the
 *   original three tools: figma_status / figma_read / figma_rules.
 * - `figwright`: the @figwright/mcp server spawned as a child process,
 *   relaying to the "Figwright" plugin over a local WebSocket. Tool surface
 *   is a whitelist of figwright's read + repo-grounding tools
 *   (component_map / token_map / icon_map / design_diff / ...), plus
 *   figma_status mapped onto the child's ping.
 *
 * The active engine is read from a small state file whose absolute path is
 * passed in `SIGHT_READ_STATE` (the mcp-client row's env). When the file
 * changes, the tool registry is swapped and a `notifications/tools/list_changed`
 * notification is sent, so @deepseek-ai/dsh-mcp-client re-syncs the model's
 * tool list without a restart. A missing or malformed state falls back to the
 * `figma-ui-mcp` engine (existing behaviour for current installs).
 *
 * Safety: nothing here ever forwards a write operation. The figwright
 * whitelist below is the only path to the child, and the child's own write /
 * export-to-disk tools are never registered or callable through this server.
 * All traffic is local — no token, no proxy, no external network.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { BridgeServer, CONFIG } from 'figma-ui-mcp/server/bridge-server.js'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import http from 'node:http'

// ── Runtime engine state ────────────────────────────────────────────────────

type ReadBackend = 'figma-ui-mcp' | 'figwright'

interface ReadState {
  readonly backend: ReadBackend
  /** Local repo directory figwright may scan for grounding joins (never uploaded). */
  readonly repoDir: string | null
}

interface CachedState {
  readonly mtimeMs: number
  readonly state: ReadState
}

const DEFAULT_STATE: ReadState = { backend: 'figma-ui-mcp', repoDir: null }
const statePath = process.env.SIGHT_READ_STATE ?? ''
let cachedState: CachedState | null = null

function readState(): ReadState {
  if (statePath.length === 0) return DEFAULT_STATE
  try {
    const st = statSync(statePath)
    if (cachedState !== null && cachedState.mtimeMs === st.mtimeMs) return cachedState.state
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
    const backend: unknown = raw.backend
    const repoDir: unknown = raw.repoDir
    const state: ReadState = {
      backend: backend === 'figwright' ? 'figwright' : 'figma-ui-mcp',
      repoDir: typeof repoDir === 'string' && repoDir.trim().length > 0 ? repoDir : null,
    }
    cachedState = { mtimeMs: st.mtimeMs, state }
    return state
  } catch {
    cachedState = null
    return DEFAULT_STATE
  }
}

// ── figma-ui-mcp engine (legacy read-only bridge) ───────────────────────────

const READ_OPERATIONS = new Set([
  'get_selection', 'get_design', 'get_page_nodes', 'screenshot', 'export_svg',
  'get_styles', 'get_local_components', 'get_viewport', 'get_variables',
  'get_node_detail', 'get_css', 'get_design_context', 'get_component_map',
  'get_unmapped_components', 'export_image', 'search_nodes', 'scan_design',
])

const UI_TOOLS = [
  {
    name: 'figma_status',
    description: 'Check whether the read-only Figma plugin bridge is connected.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'figma_read',
    description: 'Read design data, styles, tokens, components, CSS, SVG, or screenshots from the current Figma canvas. This tool cannot modify the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...READ_OPERATIONS] },
        nodeId: { type: 'string' }, nodeName: { type: 'string' }, scale: { type: 'number' },
        depth: { type: 'string' }, format: { type: 'string' }, detail: { type: 'string' },
        includeHidden: { type: 'boolean' }, sessionId: { type: 'string' },
      },
      required: ['operation'],
    },
  },
  {
    name: 'figma_rules',
    description: 'Read the current Figma file design system: paint styles, variables, typography, and local components.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: [],
    },
  },
] as const

function errorResult(message: string): { isError: true; content: [{ type: 'text'; text: string }] } {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Structural bridge to the SDK's result type for values built by hand. */
function asResult(value: unknown): CallToolResult {
  return value as unknown as CallToolResult
}

function health(): Promise<Record<string, any>> {
  return new Promise(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port: CONFIG.PORT, path: '/health', method: 'GET' }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data) as Record<string, any>) } catch { resolve({ pluginConnected: false }) }
      })
    })
    req.on('error', () => resolve({ pluginConnected: false }))
    req.setTimeout(2000, () => { req.destroy(); resolve({ pluginConnected: false }) })
    req.end()
  })
}

async function createBridge(): Promise<{ bridge: any; proxy: boolean }> {
  const existing = await health()
  if (existing.pluginConnected) {
    return { bridge: {
      port: CONFIG.PORT,
      isPluginConnected: async () => (await health()).pluginConnected === true,
      sendOperation: (operation: string, params: Record<string, any>, sessionId?: string) => postExec(operation, params, sessionId),
      checkHealth: health,
    }, proxy: true }
  }

  const bridge = await new BridgeServer().start() as any
  if (bridge.port !== CONFIG.PORT) {
    const primary = await health()
    if (primary.pluginConnected !== undefined) {
      bridge.stop()
      return { bridge: {
        port: CONFIG.PORT,
        isPluginConnected: async () => (await health()).pluginConnected === true,
        sendOperation: (operation: string, params: Record<string, any>, sessionId?: string) => postExec(operation, params, sessionId),
        checkHealth: health,
      }, proxy: true }
    }
  }
  return { bridge, proxy: false }
}

function postExec(operation: string, params: Record<string, any>, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ operation, params })
    const path = sessionId ? `/exec?sessionId=${encodeURIComponent(sessionId)}` : '/exec'
    const req = http.request({ hostname: '127.0.0.1', port: CONFIG.PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { success?: boolean; data?: any; error?: string }
          if (parsed.success) resolve(parsed.data)
          else reject(new Error(parsed.error ?? 'Bridge error'))
        } catch { reject(new Error('Invalid bridge response')) }
      })
    })
    req.on('error', error => reject(new Error(`Bridge connection failed: ${error.message}`)))
    req.setTimeout(CONFIG.OP_TIMEOUT_MS, () => { req.destroy(); reject(new Error('Bridge timeout')) })
    req.end(payload)
  })
}

/** Lazily created figma-ui BridgeServer handle (kept alive across engine switches). */
let uiBridgePromise: Promise<{ bridge: any; proxy: boolean }> | null = null
function uiEngine(): Promise<{ bridge: any; proxy: boolean }> {
  if (uiBridgePromise === null) uiBridgePromise = createBridge().catch(error => {
    uiBridgePromise = null
    throw error
  })
  return uiBridgePromise
}

// ── figwright engine (child @figwright/mcp, read + grounding whitelist) ─────

/** Raw figwright tools this facade may forward (all read / repo-grounding). */
const FIGW_TOOL_WHITELIST = new Set([
  'get_selection', 'get_document', 'get_node', 'get_nodes_info', 'get_metadata', 'get_pages',
  'search_nodes', 'scan_nodes_by_types', 'scan_text_nodes', 'get_styles', 'get_variable_defs',
  'get_local_components', 'get_component_api', 'get_viewport', 'get_fonts', 'get_annotations',
  'get_reactions', 'get_motion_styles', 'get_node_motion', 'get_design_context', 'get_screenshot',
  'analyze_project', 'scan_components', 'component_map', 'token_map', 'icon_map', 'design_diff',
])

interface McpToolSpec {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: unknown
}

/** Parse plugin-session presence out of a figwright `ping` result. */
function parsePluginConnected(callResult: unknown): boolean {
  try {
    const result = callResult as { content?: unknown[] } | null
    const textBlock = Array.isArray(result?.content)
      ? result?.content.find(block => block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
      : undefined
    const parsed = textBlock !== undefined
      ? JSON.parse((textBlock as { text?: unknown }).text as string) as {
          sessions?: { connectedCount?: unknown }
          pluginConnected?: unknown
        }
      : undefined
    if (parsed === undefined) return true
    if (parsed.pluginConnected === true) return true
    const count = parsed.sessions?.connectedCount
    return typeof count === 'number' && count > 0
  } catch {
    // Unknown payload shape: the server answered, so don't block the call.
    return true
  }
}

class FigwrightEngine {
  private client: Client | null = null
  private spawnedRepoDir: string | null | undefined = undefined
  private specs: McpToolSpec[] = []
  private lastSessionCheckAt = 0
  private sessionConnected = false

  private static entry(): string {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve('@figwright/mcp/package.json')
    const candidate = join(dirname(resolved), 'dist', 'index.mjs')
    if (!existsSync(candidate)) throw new Error(`@figwright/mcp entry missing: ${candidate}`)
    return candidate
  }

  get connected(): boolean {
    return this.client !== null
  }

  /** Whitelisted tool specs, in figwright's advertised order. */
  get tools(): readonly McpToolSpec[] {
    return this.specs
  }

  /**
   * Spawn (or respawn) the child server with the given working directory and
   * re-sync its tool list. Idempotent when nothing changed.
   */
  async ensure(repoDir: string | null): Promise<void> {
    if (this.client !== null && this.spawnedRepoDir === repoDir) return
    await this.close()
    this.spawnedRepoDir = repoDir
    let lastError: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const client = new Client({ name: 'figma-read-figwright', version: '1.0.0' }, { capabilities: {} })
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [FigwrightEngine.entry()],
          ...(repoDir === null ? {} : { cwd: repoDir }),
          stderr: 'inherit',
        })
        await client.connect(transport)
        this.client = client
        this.specs = await this.listTools(client)
        return
      } catch (error) {
        lastError = error
        this.client = null
        this.specs = []
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private async listTools(client: Client): Promise<McpToolSpec[]> {
    const specs: McpToolSpec[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await client.listTools(cursor === undefined ? {} : { cursor })
      for (const tool of page.tools) {
        if (!FIGW_TOOL_WHITELIST.has(tool.name)) continue
        const spec: McpToolSpec = {
          name: tool.name,
          ...(tool.description !== undefined ? { description: tool.description } : {}),
          ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        }
        specs.push(spec)
      }
      cursor = page.nextCursor
      if (cursor === undefined) break
    }
    return specs
  }

  async ping(): Promise<unknown> {
    return this.requireClient().callTool({ name: 'ping', arguments: {} })
  }

  /**
   * Whether the Figma plugin currently holds a relay session. Cached for 2s so
   * a connected engine does not ping on every call, while a drop is detected
   * within the same window. Lets the facade fail fast with guidance instead of
   * waiting out figwright's own long no-session dispatch.
   */
  async hasSession(force = false): Promise<boolean> {
    const now = Date.now()
    if (!force && now - this.lastSessionCheckAt < 2000) return this.sessionConnected
    this.lastSessionCheckAt = now
    if (this.client === null) {
      this.sessionConnected = false
      return false
    }
    try {
      this.sessionConnected = parsePluginConnected(await this.ping())
    } catch {
      this.sessionConnected = false
    }
    return this.sessionConnected
  }

  async call(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    if (!FIGW_TOOL_WHITELIST.has(name)) {
      throw new Error(`figma_read tool "${name}" is not allowed in read-only mode.`)
    }
    const client = this.requireClient()
    if (!(await this.hasSession())) {
      throw new Error("figwright plugin is not connected. Run the 'Figwright' plugin in Figma Desktop first (Plugins → Development → Figwright).")
    }
    return client.callTool({ name, arguments: args ?? {} })
  }

  private requireClient(): Client {
    if (this.client === null) throw new Error('figwright engine is not running.')
    return this.client
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = null
    this.specs = []
    if (client !== null) {
      try { await client.close() } catch { /* best effort */ }
    }
  }
}

const figwright = new FigwrightEngine()

// ── Tool registry (swaps with the active engine) ────────────────────────────

const FIGW_STATUS_TOOL: McpToolSpec = {
  name: 'figma_status',
  description: 'Check whether the read-only figwright bridge is connected, and report the active engine and grounding directory.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}

function buildToolList(mode: ReadBackend, fwSpecs: readonly McpToolSpec[]): McpToolSpec[] {
  if (mode === 'figma-ui-mcp') return [...UI_TOOLS]
  return [FIGW_STATUS_TOOL, ...fwSpecs]
}

let activeTools: McpToolSpec[] = []
/** The engine whose tool list the client last saw (null = nothing listed yet). */
let listedMode: ReadBackend | null = null
let notifyClients: () => void = () => {}

/**
 * Warm the selected engine, rebuild the advertised tool list when needed and
 * notify the client whenever the engine (and therefore the tool surface)
 * flipped. Returns the active engine.
 */
async function refresh(state: ReadState): Promise<ReadBackend> {
  if (state.backend === 'figwright') {
    try { await figwright.ensure(state.repoDir) } catch { /* surfaced on first call */ }
  }
  const want = buildToolList(state.backend, figwright.tools)
  const changed = want.length !== activeTools.length || want.some((tool, index) => tool.name !== activeTools[index]?.name)
  if (changed) activeTools = want
  if (listedMode !== null && listedMode !== state.backend) notifyClients()
  listedMode = state.backend
  return state.backend
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleUiStatus(): Promise<unknown> {
  const { bridge } = await uiEngine()
  const connected = await bridge.isPluginConnected()
  let pluginInfo = null
  if (connected) {
    try { pluginInfo = await bridge.sendOperation('status', {}) } catch { /* transient disconnect */ }
  }
  return {
    engine: 'figma-ui-mcp',
    bridgePort: bridge.port || CONFIG.PORT,
    pluginConnected: connected,
    pluginInfo,
    readOnly: true,
    hint: connected ? 'CONNECTED. Read operations only.' : "Run the 'Figma UI MCP Bridge' plugin in Figma Desktop first.",
  }
}

async function handleFigwrightStatus(repoDir: string | null): Promise<unknown> {
  await figwright.ensure(repoDir)
  let pluginInfo: unknown = null
  let pluginConnected = false
  try {
    pluginInfo = await figwright.ping()
    pluginConnected = parsePluginConnected(pluginInfo)
  } catch {
    pluginInfo = null
    pluginConnected = false
  }
  return {
    engine: 'figwright',
    pluginConnected,
    pluginInfo,
    readOnly: true,
    repoDir,
    hint: pluginConnected
      ? 'CONNECTED. Read + repo-grounding tools only.'
      : "Run the 'Figwright' plugin in Figma Desktop first (Plugins → Development → Figwright).",
  }
}

async function handleUiRead(args: Record<string, any> | undefined): Promise<CallToolResult> {
  const input = (args ?? {}) as Record<string, any>
  const operation = input.operation
  if (typeof operation !== 'string' || !READ_OPERATIONS.has(operation)) {
    return errorResult(`Operation "${String(operation)}" is not allowed in read-only mode.`)
  }
  const { bridge } = await uiEngine()
  if (!(await bridge.isPluginConnected())) {
    return errorResult("Figma read-only plugin is not connected. Run the 'Figma UI MCP Bridge' plugin in Figma Desktop first.")
  }
  const { nodeId, nodeName, scale, depth, format, detail, includeHidden, sessionId, ...searchParams } = input
  const params: Record<string, any> = {}
  if (nodeId) params.id = nodeId
  if (nodeName) params.name = nodeName
  if (scale) params.scale = scale
  if (depth !== undefined) params.depth = depth
  if (format) params.format = format
  if (detail) params.detail = detail
  if (includeHidden !== undefined) params.includeHidden = includeHidden
  if (operation === 'search_nodes') Object.assign(params, searchParams)
  try {
    const data = await bridge.sendOperation(operation, params, sessionId)
    if (operation === 'screenshot' && data?.dataUrl) {
      let image = data.dataUrl as string
      if (image.includes(',')) image = image.split(',')[1] ?? image
      const metadata = { ...data }
      delete metadata.dataUrl
      const content: Array<Record<string, any>> = [{ type: 'image', data: image, mimeType: 'image/png' }]
      if (Object.keys(metadata).length > 0) content.push({ type: 'text', text: JSON.stringify(metadata, null, 2) })
      return asResult({ content })
    }
    return asResult({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }
}

async function handleUiRules(args: Record<string, any> | undefined): Promise<CallToolResult> {
  const { bridge } = await uiEngine()
  if (!(await bridge.isPluginConnected())) {
    return errorResult("Figma read-only plugin is not connected. Run the 'Figma UI MCP Bridge' plugin in Figma Desktop first.")
  }
  const sessionId = args?.sessionId
  try {
    const [styles, variables, components] = await Promise.all([
      bridge.sendOperation('get_styles', {}, sessionId),
      bridge.sendOperation('get_variables', {}, sessionId),
      bridge.sendOperation('get_local_components', {}, sessionId),
    ])
    const lines = ['# Design System Rules', '', 'Use these read-only tokens, styles, and components when writing code for this Figma file.', '']
    if (styles.paintStyles?.length) {
      lines.push('## Color Tokens (Paint Styles)', '```')
      for (const style of styles.paintStyles) if (style.hex) lines.push(`--${String(style.name).replaceAll('/', '-')}: ${style.hex};  /* ${style.name} */`)
      lines.push('```', '')
    }
    if (variables.collections?.length) for (const collection of variables.collections) {
      if (!collection.variables?.length) continue
      lines.push(`## Variables — ${collection.name}`, '```')
      for (const variable of collection.variables) {
        const values = Object.values(variable.valuesByMode ?? {})
        lines.push(`${variable.name} (${variable.resolvedType})${values.length ? `: ${String(values[0])}` : ''}`)
      }
      lines.push('```', '')
    }
    if (styles.textStyles?.length) {
      lines.push('## Typography Styles', '```')
      for (const style of styles.textStyles) lines.push(`${style.name}: ${style.fontFamily} ${style.fontWeight} ${style.fontSize}px`)
      lines.push('```', '')
    }
    if (components.componentSets?.length) {
      lines.push('## Component Sets')
      for (const set of components.componentSets) lines.push(`- **${set.name}** (${set.variantCount} variants)${set.description ? ` — ${set.description}` : ''}`)
      lines.push('')
    }
    lines.push('---', '_Generated from the Figma canvas through the read-only plugin bridge._')
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (error) {
    return errorResult(`figma_rules failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new Server({ name: 'figma-read-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })
notifyClients = () => {
  server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {})
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const state = readState()
  await refresh(state)
  return { tools: activeTools }
})

server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
  const state = readState()
  const mode = await refresh(state)

  if (name === 'figma_status') {
    try {
      const info = mode === 'figwright'
        ? await handleFigwrightStatus(state.repoDir)
        : await handleUiStatus()
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  if (mode === 'figma-ui-mcp') {
    if (name === 'figma_read') return handleUiRead(args as Record<string, any> | undefined)
    if (name === 'figma_rules') return handleUiRules(args as Record<string, any> | undefined)
    return errorResult(`Unknown tool: ${name}. The read-only engine is "figma-ui-mcp"; its tools are figma_status / figma_read / figma_rules.`)
  }

  // figwright mode: only whitelisted raw tools are reachable.
  if (mode === 'figwright') {
    if (!FIGW_TOOL_WHITELIST.has(name)) {
      const hint = name === 'figma_read' || name === 'figma_rules'
        ? ' The design-to-code engine is now "figwright"; the tool list has been refreshed.'
        : ''
      return errorResult(`Unknown tool: ${name}.${hint}`)
    }
    try {
      await figwright.ensure(state.repoDir)
      return asResult(await figwright.call(name, args as Record<string, unknown> | undefined))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('not running')) {
        return errorResult("figwright engine is not connected. Run the 'Figwright' plugin in Figma Desktop first (Plugins → Development → Figwright).")
      }
      return errorResult(message)
    }
  }

  return errorResult(`Unknown tool: ${name}`)
})

// Best-effort child teardown when this process is asked to exit. The stdio
// transport reports its own close (parent died / mcp-client moved on), which
// also triggers shutdown: without it a dead client would leave the facade —
// and its figwright child holding the :3055 relay — running forever.
const shutdown = async (): Promise<void> => {
  await figwright.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })

class SelfReportingStdioTransport extends StdioServerTransport {
  constructor(private readonly onClosed: () => void) {
    super()
  }

  override async close(): Promise<void> {
    await super.close()
    this.onClosed()
  }
}

await server.connect(new SelfReportingStdioTransport(() => { void shutdown() }))
