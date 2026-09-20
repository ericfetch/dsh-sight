#!/usr/bin/env node
/**
 * Write-capable MCP facade over the figma-ui-mcp bridge, with deterministic
 * multi-file routing.
 *
 * The bridge (`figma-ui-mcp/server/bridge-server.js`) routes per session: the
 * plugin polls `/poll?sessionId=…`, `/sessions` lists what is connected, and
 * `figma_read` / `figma_rules` / `figma_write` all take a `sessionId` argument
 * (a whole `figma_write` execution is pinned to it). The upstream MCP server —
 * spawned here as a child, unchanged — forwards whatever the caller passes and
 * otherwise resolves "whichever session polled last". With more than one Figma
 * file connected that is a coin flip, so a write can silently land in the wrong
 * file. (The companion change is on the plugin side: the app-managed copy in
 * `figma-bridge-plugin.ts` makes each Figma file register its own session.)
 *
 * This facade pins every routing-capable call to one file:
 *
 *   1. an explicit `sessionId` argument wins;
 *   2. else the file pinned by `figma_files` (the SIGHT_UI_STATE state file);
 *   3. else the only connected file, when there is exactly one;
 *   4. else the call fails with the list of candidates — never a guess.
 *
 * A leftover, unpatched plugin registers as the anonymous `_default` session.
 * That still works (single-file behaviour, unchanged), but the result carries a
 * warning, because with it a second open Figma file cannot be told apart.
 *
 * It also adds `figma_files` (list connected files / pin one) and enriches
 * `figma_status` with the real session list, which the child cannot see when it
 * happens to run in HTTP-proxy mode.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ensureBridgeServer, bridgeServerDir } from './figma-ui-server-patch.ts'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import http from 'node:http'

// ── Bridge endpoint ─────────────────────────────────────────────────────────

/**
 * The bridge's primary port. Mirrors figma-ui-mcp's `CONFIG.PORT` (same env var,
 * same default) without importing the package, so this facade keeps working
 * even if that module's layout changes.
 */
const BRIDGE_PORT = ((): number => {
  const raw = process.env.FIGMA_MCP_PORT
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 38451
})()

interface BridgeSession {
  readonly id: string
  readonly fileName: string | null
  readonly connected: boolean
  readonly lastPollAgoMs: number | null
  readonly queueLength: number
  readonly ops: number
}

interface BridgeHealth {
  /** False when the bridge itself could not be reached (transient/absent). */
  readonly reachable: boolean
  readonly sessions: readonly BridgeSession[]
}

/**
 * Ask the bridge what is connected. The bridge is the single source of truth
 * for session ids, so routing is decided here rather than inferred from tool
 * results. An unreachable bridge is reported, not thrown: the child still gets
 * the call and produces its own (better-informed) error.
 */
function bridgeHealth(): Promise<BridgeHealth> {
  return new Promise(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port: BRIDGE_PORT, path: '/health', method: 'GET' }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { sessions?: unknown }
          const sessions = Array.isArray(parsed.sessions)
            ? parsed.sessions.flatMap(entry => {
                if (entry === null || typeof entry !== 'object') return []
                const s = entry as Record<string, unknown>
                if (typeof s.id !== 'string') return []
                return [{
                  id: s.id,
                  fileName: typeof s.fileName === 'string' ? s.fileName : null,
                  connected: s.connected === true,
                  lastPollAgoMs: typeof s.lastPollAgoMs === 'number' ? s.lastPollAgoMs : null,
                  queueLength: typeof s.queueLength === 'number' ? s.queueLength : 0,
                  ops: typeof s.ops === 'number' ? s.ops : 0,
                }]
              })
            : []
          resolve({ reachable: true, sessions })
        } catch {
          resolve({ reachable: false, sessions: [] })
        }
      })
    })
    req.on('error', () => resolve({ reachable: false, sessions: [] }))
    req.setTimeout(2000, () => { req.destroy(); resolve({ reachable: false, sessions: [] }) })
    req.end()
  })
}

