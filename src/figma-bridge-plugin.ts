/**
 * App-managed copy of the Figma UI MCP Bridge plugin, patched to announce a
 * per-file bridge session. Host side, standalone-testable.
 *
 * Why the patch exists
 * --------------------
 * The bridge protocol is multi-session: the plugin polls
 * `/poll?sessionId=…&fileName=…`, `/sessions` lists what is connected, and the
 * `figma_read` / `figma_rules` / `figma_write` tools all take a `sessionId`
 * argument (the server pins a whole `figma_write` execution to it). The shipped
 * plugin never sends one — `ui.html` carries a `session-info` receiver
 * ("assigned from plugin main thread (fileName-based)") but the main thread has
 * no code that sends that message — so every open Figma file collapses into the
 * single `_default` session and shares one command queue: whichever instance
 * polls next takes the operation, and a write lands in whichever file won the
 * race.
 *
 * The fix is a few lines of plugin code, so this module keeps an app-managed
 * copy of the upstream plugin and patches it on the way in:
 *
 * - `code.js`  — announce `sessionId = figma.fileKey || "n:" + figma.root.name`
 *   plus `fileName = figma.root.name`, at startup and on request.
 * - `ui.html`  — ask for that identity once the plugin UI is up, retrying until
 *   it answers, because a message posted before the iframe finished loading
 *   would be lost. The receiving branch already exists upstream.
 *
 * Nothing else changes: same manifest, same protocol, same bridge. Figma copies
 * an imported development plugin into its own directory, so this copy is an
 * import *entry point* — when the patch revision or the upstream plugin changes,
 * the user re-imports it once from the path the settings page shows.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SightBridgePluginInfo } from './config.ts'

export type { SightBridgePluginInfo }

/** Plugin files copied verbatim from the upstream package. */
const PLUGIN_FILES = ['code.js', 'ui.html', 'manifest.json', 'icon16.png', 'icon32.png'] as const

/**
 * Patch revision. Bump it when either snippet below changes, so an existing
 * copy is rebuilt instead of being mistaken for a current one.
 */
const PATCH_REVISION = 1

/** Marker carried by both patched files (detection + human greppability). */
const PATCH_MARK = 'dsh-sight patch: per-file bridge session'

/** Appended to `code.js`: announce this file's identity instead of staying anonymous. */
const CODE_PATCH = `
// ── ${PATCH_MARK} (rev ${PATCH_REVISION}) ────────────────────────────────────
// The bridge routes per session, but an anonymous plugin shares one command
// queue with every other open Figma file, so a write can land in the wrong one.
// Announce a stable per-file identity: the file key when Figma exposes one,
// else the file name (Dev Mode and local drafts have no file key).
(function () {
  function sightIdentity() {
    var key = (typeof figma.fileKey === "string" && figma.fileKey.length > 0) ? figma.fileKey : null;
    var name = (figma.root && figma.root.name) ? figma.root.name : "untitled";
    return {
      type: "session-info",
      sessionId: key ? ("f:" + key) : ("n:" + name),
      fileName: name
    };
  }
  function sightAnnounce() {
    try { figma.ui.postMessage(sightIdentity()); } catch (error) { /* UI not open yet */ }
  }
  var sightOriginalOnMessage = figma.ui.onmessage;
  figma.ui.onmessage = async function (request) {
    if (request && request.type === "sight-session-request") { sightAnnounce(); return; }
    return sightOriginalOnMessage(request);
  };
  sightAnnounce();
})();
`

/** Inserted into `ui.html`: ask the main thread who we are, until it answers. */
const UI_PATCH = `
    // ── ${PATCH_MARK} (rev ${PATCH_REVISION}) ──
    // session-info only arrives if the main thread was asked: retry, because a
    // request sent before this iframe finished loading would be lost.
    (function sightAskSession() {
      var sightTries = 0;
      (function sightAsk() {
        if (sessionId !== null || sightTries >= 20) return;
        sightTries++;
        try { parent.postMessage({ pluginMessage: { type: "sight-session-request" } }, "*"); } catch (error) {}
        setTimeout(sightAsk, 500);
      })();
    })();
`

