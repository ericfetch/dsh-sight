/**
 * Patched entry for the upstream figma-ui-mcp server — the write facade's child.
 *
 * Why this exists
 * ---------------
 * The upstream server runs in one of two modes. In "direct" mode it owns the
 * bridge and forwards a caller-supplied `sessionId` to it. In "http-proxy" mode
 * — taken whenever another process already owns the bridge, e.g. the read
 * facade started first — its proxy silently drops that argument:
 *
 *     async sendOperation(operation, params = {}) {      // no sessionId
 *       ... path: "/exec", ...                           // bridge accepts ?sessionId=
 *
 * The bridge then routes to "whichever plugin polled last", which is exactly
 * the multi-file bug per-file sessions exist to remove: one Figma file's write
 * could land in another. So the write row spawns this generated entry instead
 * of the package's own, with the missing `sessionId` restored.
 *
 * Every import specifier in the copy is rewritten to an absolute file URL: the
 * copy lives outside the package tree, where neither its relative imports
 * (`./bridge-server.js`) nor the bare SDK specifiers would resolve. The
 * upstream modules stay shared and unpatched — only the entry is regenerated.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SightBridgeServerInfo } from './config.ts'

export type { SightBridgeServerInfo }

/** Patch revision; bump when the replacements below change. */
const PATCH_REVISION = 1

const PROXY_SIGNATURE = 'async sendOperation(operation, params = {}) {'
const PROXY_SIGNATURE_PATCHED = 'async sendOperation(operation, params = {}, sessionId) {'
const PROXY_PATH = 'path: "/exec", method: "POST",'
const PROXY_PATH_PATCHED = 'path: sessionId ? "/exec?sessionId=" + encodeURIComponent(sessionId) : "/exec", method: "POST",'

/** Managed directory holding the generated entry (single, overwritten). */
export const bridgeServerDir = (baseDir: string): string => join(baseDir, 'figma-ui-server')

/** Read the generated entry's state. */
export const readBridgeServerAt = (dir: string): SightBridgeServerInfo => {
  const entry = join(dir, 'index.js')
  if (!existsSync(entry)) return { patched: false, entryPath: null, error: null }
  try {
    const value = JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')) as { patch?: unknown }
    return { patched: value.patch === PATCH_REVISION, entryPath: entry, error: null }
  } catch {
    return { patched: false, entryPath: entry, error: null }
  }
}

/** Every file:// target the generated entry imports must still exist. */
const entryIsUsable = (entry: string): boolean => {
  try {
    const source = readFileSync(entry, 'utf8')
    const targets = [...source.matchAll(/from\s+"(file:\/\/[^"]+)"/g)].map(match => match[1] as string)
    if (targets.length === 0) return false
    return targets.every(url => existsSync(new URL(url)))
  } catch {
    return false
  }
}

/**
 * Rewrite every `from "specifier"` to an absolute file URL. Relative specifiers
 * resolve inside the upstream server directory; bare ones resolve from this
 * package (the SDK is a dependency here too, under the same import condition).
 */
function rewriteSpecifiers(source: string, upstreamServerDir: string): string {
  return source.replace(/from\s+"([^"]+)"/g, (match, specifier: string) => {
    if (specifier.startsWith('node:')) return match
    const url = specifier.startsWith('.')
      ? new URL(specifier, `file://${upstreamServerDir}/`).href
      : import.meta.resolve(specifier)
    return `from ${JSON.stringify(url)}`
  })
}

/**
 * Prefix the copy with its provenance marker, keeping a shebang on line one —
 * the upstream entry starts with `#!`, and anything above it is a syntax error.
 */
function withHeader(source: string): string {
  const marker = `// dsh-sight patch rev ${PATCH_REVISION}: http-proxy forwards sessionId (src/figma-ui-server-patch.ts)`
  if (!source.startsWith('#!')) return `${marker}\n${source}`
  const firstBreak = source.indexOf('\n')
  return firstBreak === -1 ? source : `${source.slice(0, firstBreak + 1)}${marker}\n${source.slice(firstBreak + 1)}`
}

/**
 * Materialize (or refresh) the patched entry from `upstreamServerDir`.
 *
 * Returns the managed entry's state. When the upstream file is missing or its
 * proxy anchors moved, nothing is written and `error` explains why — the caller
 * then falls back to the package's own entry, which keeps working for a single
 * connected Figma file.
 */
export function ensureBridgeServer(dir: string, upstreamServerDir: string, upstreamVersion: string): SightBridgeServerInfo {
  const current = readBridgeServerAt(dir)
  if (current.patched && entryIsUsable(join(dir, 'index.js'))) return current

  try {
    const entry = join(upstreamServerDir, 'index.js')
    if (!existsSync(entry)) throw new Error(`上游服务端入口缺失: ${entry}`)
    const source = readFileSync(entry, 'utf8')
    if (!source.includes(PROXY_SIGNATURE) || !source.includes(PROXY_PATH)) {
      throw new Error('上游服务器结构已变（找不到 http-proxy 锚点），未生成补丁入口')
    }

    const patched = rewriteSpecifiers(
      source.replace(PROXY_SIGNATURE, PROXY_SIGNATURE_PATCHED).replace(PROXY_PATH, PROXY_PATH_PATCHED),
      upstreamServerDir,
    )

    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), withHeader(patched), 'utf8')
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ upstreamVersion, patch: PATCH_REVISION }, null, 2), 'utf8')
    return { patched: true, entryPath: join(dir, 'index.js'), error: null }
  } catch (error) {
    return { patched: false, entryPath: null, error: error instanceof Error ? error.message : String(error) }
  }
}