// ── Pinned target (SIGHT_UI_STATE) ──────────────────────────────────────────

const statePath = process.env.SIGHT_UI_STATE ?? ''

/** The session pinned by `figma_files`, or null (auto). Unreadable = null. */
function readPinned(): string | null {
  if (statePath.length === 0) return null
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as { sessionId?: unknown }
    return typeof raw.sessionId === 'string' && raw.sessionId.length > 0 ? raw.sessionId : null
  } catch {
    return null
  }
}

/** Persist the pin (null clears it). Throws when the state file is unwritable. */
function writePinned(sessionId: string | null): void {
  if (statePath.length === 0) throw new Error('SIGHT_UI_STATE is not configured — the pin cannot be persisted.')
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify({ sessionId }, null, 2), 'utf8')
}

// ── Routing ─────────────────────────────────────────────────────────────────

/** A session is identified when the patched plugin named its Figma file. */
const isIdentified = (session: BridgeSession): boolean =>
  session.fileName !== null && session.fileName.length > 0 && session.fileName !== 'unknown'

const describe = (sessions: readonly BridgeSession[]): string =>
  sessions.length === 0
    ? 'none'
    : sessions.map(s => `${isIdentified(s) ? s.fileName : '(unnamed plugin)'} [${s.id}]`).join(', ')

const LEGACY_NOTE =
  'Warning: the connected Figma plugin does not carry the per-file session patch, so it registered as the anonymous '
  + 'default session and routing is only reliable while ONE Figma file has the plugin running. '
  + 'Re-import "Figma UI MCP Bridge (Sight)" from the path shown in DSH → Sight → settings to enable multi-file routing.'

/**
 * Set when the child had to fall back to the package's own entry: that one
 * drops `sessionId` in http-proxy mode, so the pin is only guaranteed when the
 * child owns the bridge itself.
 */
const unpatchedChildNote = (): string | null => unpatchedChildReason === null
  ? null
  : `Warning: the generated figma-ui-mcp entry could not be used (${unpatchedChildReason}), so the package's own entry is running. `
    + 'When another process owns the bridge (http-proxy mode) it drops sessionId, and routing falls back to whichever plugin polled last.'

/** Join the applicable warnings into one note block. */
const notesOf = (...notes: readonly (string | null)[]): string | null => {
  const kept = notes.filter((note): note is string => note !== null)
  return kept.length === 0 ? null : kept.join('\n\n')
}

interface Route {
  /** Session to pin, or null when nothing is connected (the child reports that). */
  readonly sessionId: string | null
  readonly mode: 'explicit' | 'pinned' | 'single' | 'none'
  readonly fileName: string | null
  /** Set when routing is best-effort (anonymous plugin), never when it is exact. */
  readonly warning: string | null
}

type RouteResult =
  | { readonly ok: true; readonly route: Route; readonly sessions: readonly BridgeSession[] }
  | { readonly ok: false; readonly error: string; readonly sessions: readonly BridgeSession[] }