/** Anchor the UI patch is inserted before (the poll loop's kickoff). */
const UI_ANCHOR = '\n    poll();\n  </script>'

/** Plugin directory holding the managed copy (single, overwritten on refresh). */
export const bridgePluginDir = (baseDir: string): string => join(baseDir, 'figma-ui-plugin')

interface VersionStamp {
  readonly upstreamVersion?: unknown
  readonly patch?: unknown
}

/** Read the managed copy's state (version stamp + manifest path). */
export const readBridgePluginAt = (dir: string): SightBridgePluginInfo => {
  const manifest = join(dir, 'manifest.json')
  if (!existsSync(manifest)) return { patched: false, upstreamVersion: null, manifestPath: null, error: null }
  try {
    const value = JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')) as VersionStamp
    return {
      patched: value.patch === PATCH_REVISION,
      upstreamVersion: typeof value.upstreamVersion === 'string' ? value.upstreamVersion : null,
      manifestPath: manifest,
      error: null,
    }
  } catch {
    // A copy without a readable stamp is not one this module wrote.
    return { patched: false, upstreamVersion: null, manifestPath: manifest, error: null }
  }
}

/**
 * Materialize (or refresh) the patched copy from `upstreamPluginDir`.
 *
 * Returns the managed copy's state. When the upstream files are missing or
 * their patch anchors moved, nothing is written and the returned `error`
 * explains why — the caller then falls back to the upstream plugin path, so the
 * bridge keeps working in single-file mode instead of breaking.
 *
 * `upstreamVersion` is the `figma-ui-mcp` package version; a change rebuilds the
 * copy so a silently updated upstream plugin is never left half-patched.
 */
export function ensureBridgePlugin(dir: string, upstreamPluginDir: string, upstreamVersion: string): SightBridgePluginInfo {
  const current = readBridgePluginAt(dir)
  if (current.patched && current.upstreamVersion === upstreamVersion) return current

  try {
    for (const file of PLUGIN_FILES) {
      if (!existsSync(join(upstreamPluginDir, file))) throw new Error(`上游插件缺少 ${file}`)
    }

    const code = readFileSync(join(upstreamPluginDir, 'code.js'), 'utf8')
    const ui = readFileSync(join(upstreamPluginDir, 'ui.html'), 'utf8')
    const manifestRaw = readFileSync(join(upstreamPluginDir, 'manifest.json'), 'utf8')
    if (code.includes(PATCH_MARK) || ui.includes(PATCH_MARK)) {
      throw new Error('上游插件已带有同名补丁标记，请检查后重试')
    }
    if (!ui.includes(UI_ANCHOR)) {
      throw new Error('上游 ui.html 结构已变（找不到轮询入口锚点），副本未生成')
    }

    // The manifest keeps its id (so an existing Figma import is updated rather
    // than duplicated) but gains a name suffix, so the user can tell the
    // patched bridge apart from a leftover import of the upstream plugin.
    const manifest = JSON.parse(manifestRaw) as { name?: unknown }
    if (typeof manifest.name === 'string' && !manifest.name.includes('Sight')) {
      manifest.name = `${manifest.name} (Sight)`
    }

    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'code.js'), `${code}\n${CODE_PATCH}`, 'utf8')
    writeFileSync(join(dir, 'ui.html'), ui.replace(UI_ANCHOR, `\n${UI_PATCH}${UI_ANCHOR}`), 'utf8')
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    for (const icon of ['icon16.png', 'icon32.png'] as const) {
      copyFileSync(join(upstreamPluginDir, icon), join(dir, icon))
    }
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ upstreamVersion, patch: PATCH_REVISION }, null, 2), 'utf8')

    return { patched: true, upstreamVersion, manifestPath: join(dir, 'manifest.json'), error: null }
  } catch (error) {
    return {
      patched: false,
      upstreamVersion: null,
      manifestPath: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
