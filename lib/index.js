import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { unzipSync } from "fflate";
import { parse, stringify } from "yaml";
//#region src/figma-plugin-install.ts
/**
* Figwright plugin fetch/install, host side, standalone-testable.
*
* The Figma-side Figwright plugin is not published to npm, so the settings
* page offers one-click download + extraction. This module talks only to
* GitHub, extracts the release zip with fflate (no system unzip) and writes
* the result into a single plugin directory that is overwritten on every
* update. Figma Desktop copies the plugin into its own directory at import
* time, so the extracted copy is an import entry point, not a permanent asset.
*/
/** Plugin directory holding the single, latest extracted copy. */
const figwrightPluginDir = (baseDir) => join(baseDir, "figwright-plugin");
/** Read the locally installed copy state (version.json + manifest.json). */
const readFigwrightPluginAt = (pluginDir) => {
	const manifest = join(pluginDir, "manifest.json");
	if (!existsSync(manifest)) return {
		installedTag: null,
		manifestPath: null
	};
	let installedTag = null;
	try {
		const value = JSON.parse(readFileSync(join(pluginDir, "version.json"), "utf8"));
		installedTag = typeof value.tag === "string" && value.tag.length > 0 ? value.tag : null;
	} catch {}
	return {
		installedTag,
		manifestPath: manifest
	};
};
function httpsGetBuffer(url, accept, redirects = 5) {
	return new Promise((resolve, reject) => {
		const request = https.get(url, {
			headers: {
				"User-Agent": "dsh-sight/0.1.13 (figwright plugin updater)",
				...accept === "binary" ? { "Accept": "application/octet-stream" } : {}
			},
			timeout: 3e4
		}, (res) => {
			const status = res.statusCode ?? 0;
			const location = res.headers.location;
			if (status >= 300 && status < 400 && typeof location === "string" && redirects > 0) {
				res.resume();
				httpsGetBuffer(location, accept, redirects - 1).then(resolve, reject);
				return;
			}
			if (status !== 200) {
				res.resume();
				reject(/* @__PURE__ */ new Error(`下载失败: HTTP ${status}`));
				return;
			}
			const chunks = [];
			res.on("data", (chunk) => {
				chunks.push(chunk);
			});
			res.on("end", () => resolve(Buffer.concat(chunks)));
			res.on("error", reject);
		});
		request.on("timeout", () => request.destroy(/* @__PURE__ */ new Error("下载超时")));
		request.on("error", reject);
	});
}
/** Retry a fetch a few times; GitHub egress is intermittently flaky. */
async function fetchWithRetry(url, accept, attempts = 3) {
	let lastError = null;
	for (let attempt = 0; attempt < attempts; attempt++) try {
		return await httpsGetBuffer(url, accept);
	} catch (error) {
		lastError = error;
		if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
/**
* Resolve the latest release's plugin zip (never the auto source zip). The
* download itself goes through the API asset endpoint (Accept: octet-stream),
* which 302s straight to the release-assets CDN — this deliberately avoids
* `github.com` as a hop, since that redirector is frequently unreachable even
* when api.github.com and the asset CDN both work.
*/
async function resolveLatestFigwrightZip() {
	const body = await fetchWithRetry("https://api.github.com/repos/awdr74100/figwright/releases/latest", "json");
	const release = JSON.parse(body.toString("utf8"));
	const tag = typeof release.tag_name === "string" ? release.tag_name : null;
	const asset = Array.isArray(release.assets) ? release.assets.find((a) => typeof a.name === "string" && /^figwright-plugin-.*\.zip$/i.test(a.name) && typeof a.id === "number") : void 0;
	if (tag === null || asset === void 0 || typeof asset.id !== "number") throw new Error("无法从 GitHub 解析最新 Figwright 插件资源");
	return {
		tag,
		assetId: asset.id
	};
}
/**
* Download the latest release zip and extract it into `pluginDir`
* (overwriting any previous copy). Returns the outcome for the settings UI.
*/
async function installLatestFigwrightPlugin(pluginDir) {
	try {
		const latest = await resolveLatestFigwrightZip();
		const current = readFigwrightPluginAt(pluginDir);
		if (current.manifestPath !== null && current.installedTag === latest.tag) return {
			ok: true,
			upToDate: true,
			tag: latest.tag,
			manifestPath: current.manifestPath,
			error: null
		};
		const zip = await fetchWithRetry(`https://api.github.com/repos/awdr74100/figwright/releases/assets/${latest.assetId}`, "binary");
		rmSync(pluginDir, {
			recursive: true,
			force: true
		});
		mkdirSync(pluginDir, { recursive: true });
		const files = unzipSync(new Uint8Array(zip));
		const names = Object.keys(files);
		const flat = names.includes("manifest.json");
		const firstParts = names.map((name) => name.split("/")[0]);
		const singleRoot = !flat && names.length > 0 && firstParts.every((part) => part !== void 0 && part.length > 0 && part === firstParts[0]);
		let wroteManifest = false;
		for (const [rawName, data] of Object.entries(files)) {
			if (rawName.endsWith("/")) continue;
			let parts = rawName.split("/");
			if (singleRoot) parts = parts.slice(1);
			parts = parts.filter((part) => part.length > 0 && part !== "." && part !== ".." && part !== "__MACOSX");
			if (parts.length === 0) continue;
			const target = join(pluginDir, ...parts);
			if (target !== pluginDir && !target.startsWith(pluginDir + sep)) throw new Error(`zip 内含不安全路径: ${rawName}`);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, Buffer.from(data));
			if (parts[parts.length - 1] === "manifest.json") wroteManifest = true;
		}
		const manifest = join(pluginDir, "manifest.json");
		if (!wroteManifest || !existsSync(manifest)) throw new Error("解压后未找到 manifest.json");
		writeFileSync(join(pluginDir, "version.json"), JSON.stringify({ tag: latest.tag }, null, 2), "utf8");
		return {
			ok: true,
			upToDate: false,
			tag: latest.tag,
			manifestPath: manifest,
			error: null
		};
	} catch (error) {
		return {
			ok: false,
			upToDate: false,
			tag: null,
			manifestPath: null,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
//#endregion
//#region src/figma-bridge-plugin.ts
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
/** Plugin files copied verbatim from the upstream package. */
const PLUGIN_FILES = [
	"code.js",
	"ui.html",
	"manifest.json",
	"icon16.png",
	"icon32.png"
];
/**
* Patch revision. Bump it when either snippet below changes, so an existing
* copy is rebuilt instead of being mistaken for a current one.
*/
const PATCH_REVISION$1 = 1;
/** Marker carried by both patched files (detection + human greppability). */
const PATCH_MARK = "dsh-sight patch: per-file bridge session";
/** Appended to `code.js`: announce this file's identity instead of staying anonymous. */
const CODE_PATCH = `
// ── ${PATCH_MARK} (rev ${PATCH_REVISION$1}) ────────────────────────────────────
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
`;
/** Inserted into `ui.html`: ask the main thread who we are, until it answers. */
const UI_PATCH = `
    // ── ${PATCH_MARK} (rev ${PATCH_REVISION$1}) ──
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
`;
/** Anchor the UI patch is inserted before (the poll loop's kickoff). */
const UI_ANCHOR = "\n    poll();\n  <\/script>";
/** Plugin directory holding the managed copy (single, overwritten on refresh). */
const bridgePluginDir = (baseDir) => join(baseDir, "figma-ui-plugin");
/** Read the managed copy's state (version stamp + manifest path). */
const readBridgePluginAt = (dir) => {
	const manifest = join(dir, "manifest.json");
	if (!existsSync(manifest)) return {
		patched: false,
		upstreamVersion: null,
		manifestPath: null,
		error: null
	};
	try {
		const value = JSON.parse(readFileSync(join(dir, "version.json"), "utf8"));
		return {
			patched: value.patch === PATCH_REVISION$1,
			upstreamVersion: typeof value.upstreamVersion === "string" ? value.upstreamVersion : null,
			manifestPath: manifest,
			error: null
		};
	} catch {
		return {
			patched: false,
			upstreamVersion: null,
			manifestPath: manifest,
			error: null
		};
	}
};
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
function ensureBridgePlugin(dir, upstreamPluginDir, upstreamVersion) {
	const current = readBridgePluginAt(dir);
	if (current.patched && current.upstreamVersion === upstreamVersion) return current;
	try {
		for (const file of PLUGIN_FILES) if (!existsSync(join(upstreamPluginDir, file))) throw new Error(`上游插件缺少 ${file}`);
		const code = readFileSync(join(upstreamPluginDir, "code.js"), "utf8");
		const ui = readFileSync(join(upstreamPluginDir, "ui.html"), "utf8");
		const manifestRaw = readFileSync(join(upstreamPluginDir, "manifest.json"), "utf8");
		if (code.includes(PATCH_MARK) || ui.includes(PATCH_MARK)) throw new Error("上游插件已带有同名补丁标记，请检查后重试");
		if (!ui.includes(UI_ANCHOR)) throw new Error("上游 ui.html 结构已变（找不到轮询入口锚点），副本未生成");
		const manifest = JSON.parse(manifestRaw);
		if (typeof manifest.name === "string" && !manifest.name.includes("Sight")) manifest.name = `${manifest.name} (Sight)`;
		rmSync(dir, {
			recursive: true,
			force: true
		});
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "code.js"), `${code}\n${CODE_PATCH}`, "utf8");
		writeFileSync(join(dir, "ui.html"), ui.replace(UI_ANCHOR, `\n${UI_PATCH}${UI_ANCHOR}`), "utf8");
		writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		for (const icon of ["icon16.png", "icon32.png"]) copyFileSync(join(upstreamPluginDir, icon), join(dir, icon));
		writeFileSync(join(dir, "version.json"), JSON.stringify({
			upstreamVersion,
			patch: PATCH_REVISION$1
		}, null, 2), "utf8");
		return {
			patched: true,
			upstreamVersion,
			manifestPath: join(dir, "manifest.json"),
			error: null
		};
	} catch (error) {
		return {
			patched: false,
			upstreamVersion: null,
			manifestPath: null,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
//#endregion
//#region src/figma-ui-server-patch.ts
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
/** Patch revision; bump when the replacements below change. */
const PATCH_REVISION = 1;
const PROXY_SIGNATURE = "async sendOperation(operation, params = {}) {";
const PROXY_SIGNATURE_PATCHED = "async sendOperation(operation, params = {}, sessionId) {";
const PROXY_PATH = "path: \"/exec\", method: \"POST\",";
const PROXY_PATH_PATCHED = "path: sessionId ? \"/exec?sessionId=\" + encodeURIComponent(sessionId) : \"/exec\", method: \"POST\",";
/** Managed directory holding the generated entry (single, overwritten). */
const bridgeServerDir = (baseDir) => join(baseDir, "figma-ui-server");
/** Read the generated entry's state. */
const readBridgeServerAt = (dir) => {
	const entry = join(dir, "index.js");
	if (!existsSync(entry)) return {
		patched: false,
		entryPath: null,
		error: null
	};
	try {
		return {
			patched: JSON.parse(readFileSync(join(dir, "version.json"), "utf8")).patch === PATCH_REVISION,
			entryPath: entry,
			error: null
		};
	} catch {
		return {
			patched: false,
			entryPath: entry,
			error: null
		};
	}
};
/** Every file:// target the generated entry imports must still exist. */
const entryIsUsable = (entry) => {
	try {
		const targets = [...readFileSync(entry, "utf8").matchAll(/from\s+"(file:\/\/[^"]+)"/g)].map((match) => match[1]);
		if (targets.length === 0) return false;
		return targets.every((url) => existsSync(new URL(url)));
	} catch {
		return false;
	}
};
/**
* Rewrite every `from "specifier"` to an absolute file URL. Relative specifiers
* resolve inside the upstream server directory; bare ones resolve from this
* package (the SDK is a dependency here too, under the same import condition).
*/
function rewriteSpecifiers(source, upstreamServerDir) {
	return source.replace(/from\s+"([^"]+)"/g, (match, specifier) => {
		if (specifier.startsWith("node:")) return match;
		const url = specifier.startsWith(".") ? new URL(specifier, `file://${upstreamServerDir}/`).href : import.meta.resolve(specifier);
		return `from ${JSON.stringify(url)}`;
	});
}
/**
* Prefix the copy with its provenance marker, keeping a shebang on line one —
* the upstream entry starts with `#!`, and anything above it is a syntax error.
*/
function withHeader(source) {
	const marker = `// dsh-sight patch rev ${PATCH_REVISION}: http-proxy forwards sessionId (src/figma-ui-server-patch.ts)`;
	if (!source.startsWith("#!")) return `${marker}\n${source}`;
	const firstBreak = source.indexOf("\n");
	return firstBreak === -1 ? source : `${source.slice(0, firstBreak + 1)}${marker}\n${source.slice(firstBreak + 1)}`;
}
/**
* Materialize (or refresh) the patched entry from `upstreamServerDir`.
*
* Returns the managed entry's state. When the upstream file is missing or its
* proxy anchors moved, nothing is written and `error` explains why — the caller
* then falls back to the package's own entry, which keeps working for a single
* connected Figma file.
*/
function ensureBridgeServer(dir, upstreamServerDir, upstreamVersion) {
	const current = readBridgeServerAt(dir);
	if (current.patched && entryIsUsable(join(dir, "index.js"))) return current;
	try {
		const entry = join(upstreamServerDir, "index.js");
		if (!existsSync(entry)) throw new Error(`上游服务端入口缺失: ${entry}`);
		const source = readFileSync(entry, "utf8");
		if (!source.includes(PROXY_SIGNATURE) || !source.includes(PROXY_PATH)) throw new Error("上游服务器结构已变（找不到 http-proxy 锚点），未生成补丁入口");
		const patched = rewriteSpecifiers(source.replace(PROXY_SIGNATURE, PROXY_SIGNATURE_PATCHED).replace(PROXY_PATH, PROXY_PATH_PATCHED), upstreamServerDir);
		rmSync(dir, {
			recursive: true,
			force: true
		});
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "index.js"), withHeader(patched), "utf8");
		writeFileSync(join(dir, "version.json"), JSON.stringify({
			upstreamVersion,
			patch: PATCH_REVISION
		}, null, 2), "utf8");
		return {
			patched: true,
			entryPath: join(dir, "index.js"),
			error: null
		};
	} catch (error) {
		return {
			patched: false,
			entryPath: null,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
//#endregion
//#region src/config.ts
/**
* Shared wire vocabulary between the Host and browser halves: the loopback
* RPC channel, its endpoints, and the plain-JSON request/result types.
* @module dsh-sight/config
*/
/** Dedicated, loopback-only RPC channel registered by the Host half. */
const SIGHT_RPC_CHANNEL = "/sight";
/** Endpoints accepted by {@link SIGHT_RPC_CHANNEL}. */
const SIGHT_RPC = {
	status: "status",
	applyReasoning: "applyReasoning",
	figmaMcpStatus: "figmaMcpStatus",
	figmaMcpApply: "figmaMcpApply",
	figmaMcpRemove: "figmaMcpRemove",
	repoDirList: "repoDirList",
	figwrightPluginUpdate: "figwrightPluginUpdate",
	bridgePluginUpdate: "bridgePluginUpdate"
};
//#endregion
//#region src/index.ts
const name = "dsh-sight";
/** Settings namespace carrying the pi-ai provider profiles. */
const NS = "llm-pi-ai";
/** Settings namespace + provider route for the official DeepSeek channel (a distinct adapter, not a pi-ai provider). */
const DEEPSEEK_NS = "llm-deepseek";
const DEEPSEEK_PROVIDER = "deepseek-official";
/** Built-in DSH plugin that connects one stdio MCP server and mounts its tools. */
const FIGMA_MCP_PLUGIN = "@deepseek-ai/dsh-mcp-client";
/**
* Resolve the installed `figma-ui-mcp` package: the plugin directory whose
* manifest the settings page points at, the server directory the patched entry
* is generated from, plus its version. The package ships as a dependency and
* stays external in the build, so the child process this facade spawns has a
* real entry file on disk.
*/
const figmaUiPackage = () => {
	try {
		const resolved = createRequire(import.meta.url).resolve("figma-ui-mcp/package.json");
		const root = dirname(resolved);
		const pluginDir = join(root, "plugin");
		const serverDir = join(root, "server");
		if (!existsSync(join(pluginDir, "manifest.json"))) return null;
		if (!existsSync(join(serverDir, "index.js"))) return null;
		let version = "unknown";
		try {
			const pkg = JSON.parse(readFileSync(resolved, "utf8"));
			if (typeof pkg.version === "string" && pkg.version.length > 0) version = pkg.version;
		} catch {}
		return {
			pluginDir,
			serverDir,
			version
		};
	} catch {
		return null;
	}
};
/** Read-only localhost plugin MCP server entry (design-to-code). */
const FIGMA_READ_BIN = join(dirname(fileURLToPath(import.meta.url)), "figma-read-server.js");
/**
* Write-capable localhost plugin bridge entry: this package's own facade over
* the `figma-ui-mcp` server, which pins every read/write call to one Figma file
* instead of letting the bridge pick "whichever plugin polled last".
*/
const FIGMA_WRITE_BIN = join(dirname(fileURLToPath(import.meta.url)), "figma-ui-server.js");
/**
* Reasoning-effort dictionary. Keys are the pi-ai canonical thinking levels a
* hand-declared model may offer; values are the wire spellings sent on the
* request. The effort vocabulary follows each family's official API docs
* (DeepSeek: off/high/max; Grok 4.x: low/medium/high/xhigh; GLM-5.2:
* max/xhigh/high/medium/low/minimal/none; Kimi K3: low/high/max; GPT-5:
* low/medium/high). Matching a model id to a family here makes `applyReasoning`
* fill in a missing `reasoningEfforts` block for a freshly-added third-party
* channel, so the model picker gains its supported reasoning levels without
* hand-editing settings.
*
* `off: null` is the one level that may leave its wire value empty - pi-ai
* reads it as "supported, send nothing" (thinking left to the provider).
*/
const REASONING_DICTIONARY = [
	{
		re: /^gpt-5/,
		family: "OpenAI GPT-5",
		efforts: {
			off: null,
			high: "high",
			xhigh: "xhigh",
			max: "max"
		}
	},
	{
		re: /^o3/,
		family: "OpenAI o-series",
		efforts: {
			off: null,
			low: "low",
			medium: "medium",
			high: "high"
		}
	},
	{
		re: /^o4/,
		family: "OpenAI o-series",
		efforts: {
			off: null,
			low: "low",
			medium: "medium",
			high: "high"
		}
	},
	{
		re: /^grok-4/,
		family: "xAI Grok 4.x",
		efforts: {
			off: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh"
		}
	},
	{
		re: /^deepseek-v4/,
		family: "DeepSeek V4",
		efforts: {
			off: null,
			high: "high",
			max: "max"
		}
	},
	{
		re: /^glm-5/,
		family: "Zhipu GLM-5",
		efforts: {
			off: null,
			high: "high",
			xhigh: "xhigh",
			max: "max"
		}
	},
	{
		re: /^kimi-k3/,
		family: "Kimi K3",
		efforts: {
			off: null,
			low: "low",
			high: "high",
			max: "max"
		}
	},
	{
		re: /^qwen3/,
		family: "Qwen 3",
		efforts: {
			off: null,
			low: "low",
			medium: "medium",
			high: "high"
		}
	},
	{
		re: /^minimax/,
		family: "MiniMax",
		efforts: {
			off: null,
			high: "high"
		}
	}
];
/** First reasoning-dictionary family matching a model id, or undefined. */
function reasoningFamilyOf(modelId) {
	const id = modelId.toLowerCase();
	for (const entry of REASONING_DICTIONARY) if (entry.re.test(id)) return entry;
}
/** RPC success arm. */
function ok(value) {
	return {
		ok: true,
		value
	};
}
/** RPC failure arm. */
function fail(message) {
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
/** Cap for one `/sight` request body: every endpoint carries a small JSON payload. */
const MAX_SIGHT_BODY_BYTES = 1 << 20;
/** Abort signal handed to the connection-shaped handler; `/sight` work never outlives a request. */
const SIGHT_NEVER_ABORTED = new AbortController().signal;
/**
* Loopback Host/Origin fence for {@link SIGHT_RPC_CHANNEL}, mirroring the
* `authority: 'loopback'` check Connection applies to a registered channel.
* Only used on runtimes whose Connection exposes no `requestRejection`.
* @param req - raw request headers.
* @returns the HTTP status to reject with, or undefined to let the call through.
*/
function loopbackRejection(req) {
	const host = req.headers.host;
	if (host === void 0) return 403;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return 403;
	}
	const parts = hostUrl.hostname.split(".");
	if (!(hostUrl.hostname === "localhost" || hostUrl.hostname === "[::1]" || parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255))) return 403;
	if (req.headers["sec-fetch-site"] === "cross-site") return 403;
	const origin = req.headers.origin;
	if (origin === void 0) return void 0;
	try {
		return new URL(origin).host === hostUrl.host ? void 0 : 403;
	} catch {
		return 403;
	}
}
/**
* Endpoint named by a `/sight/<endpoint>` pathname.
* @param rawUrl - the request target.
* @returns the endpoint segment, or undefined when the path is not this channel's.
*/
function sightEndpoint(rawUrl) {
	const pathname = new URL(rawUrl ?? "/", "http://dsh.invalid").pathname;
	if (!pathname.startsWith(`/sight/`)) return void 0;
	const endpoint = pathname.slice(7);
	if (endpoint.split("/").some((segment) => segment.length === 0 || !/^[A-Za-z0-9_$.-]+$/.test(segment))) return void 0;
	return endpoint;
}
/**
* Buffer one request body, refusing anything past {@link MAX_SIGHT_BODY_BYTES}.
* @param req - raw request.
* @returns the decoded body text.
*/
function readSightBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_SIGHT_BODY_BYTES) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
/** Write one JSON response for the browser half. */
function writeSightJson(res, body) {
	res.writeHead(200, {
		"content-type": "application/json",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
/**
* Host half: serve the `/sight` channel. The route is registered on the web
* server directly rather than through `connection.rpc.handle`, because
* Connection 0.1.5+ resolves the web server against its *own* fiber when a
* caller mounts a channel (`owner.effect(() => owner.webServer.register(route))`
* after `const owner = this.ctx`), which fails with `cannot get property
* "webServer" without inject` for every plugin; the request then fell through
* to the static fallback as HTTP 405. The fence is Connection's own
* `requestRejection` when the runtime has it, and the equivalent loopback
* Host/Origin check otherwise. The web server is injected separately so a
* headless profile (no web server) still gets the rest of the Host half.
*/
function apply(ctx) {
	ctx.inject([
		"connection",
		"settings",
		"llm"
	], (sightCtx) => {
		const connection = sightCtx.get("connection");
		const settings = sightCtx.get("settings");
		const llm = sightCtx.get("llm");
		/** Raw (stored) user section of the llm-pi-ai namespace, or undefined. */
		const rawSection = () => {
			try {
				const user = settings.describe().find((d) => d.ns === NS)?.user;
				return user !== null && typeof user === "object" ? user : void 0;
			} catch {
				return;
			}
		};
		/** Whether the raw profile already declares a reasoning-effort map for one model. */
		const rawDeclaresReasoning = (profile, model) => {
			if (profile === void 0) return false;
			if (Array.isArray(profile.models)) {
				const efforts = profile.models.find((m) => m !== null && typeof m === "object" && m.id === model)?.reasoningEfforts;
				return efforts !== void 0 && efforts !== false && efforts !== null;
			}
			const efforts = (profile.modelOverrides?.[model])?.reasoningEfforts;
			return efforts !== void 0 && efforts !== false && efforts !== null;
		};
		/** Full overview for the settings page. */
		const status = async () => {
			const rawProviders = rawSection()?.providers;
			const reasoningDictionary = REASONING_DICTIONARY.map((entry) => ({
				family: entry.family,
				label: entry.re.source,
				efforts: Object.entries(entry.efforts).map(([level, wire]) => ({
					level,
					wire: wire ?? ""
				}))
			}));
			const providers = [];
			const configured = settings.get(NS)?.providers;
			if (configured !== void 0 && typeof configured === "object") for (const [provider, profile] of Object.entries(configured)) {
				const models = [];
				let error = null;
				try {
					const listed = await llm.listModels(provider);
					models.push(...await Promise.all(listed.map(async (m) => {
						let adapterReasoning;
						try {
							adapterReasoning = (await llm.resolveModelInfo(provider, m.id)).reasoning?.efforts;
						} catch {
							adapterReasoning = void 0;
						}
						const reasoning = (() => {
							if (Array.isArray(adapterReasoning)) {
								const levels = adapterReasoning.map((e) => typeof e?.id === "string" && e.id.length > 0 ? e.id : void 0).filter((id) => id !== void 0);
								if (levels.length > 0) return {
									source: "adapter",
									levels
								};
							}
							const efforts = (rawProviders?.[provider]?.models?.find((x) => x !== null && typeof x === "object" && x.id === m.id) ?? rawProviders?.[provider]?.modelOverrides?.[m.id])?.reasoningEfforts;
							if (efforts !== void 0 && efforts !== false && efforts !== null) return {
								source: "declared",
								levels: Object.keys(efforts)
							};
							return null;
						})();
						return {
							id: m.id,
							name: m.name,
							reasoning
						};
					})));
				} catch (caught) {
					error = caught instanceof Error ? caught.message : String(caught);
				}
				providers.push({
					provider,
					name: profile?.displayName ?? provider,
					models,
					error
				});
			}
			try {
				const deepseekSection = settings.get(DEEPSEEK_NS);
				const deepseekModels = Array.isArray(deepseekSection?.models) ? deepseekSection.models : [];
				if (deepseekModels.length > 0) {
					const models = await Promise.all(deepseekModels.map(async (dm) => {
						const id = typeof dm?.id === "string" ? dm.id : "";
						if (id.length === 0) return {
							id: "",
							name: "",
							reasoning: null
						};
						let adapterReasoning;
						try {
							adapterReasoning = (await llm.resolveModelInfo(DEEPSEEK_PROVIDER, id)).reasoning?.efforts;
						} catch {
							adapterReasoning = void 0;
						}
						const reasoning = (() => {
							if (Array.isArray(adapterReasoning)) {
								const levels = adapterReasoning.map((e) => typeof e?.id === "string" && e.id.length > 0 ? e.id : void 0).filter((l) => l !== void 0);
								if (levels.length > 0) return {
									source: "adapter",
									levels
								};
							}
							if (dm?.reasoningEfforts !== void 0 && dm.reasoningEfforts !== false && dm.reasoningEfforts !== null) return {
								source: "declared",
								levels: Object.keys(dm.reasoningEfforts)
							};
							return null;
						})();
						return {
							id,
							name: typeof dm?.name === "string" && dm.name.length > 0 ? dm.name : id,
							reasoning
						};
					}));
					providers.push({
						provider: DEEPSEEK_PROVIDER,
						name: "DeepSeek 官方",
						models,
						error: null
					});
				}
			} catch (de) {
				providers.push({
					provider: DEEPSEEK_PROVIDER,
					name: "DeepSeek 官方",
					models: [],
					error: de instanceof Error ? de.message : String(de)
				});
			}
			return {
				namespace: NS,
				reasoningDictionary,
				providers
			};
		};
		/**
		* Bulk-write a reasoning-effort map for every configured model matching the
		* reasoning dictionary and not yet declaring one. Hand-declared models in a
		* `models` list always gain the dictionary map (they have no other source
		* of reasoning); catalog-backed `modelOverrides` models are filled only when
		* the adapter does not already describe reasoning for them, so an installed
		* catalog's own levels are never overridden. Existing declared maps are
		* left untouched.
		*/
		const applyReasoning = async () => {
			const rawProviders = rawSection()?.providers;
			if (rawProviders === void 0 || typeof rawProviders !== "object") return {
				applied: 0,
				providers: 0,
				changes: []
			};
			let applied = 0;
			let touchedProviders = 0;
			const changes = [];
			for (const [provider, profile] of Object.entries(rawProviders)) {
				if (profile === void 0 || typeof profile !== "object") continue;
				const rawModels = Array.isArray(profile.models) ? profile.models : void 0;
				if (rawModels !== void 0) {
					let changed = false;
					const next = rawModels.map((m) => {
						if (m === null || typeof m !== "object" || typeof m.id !== "string") return m;
						if (rawDeclaresReasoning(profile, m.id)) return m;
						const match = reasoningFamilyOf(m.id);
						if (match === void 0) return m;
						changed = true;
						changes.push({
							provider,
							model: m.id,
							family: match.family,
							efforts: Object.entries(match.efforts).map(([level, wire]) => ({
								level,
								wire: wire ?? ""
							}))
						});
						return {
							...m,
							reasoningEfforts: { ...match.efforts }
						};
					});
					if (changed) {
						await settings.mutate(NS, [{
							op: "set",
							path: [
								"providers",
								provider,
								"models"
							],
							value: next
						}]);
						applied += next.filter((m) => m !== null && typeof m === "object" && m.reasoningEfforts !== void 0 && m.reasoningEfforts !== false).length;
						touchedProviders += 1;
					}
					continue;
				}
				const ops = [];
				try {
					const models = await llm.listModels(provider);
					for (const m of models) {
						if (rawDeclaresReasoning(profile, m.id)) continue;
						const match = reasoningFamilyOf(m.id);
						if (match === void 0) continue;
						try {
							if ((await llm.resolveModelInfo(provider, m.id)).reasoning !== void 0) continue;
						} catch {}
						ops.push({
							op: "set",
							path: [
								"providers",
								provider,
								"modelOverrides",
								m.id,
								"reasoningEfforts"
							],
							value: { ...match.efforts }
						});
						applied += 1;
						changes.push({
							provider,
							model: m.id,
							family: match.family,
							efforts: Object.entries(match.efforts).map(([level, wire]) => ({
								level,
								wire: wire ?? ""
							}))
						});
					}
					if (ops.length > 0) {
						await settings.mutate(NS, ops);
						touchedProviders += 1;
					}
				} catch {}
			}
			return {
				applied,
				providers: touchedProviders,
				changes
			};
		};
		/** Active profile name: the desktop launcher pins `desktop`; fall back to scanning. */
		const activeProfile = () => {
			const pinned = process.env.DSH_DESKTOP_DEFAULT_PROFILE;
			if (typeof pinned === "string" && pinned.length > 0) return pinned;
			try {
				const dir = join(dshHome(), "profiles");
				if (existsSync(dir)) {
					const candidates = readdirSync(dir).filter((name) => existsSync(join(dir, name, "cordis.patch.yml")));
					const single = candidates[0];
					if (candidates.length === 1 && single !== void 0) return single;
				}
			} catch {}
			return "desktop";
		};
		/** DSH home directory: `$DSH_HOME` else `~/.dsh`. */
		const dshHome = () => {
			const env = process.env.DSH_HOME;
			return typeof env === "string" && env.trim().length > 0 ? env.trim() : join(homedir(), ".dsh");
		};
		/** Absolute path of the active profile's patch layer. */
		const patchPath = () => join(dshHome(), "profiles", activeProfile(), "cordis.patch.yml");
		/** Read the patch file as a mutable array of top-level patch entries. */
		const readPatch = () => {
			const file = patchPath();
			if (!existsSync(file)) return [];
			const stripped = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
			try {
				const value = parse(stripped);
				return Array.isArray(value) ? value : [];
			} catch {
				throw new Error(`cannot parse ${file}`);
			}
		};
		/**
		* Find the `insert` entry carrying one Figma MCP row. Matches by the
		* mcp-client plugin name AND the mode's serverName (`figma-read` for the
		* read-only plugin server, `figma-ui` for the plugin bridge) so unrelated mcp-client
		* rows are never touched.
		*/
		const findFigmaRow = (patch, mode) => {
			const serverNames = mode === "read" ? /* @__PURE__ */ new Set(["figma-read", "figma"]) : /* @__PURE__ */ new Set(["figma-ui"]);
			for (const entry of patch) {
				if (entry === null || typeof entry !== "object") continue;
				const e = entry;
				if (typeof e.insert !== "object" || e.insert === null) continue;
				const list = Array.isArray(e.insert) ? e.insert : [e.insert];
				for (let i = 0; i < list.length; i++) {
					const row = list[i];
					if (row === null || typeof row !== "object") continue;
					const r = row;
					if (r.name !== FIGMA_MCP_PLUGIN) continue;
					const config = r.config;
					if (config === null || typeof config !== "object") continue;
					const c = config;
					if (typeof c.serverName === "string" && serverNames.has(c.serverName)) return {
						insertEntry: e,
						row: r,
						index: i
					};
				}
			}
			return null;
		};
		/** Read one mode's presence + token flag from a found row. */
		const rowStatus = (found) => {
			if (found === null) return {
				configured: false,
				hasToken: false
			};
			let hasToken = false;
			const config = found.row.config;
			if (config !== null && typeof config === "object") {
				const c = config;
				if (c.env !== null && typeof c.env === "object") {
					const env = c.env;
					hasToken = typeof env.FIGMA_API_KEY === "string" && env.FIGMA_API_KEY.length > 0;
				}
			}
			return {
				configured: true,
				hasToken
			};
		};
		/**
		* App-managed Figma UI MCP Bridge plugin copy, carrying the per-file
		* session patch. Rebuilt from the installed package whenever the upstream
		* version or the patch revision moved, so opening the settings page is
		* always enough to get a current copy to import.
		*/
		const bridgePluginDir$1 = () => bridgePluginDir(dirname(patchPath()));
		const bridgePluginState = () => {
			const upstream = figmaUiPackage();
			if (upstream === null) return {
				patched: false,
				upstreamVersion: null,
				manifestPath: null,
				error: "未找到 figma-ui-mcp 依赖"
			};
			return ensureBridgePlugin(bridgePluginDir$1(), upstream.pluginDir, upstream.version);
		};
		/** Upstream plugin manifest — the fallback when the patch cannot be applied. */
		const upstreamManifestPath = () => {
			const upstream = figmaUiPackage();
			return upstream === null ? null : join(upstream.pluginDir, "manifest.json");
		};
		/**
		* Generated figma-ui-mcp entry. The write facade regenerates it on every
		* start, so this is only what the settings page reports.
		*/
		const bridgeServerDir$1 = () => bridgeServerDir(dirname(patchPath()));
		const bridgeServerState = () => {
			const upstream = figmaUiPackage();
			if (upstream === null) return {
				patched: false,
				entryPath: null,
				error: "未找到 figma-ui-mcp 依赖"
			};
			return ensureBridgeServer(bridgeServerDir$1(), upstream.serverDir, upstream.version);
		};
		/** Force a rebuild of both patched assets (the settings page's "重新生成" action). */
		const bridgePluginRefresh = () => {
			try {
				rmSync(bridgePluginDir$1(), {
					recursive: true,
					force: true
				});
			} catch {}
			try {
				rmSync(bridgeServerDir$1(), {
					recursive: true,
					force: true
				});
			} catch {}
			const state = bridgePluginState();
			return {
				ok: state.patched,
				...state,
				bridgeServer: bridgeServerState()
			};
		};
		const sightReadStatePath = () => join(dirname(patchPath()), "sight-figma-read.json");
		/** Active read-mode backend + grounding directory; defaults to figma-ui-mcp. */
		const readSightReadState = () => {
			try {
				const file = sightReadStatePath();
				if (!existsSync(file)) return {
					backend: "figma-ui-mcp",
					repoDir: null
				};
				const value = JSON.parse(readFileSync(file, "utf8"));
				return {
					backend: value.backend === "figwright" ? "figwright" : "figma-ui-mcp",
					repoDir: typeof value.repoDir === "string" && value.repoDir.length > 0 ? value.repoDir : null
				};
			} catch {
				return {
					backend: "figma-ui-mcp",
					repoDir: null
				};
			}
		};
		/** Atomically persist the read-mode engine choice. */
		const writeSightReadState = (backend, repoDir) => {
			const file = sightReadStatePath();
			const dir = dirname(file);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			const tmp = `${file}.tmp`;
			writeFileSync(tmp, JSON.stringify({
				backend,
				repoDir
			}, null, 2), "utf8");
			renameSync(tmp, file);
		};
		/** Drop the read-mode engine state (used when the read row is removed). */
		const clearSightReadState = () => {
			try {
				rmSync(sightReadStatePath(), { force: true });
			} catch {}
		};
		const sightUiStatePath = () => join(dirname(patchPath()), "sight-figma-ui.json");
		/** Drop the pinned write target (used when the write row is removed). */
		const clearSightUiState = () => {
			try {
				rmSync(sightUiStatePath(), { force: true });
			} catch {}
		};
		/** Validate the grounding directory a user picked for the figwright engine. */
		const validateRepoDir = (repoDir) => {
			if (!isAbsolute(repoDir)) return "repoDir 必须是绝对路径";
			try {
				if (!statSync(repoDir).isDirectory()) return `repoDir 不是目录: ${repoDir}`;
			} catch {
				return `repoDir 不存在: ${repoDir}`;
			}
			return null;
		};
		/**
		* List a directory's subdirectories for the settings-page repoDir picker.
		* Browsing stays on the host (the browser cannot reveal absolute paths),
		* travels only over the loopback channel, and never leaves the machine.
		* An omitted/invalid request path falls back to the home directory.
		*/
		const listRepoDirs = (requestPath) => {
			const path = typeof requestPath === "string" && requestPath.length > 0 && isAbsolute(requestPath) ? requestPath : homedir();
			try {
				const dirs = readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name).filter((name) => !name.startsWith(".")).sort((a, b) => a.localeCompare(b, void 0, { sensitivity: "base" })).map((name) => join(path, name));
				return {
					path,
					parent: dirname(path) === path ? null : dirname(path),
					dirs,
					error: null
				};
			} catch (error) {
				return {
					path,
					parent: null,
					dirs: [],
					error: error instanceof Error ? error.message : String(error)
				};
			}
		};
		/** Serialize the patch array back to the file (UTF-8, no BOM). */
		const writePatch = (patch) => {
			const file = patchPath();
			const dir = dirname(file);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(file, stringify(patch), "utf8");
		};
		/** Where the latest Figwright plugin copy is kept (single, overwritten). */
		const figwrightPluginDir$1 = () => figwrightPluginDir(dirname(patchPath()));
		const figwrightPluginState = () => readFigwrightPluginAt(figwrightPluginDir$1());
		const figwrightPluginUpdate = () => installLatestFigwrightPlugin(figwrightPluginDir$1());
		/** Status: both capabilities' presence in the patch. */
		const figmaMcpStatus = () => {
			const file = patchPath();
			try {
				const patch = readPatch();
				const bridge = bridgePluginState();
				const bridgeServer = bridgeServerState();
				const manifest = bridge.manifestPath ?? upstreamManifestPath();
				const read = rowStatus(findFigmaRow(patch, "read"));
				const write = rowStatus(findFigmaRow(patch, "write"));
				const readEngine = readSightReadState();
				return {
					read: {
						...read,
						backend: readEngine.backend,
						repoDir: readEngine.repoDir,
						manifestPath: readEngine.backend === "figma-ui-mcp" ? manifest : null,
						figwrightPlugin: figwrightPluginState(),
						bridgePlugin: bridge,
						bridgeServer
					},
					write: {
						...write,
						backend: "figma-ui-mcp",
						repoDir: null,
						manifestPath: manifest,
						figwrightPlugin: {
							installedTag: null,
							manifestPath: null
						},
						bridgePlugin: bridge,
						bridgeServer
					},
					patchPath: file,
					profile: activeProfile(),
					error: null
				};
			} catch (error) {
				const none = {
					patched: false,
					upstreamVersion: null,
					manifestPath: null,
					error: null
				};
				const noneServer = {
					patched: false,
					entryPath: null,
					error: null
				};
				return {
					read: {
						configured: false,
						hasToken: false,
						manifestPath: null,
						backend: "figma-ui-mcp",
						repoDir: null,
						figwrightPlugin: {
							installedTag: null,
							manifestPath: null
						},
						bridgePlugin: none,
						bridgeServer: noneServer
					},
					write: {
						configured: false,
						hasToken: false,
						manifestPath: null,
						backend: "figma-ui-mcp",
						repoDir: null,
						figwrightPlugin: {
							installedTag: null,
							manifestPath: null
						},
						bridgePlugin: none,
						bridgeServer: noneServer
					},
					patchPath: file,
					profile: activeProfile(),
					error: error instanceof Error ? error.message : String(error)
				};
			}
		};
		/**
		* Write (or update) one Figma MCP row.
		* - read mode: local plugin bridge facade, no token or external network.
		*   The engine (figma-ui-mcp | figwright) and grounding directory are
		*   persisted to the sight state file; the spawned facade watches it and
		*   swaps its read-only tool surface live.
		* - write mode: bare stdio entry, talks to the Figma Desktop plugin over
		*   localhost - no token, no proxy.
		*/
		const figmaMcpApply = async (req) => {
			const mode = req.mode;
			if (mode !== "read" && mode !== "write") return {
				ok: false,
				patchPath: patchPath(),
				error: "mode must be \"read\" or \"write\""
			};
			let row;
			if (mode === "read") {
				const backend = req.backend === "figwright" ? "figwright" : "figma-ui-mcp";
				let repoDir = null;
				const rawRepoDir = typeof req.repoDir === "string" ? req.repoDir.trim() : "";
				if (rawRepoDir.length > 0) {
					const invalid = validateRepoDir(rawRepoDir);
					if (invalid !== null) return {
						ok: false,
						patchPath: patchPath(),
						error: invalid
					};
					repoDir = rawRepoDir;
				}
				row = {
					id: "figma-read-mcp",
					name: FIGMA_MCP_PLUGIN,
					config: {
						transport: "stdio",
						serverName: "figma-read",
						command: "node",
						args: [FIGMA_READ_BIN],
						env: { SIGHT_READ_STATE: sightReadStatePath() }
					}
				};
				try {
					const patch = readPatch();
					let found = findFigmaRow(patch, "read");
					while (found !== null) {
						const list = Array.isArray(found.insertEntry.insert) ? found.insertEntry.insert : [found.insertEntry.insert];
						list.splice(found.index, 1);
						found.insertEntry.insert = list;
						found = findFigmaRow(patch, "read");
					}
					patch.push({ insert: [row] });
					writePatch(patch);
					writeSightReadState(backend, repoDir);
				} catch (error) {
					return {
						ok: false,
						patchPath: patchPath(),
						error: error instanceof Error ? error.message : String(error)
					};
				}
				return {
					ok: true,
					patchPath: patchPath(),
					error: null
				};
			}
			row = {
				id: "figma-ui-mcp",
				name: FIGMA_MCP_PLUGIN,
				config: {
					transport: "stdio",
					serverName: "figma-ui",
					command: "node",
					args: [FIGMA_WRITE_BIN],
					env: { SIGHT_UI_STATE: sightUiStatePath() }
				}
			};
			try {
				const patch = readPatch();
				let found = findFigmaRow(patch, "write");
				if (found !== null) {
					const list = Array.isArray(found.insertEntry.insert) ? found.insertEntry.insert : [found.insertEntry.insert];
					list[found.index] = row;
					found.insertEntry.insert = list;
				} else patch.push({ insert: [row] });
				writePatch(patch);
				return {
					ok: true,
					patchPath: patchPath(),
					error: null
				};
			} catch (error) {
				return {
					ok: false,
					patchPath: patchPath(),
					error: error instanceof Error ? error.message : String(error)
				};
			}
		};
		/** Remove one Figma MCP row. */
		const figmaMcpRemove = (mode) => {
			try {
				const patch = readPatch();
				let found = findFigmaRow(patch, mode);
				while (found !== null) {
					const list = Array.isArray(found.insertEntry.insert) ? found.insertEntry.insert : [found.insertEntry.insert];
					list.splice(found.index, 1);
					found.insertEntry.insert = list;
					found = findFigmaRow(patch, mode);
				}
				writePatch(patch);
				if (mode === "read") clearSightReadState();
				else clearSightUiState();
				return {
					ok: true,
					patchPath: patchPath(),
					error: null
				};
			} catch (error) {
				return {
					ok: false,
					patchPath: patchPath(),
					error: error instanceof Error ? error.message : String(error)
				};
			}
		};
		const handler = async (endpoint, payload) => {
			try {
				switch (endpoint) {
					case SIGHT_RPC.status: return ok(await status());
					case SIGHT_RPC.applyReasoning: return ok(await applyReasoning());
					case SIGHT_RPC.figmaMcpStatus: return ok(figmaMcpStatus());
					case SIGHT_RPC.figmaMcpApply: return ok(await figmaMcpApply(payload));
					case SIGHT_RPC.figmaMcpRemove: {
						const p = payload;
						if (p.mode !== "read" && p.mode !== "write") return fail("figmaMcpRemove requires { mode }");
						return ok(figmaMcpRemove(p.mode));
					}
					case SIGHT_RPC.repoDirList: {
						const p = payload;
						return ok(listRepoDirs(typeof p.path === "string" ? p.path : void 0));
					}
					case SIGHT_RPC.figwrightPluginUpdate: return ok(await figwrightPluginUpdate());
					case SIGHT_RPC.bridgePluginUpdate: return ok(bridgePluginRefresh());
					default: return fail(`unknown dsh-sight endpoint "${String(endpoint)}"`);
				}
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		};
		/** Connection's own browser fence when the runtime provides one, else the loopback equivalent. */
		const connectionFence = connection;
		const reject = typeof connectionFence.requestRejection === "function" ? (req) => connectionFence.requestRejection?.(req) : loopbackRejection;
		sightCtx.inject(["webServer"], (webCtx) => {
			const webServer = webCtx.get("webServer");
			webCtx.effect(() => webServer.register({
				kind: "prefix",
				path: SIGHT_RPC_CHANNEL,
				handler: async (req, res) => {
					const rejection = reject(req);
					if (rejection !== void 0) {
						res.writeHead(rejection);
						res.end(rejection === 401 ? "unauthorized" : "forbidden");
						return;
					}
					const endpoint = sightEndpoint(req.url);
					if (req.method !== "POST" || endpoint === void 0) {
						res.writeHead(404);
						res.end();
						return;
					}
					if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
						res.writeHead(415);
						res.end("content type must be application/json");
						return;
					}
					let envelope;
					try {
						envelope = JSON.parse(await readSightBody(req));
					} catch {
						res.writeHead(400);
						res.end("body is not JSON");
						return;
					}
					const rpcId = typeof envelope.rpcId === "string" ? envelope.rpcId : "invalid-request";
					if (envelope.method !== endpoint) {
						writeSightJson(res, {
							type: "server-response",
							rpcId,
							result: fail(`method ${JSON.stringify(String(envelope.method))} does not match endpoint ${JSON.stringify(endpoint)}`)
						});
						return;
					}
					try {
						writeSightJson(res, {
							type: "server-response",
							rpcId,
							result: await handler(endpoint, envelope.payload, SIGHT_NEVER_ABORTED)
						});
					} catch (error) {
						res.writeHead(500);
						res.end(`handler failure: ${String(error)}`);
					}
				}
			}), "dsh-sight: /sight route");
		});
	});
}
//#endregion
export { apply, name };