/** Decide which Figma file this call targets — never by guessing. */
async function route(explicit: string | undefined): Promise<RouteResult> {
  const health = await bridgeHealth()
  if (!health.reachable) {
    // The bridge may just be starting; let the child produce its own error.
    return { ok: true, route: { sessionId: explicit ?? null, mode: 'none', fileName: null, warning: null }, sessions: [] }
  }
  const connected = health.sessions.filter(session => session.connected)
  const legacy = (session: BridgeSession): string | null => (isIdentified(session) ? null : LEGACY_NOTE)

  if (explicit !== undefined) {
    const hit = connected.find(session => session.id === explicit)
    if (hit === undefined) {
      return {
        ok: false,
        sessions: connected,
        error: `sessionId "${explicit}" is not connected. Connected files: ${describe(connected)}. `
          + 'Call figma_files to see the current list.',
      }
    }
    return { ok: true, sessions: connected, route: { sessionId: hit.id, mode: 'explicit', fileName: hit.fileName, warning: legacy(hit) } }
  }

  const pinned = readPinned()
  if (pinned !== null) {
    const hit = connected.find(session => session.id === pinned)
    if (hit === undefined) {
      // Deliberately fatal: quietly retargeting a pinned file would write into
      // whichever other file happens to be open.
      return {
        ok: false,
        sessions: connected,
        error: `The pinned file (sessionId "${pinned}") is not connected. Connected files: ${describe(connected)}. `
          + 'Re-run the plugin in that file, or call figma_files with a new target (or { clear: true }).',
      }
    }
    return { ok: true, sessions: connected, route: { sessionId: hit.id, mode: 'pinned', fileName: hit.fileName, warning: legacy(hit) } }
  }

  if (connected.length === 1) {
    const only = connected[0] as BridgeSession
    return { ok: true, sessions: connected, route: { sessionId: only.id, mode: 'single', fileName: only.fileName, warning: legacy(only) } }
  }

  if (connected.length === 0) {
    return {
      ok: false,
      sessions: connected,
      error: 'No Figma file is connected. In Figma Desktop run the "Figma UI MCP Bridge (Sight)" plugin '
        + '(Plugins → Development) and wait for its green dot.',
    }
  }

  return {
    ok: false,
    sessions: connected,
    error: `${connected.length} Figma files are connected and no target is pinned: ${describe(connected)}. `
      + 'Call figma_files with { use: "<fileName>" } (or an explicit sessionId) before reading or writing.',
  }
}

// ── Child server (upstream figma-ui-mcp + patched entry) ────────────────────

/** The installed package's server directory + version. */
function upstreamServer(): { readonly dir: string; readonly version: string } | null {
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('figma-ui-mcp/package.json')
    const dir = join(dirname(pkgPath), 'server')
    if (!existsSync(join(dir, 'index.js'))) return null
    let version = 'unknown'
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
      if (typeof pkg.version === 'string' && pkg.version.length > 0) version = pkg.version
    } catch { /* the version only labels the generated copy */ }
    return { dir, version }
  } catch {
    return null
  }
}

/** Why the generated entry is unavailable (set when the upstream one is used). */
let unpatchedChildReason: string | null = null

/**
 * Entry to spawn. The generated copy is preferred: its http-proxy forwards
 * `sessionId`, without which routing degrades to "whichever plugin polled last"
 * whenever another process owns the bridge. It is regenerated here rather than
 * only from the settings page, so a moved module store or an upgraded package
 * can never leave a stale copy behind.
 */
function childEntry(): string {
  const upstream = upstreamServer()
  if (upstream === null) throw new Error('figma-ui-mcp is not installed, so the write bridge cannot start.')
  if (statePath.length > 0) {
    const state = ensureBridgeServer(bridgeServerDir(dirname(statePath)), upstream.dir, upstream.version)
    if (state.patched && state.entryPath !== null) return state.entryPath
    unpatchedChildReason = state.error ?? 'unknown'
  }
  return join(upstream.dir, 'index.js')
}

interface McpToolSpec {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: unknown
}

/** Tools whose calls can be pinned to one Figma file (upstream schema). */
const ROUTED_TOOLS = new Set(['figma_read', 'figma_rules', 'figma_write'])

/** Suffix appended to routed tools' descriptions so the routing rule is visible. */
const ROUTING_SUFFIX =
  ' Routing: pass sessionId to target a specific Figma file; otherwise the file shown by figma_files is used '
  + '(exactly one connected file auto-selects; several files without a pin fail with the candidate list).'

class UpstreamEngine {
  private client: Client | null = null
  private specs: McpToolSpec[] = []

  get tools(): readonly McpToolSpec[] {
    return this.specs
  }

  /** Spawn the child once and cache its tool list. */
  async ensure(): Promise<void> {
    if (this.client !== null) return
    let lastError: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const client = new Client({ name: 'figma-ui-bridge', version: '1.0.0' }, { capabilities: {} })
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [childEntry()],
          // The SDK only inherits a safe subset of env vars, so pass the bridge
          // port explicitly: the child must talk to the same bridge we probe.
          env: { FIGMA_MCP_PORT: String(BRIDGE_PORT) },
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
        specs.push({
          name: tool.name,
          ...(tool.description !== undefined
            ? { description: ROUTED_TOOLS.has(tool.name) ? `${tool.description}${ROUTING_SUFFIX}` : tool.description }
            : {}),
          ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        })
      }
      cursor = page.nextCursor
      if (cursor === undefined) break
    }
    return specs
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    await this.ensure()
    if (this.client === null) throw new Error('figma-ui-mcp child is not running.')
    return await this.client.callTool({ name, arguments: args }) as CallToolResult
  }

  async close(): Promise<void> {
    const client = this.client
    this.client = null
    this.specs = []
    if (client !== null) await client.close().catch(() => {})
  }
}

const upstream = new UpstreamEngine()

// ── Result helpers ──────────────────────────────────────────────────────────

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

const textOf = (result: CallToolResult): string | null => {
  const block = result.content.find(part => part.type === 'text')
  return block !== undefined && 'text' in block && typeof block.text === 'string' ? block.text : null
}

/** Prepend a note as its own block, keeping the child's payload intact. */
function withNote(result: CallToolResult, note: string | null): CallToolResult {
  if (note === null) return result
  return { ...result, content: [{ type: 'text', text: note }, ...result.content] }
}

// ── figma_files (this facade's own tool) ────────────────────────────────────

const FILES_TOOL: McpToolSpec = {
  name: 'figma_files',
  description:
    'List the Figma files currently connected to the bridge and show which one this session routes to. '
    + 'Pass { use: "<fileName>" } (or a sessionId) to pin the target for figma_read / figma_rules / figma_write; '
    + 'pass { clear: true } to drop the pin. Reads and writes fail rather than guess when several files are '
    + 'connected and none is pinned.',
  inputSchema: {
    type: 'object',
    properties: {
      use: { type: 'string', description: 'fileName (or sessionId) to pin as the routing target. Ambiguous file names are rejected — pass the sessionId then.' },
      clear: { type: 'boolean', description: 'true = clear the pin and fall back to auto routing (single connected file).' },
    },
    required: [],
  },
}

async function handleFiles(args: Record<string, unknown>): Promise<CallToolResult> {
  const health = await bridgeHealth()
  if (!health.reachable) {
    return errorResult(`The bridge on 127.0.0.1:${BRIDGE_PORT} is not responding. Start DSH's Figma write capability first.`)
  }
  const connected = health.sessions.filter(session => session.connected)

  if (args.clear === true) {
    writePinned(null)
  } else if (typeof args.use === 'string' && args.use.length > 0) {
    const wanted = args.use
    const byId = connected.filter(session => session.id === wanted)
    const byName = connected.filter(session => session.fileName === wanted)
    const hit = byId[0] ?? byName[0]
    if (hit === undefined) {
      return errorResult(`No connected file matches "${wanted}". Connected files: ${describe(connected)}.`)
    }
    if (byId.length === 0 && byName.length > 1) {
      return errorResult(`"${wanted}" matches ${byName.length} connected files — pin one by sessionId instead: ${describe(byName)}.`)
    }
    writePinned(hit.id)
  }

  const pinned = readPinned()
  const pinnedSession = pinned === null ? undefined : connected.find(session => session.id === pinned)
  const targets = pinnedSession ?? (connected.length === 1 ? connected[0] : undefined)
  const payload = {
    bridgePort: BRIDGE_PORT,
    files: connected.map(session => ({
      sessionId: session.id,
      fileName: isIdentified(session) ? session.fileName : null,
      identified: isIdentified(session),
      lastPollAgoMs: session.lastPollAgoMs,
    })),
    pinned,
    routing: {
      mode: pinned !== null ? 'pinned' : (connected.length === 1 ? 'single' : (connected.length === 0 ? 'none' : 'ambiguous')),
      sessionId: pinned ?? (connected.length === 1 ? (connected[0] as BridgeSession).id : null),
      fileName: targets !== undefined && isIdentified(targets) ? targets.fileName : null,
    },
    warning: notesOf(unpatchedChildNote()),
    hint: connected.length === 0
      ? 'No plugin is connected: run "Figma UI MCP Bridge (Sight)" in Figma Desktop (Plugins → Development).'
      : (pinned !== null
          ? 'Reads and writes target the pinned file.'
          : (connected.length === 1
              ? 'One file connected: reads and writes target it automatically.'
              : 'Several files connected: pin one with { use: "<fileName>" } before reading or writing.')),
  }
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

// ── figma_status enrichment ─────────────────────────────────────────────────

/**
 * Re-attach the real session list (and the routing decision) to the child's
 * `figma_status` payload: in HTTP-proxy mode the child reports `sessions: []`,
 * and its `fileName` reflects whichever instance happened to answer.
 */
async function enrichStatus(result: CallToolResult): Promise<CallToolResult> {
  const text = textOf(result)
  if (text === null) return result
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const health = await bridgeHealth()
    const connected = health.sessions.filter(session => session.connected)
    const pinned = readPinned()
    const files = connected.map(session => ({
      sessionId: session.id,
      fileName: isIdentified(session) ? session.fileName : null,
      identified: isIdentified(session),
      lastPollAgoMs: session.lastPollAgoMs,
    }))
    const enriched = {
      ...parsed,
      sessions: files,
      warning: notesOf(unpatchedChildNote()),
      routing: {
        pinned,
        mode: pinned !== null ? 'pinned' : (connected.length === 1 ? 'single' : (connected.length === 0 ? 'none' : 'ambiguous')),
        hint: connected.length > 1 && pinned === null
          ? 'Multiple files connected: call figma_files with { use: "<fileName>" } first — reads and writes will not guess.'
          : (connected.some(session => !isIdentified(session))
              ? 'An anonymous (unpatched) plugin is connected: re-import "Figma UI MCP Bridge (Sight)" from the DSH settings path to enable per-file routing.'
              : null),
      },
    }
    return { ...result, content: [{ type: 'text', text: JSON.stringify(enriched, null, 2) }, ...result.content.slice(1)] }
  } catch {
    return result
  }
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new Server({ name: 'figma-ui-bridge', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => {
  await upstream.ensure()
  return { tools: [FILES_TOOL, ...upstream.tools] }
})

server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
  const input = (args ?? {}) as Record<string, unknown>

  if (name === 'figma_files') {
    try {
      return await handleFiles(input)
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  if (!ROUTED_TOOLS.has(name)) {
    try {
      const result = await upstream.call(name, input)
      return name === 'figma_status' ? await enrichStatus(result) : result
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }

  const explicit = typeof input.sessionId === 'string' && input.sessionId.length > 0 ? input.sessionId : undefined
  const decided = await route(explicit)
  if (!decided.ok) return errorResult(decided.error)

  const payload = decided.route.sessionId === null ? input : { ...input, sessionId: decided.route.sessionId }
  try {
    const result = await upstream.call(name, payload)
    return withNote(result, notesOf(decided.route.warning, unpatchedChildNote()))
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }
})

// Best-effort child teardown when this process is asked to exit: without it a
// dead client would leave the upstream figma-ui-mcp child running.
const shutdown = async (): Promise<void> => {
  await upstream.close().catch(() => {})
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
