#!/usr/bin/env node
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import http from "node:http";
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
//#region src/figma-ui-server.ts
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
/**
* The bridge's primary port. Mirrors figma-ui-mcp's `CONFIG.PORT` (same env var,
* same default) without importing the package, so this facade keeps working
* even if that module's layout changes.
*/
const BRIDGE_PORT = (() => {
	const raw = process.env.FIGMA_MCP_PORT;
	const parsed = raw === void 0 ? NaN : Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 38451;
})();
/**
* Ask the bridge what is connected. The bridge is the single source of truth
* for session ids, so routing is decided here rather than inferred from tool
* results. An unreachable bridge is reported, not thrown: the child still gets
* the call and produces its own (better-informed) error.
*/
function bridgeHealth() {
	return new Promise((resolve) => {
		const req = http.request({
			hostname: "127.0.0.1",
			port: BRIDGE_PORT,
			path: "/health",
			method: "GET"
		}, (res) => {
			let data = "";
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				try {
					const parsed = JSON.parse(data);
					resolve({
						reachable: true,
						sessions: Array.isArray(parsed.sessions) ? parsed.sessions.flatMap((entry) => {
							if (entry === null || typeof entry !== "object") return [];
							const s = entry;
							if (typeof s.id !== "string") return [];
							return [{
								id: s.id,
								fileName: typeof s.fileName === "string" ? s.fileName : null,
								connected: s.connected === true,
								lastPollAgoMs: typeof s.lastPollAgoMs === "number" ? s.lastPollAgoMs : null,
								queueLength: typeof s.queueLength === "number" ? s.queueLength : 0,
								ops: typeof s.ops === "number" ? s.ops : 0
							}];
						}) : []
					});
				} catch {
					resolve({
						reachable: false,
						sessions: []
					});
				}
			});
		});
		req.on("error", () => resolve({
			reachable: false,
			sessions: []
		}));
		req.setTimeout(2e3, () => {
			req.destroy();
			resolve({
				reachable: false,
				sessions: []
			});
		});
		req.end();
	});
}
const statePath = process.env.SIGHT_UI_STATE ?? "";
/** The session pinned by `figma_files`, or null (auto). Unreadable = null. */
function readPinned() {
	if (statePath.length === 0) return null;
	try {
		const raw = JSON.parse(readFileSync(statePath, "utf8"));
		return typeof raw.sessionId === "string" && raw.sessionId.length > 0 ? raw.sessionId : null;
	} catch {
		return null;
	}
}
/** Persist the pin (null clears it). Throws when the state file is unwritable. */
function writePinned(sessionId) {
	if (statePath.length === 0) throw new Error("SIGHT_UI_STATE is not configured — the pin cannot be persisted.");
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, JSON.stringify({ sessionId }, null, 2), "utf8");
}
/** A session is identified when the patched plugin named its Figma file. */
const isIdentified = (session) => session.fileName !== null && session.fileName.length > 0 && session.fileName !== "unknown";
const describe = (sessions) => sessions.length === 0 ? "none" : sessions.map((s) => `${isIdentified(s) ? s.fileName : "(unnamed plugin)"} [${s.id}]`).join(", ");
const LEGACY_NOTE = "Warning: the connected Figma plugin does not carry the per-file session patch, so it registered as the anonymous default session and routing is only reliable while ONE Figma file has the plugin running. Re-import \"Figma UI MCP Bridge (Sight)\" from the path shown in DSH → Sight → settings to enable multi-file routing.";
/**
* Set when the child had to fall back to the package's own entry: that one
* drops `sessionId` in http-proxy mode, so the pin is only guaranteed when the
* child owns the bridge itself.
*/
const unpatchedChildNote = () => unpatchedChildReason === null ? null : `Warning: the generated figma-ui-mcp entry could not be used (${unpatchedChildReason}), so the package's own entry is running. When another process owns the bridge (http-proxy mode) it drops sessionId, and routing falls back to whichever plugin polled last.`;
/** Join the applicable warnings into one note block. */
const notesOf = (...notes) => {
	const kept = notes.filter((note) => note !== null);
	return kept.length === 0 ? null : kept.join("\n\n");
};
/** Decide which Figma file this call targets — never by guessing. */
async function route(explicit) {
	const health = await bridgeHealth();
	if (!health.reachable) return {
		ok: true,
		route: {
			sessionId: explicit ?? null,
			mode: "none",
			fileName: null,
			warning: null
		},
		sessions: []
	};
	const connected = health.sessions.filter((session) => session.connected);
	const legacy = (session) => isIdentified(session) ? null : LEGACY_NOTE;
	if (explicit !== void 0) {
		const hit = connected.find((session) => session.id === explicit);
		if (hit === void 0) return {
			ok: false,
			sessions: connected,
			error: `sessionId "${explicit}" is not connected. Connected files: ${describe(connected)}. Call figma_files to see the current list.`
		};
		return {
			ok: true,
			sessions: connected,
			route: {
				sessionId: hit.id,
				mode: "explicit",
				fileName: hit.fileName,
				warning: legacy(hit)
			}
		};
	}
	const pinned = readPinned();
	if (pinned !== null) {
		const hit = connected.find((session) => session.id === pinned);
		if (hit === void 0) return {
			ok: false,
			sessions: connected,
			error: `The pinned file (sessionId "${pinned}") is not connected. Connected files: ${describe(connected)}. Re-run the plugin in that file, or call figma_files with a new target (or { clear: true }).`
		};
		return {
			ok: true,
			sessions: connected,
			route: {
				sessionId: hit.id,
				mode: "pinned",
				fileName: hit.fileName,
				warning: legacy(hit)
			}
		};
	}
	if (connected.length === 1) {
		const only = connected[0];
		return {
			ok: true,
			sessions: connected,
			route: {
				sessionId: only.id,
				mode: "single",
				fileName: only.fileName,
				warning: legacy(only)
			}
		};
	}
	if (connected.length === 0) return {
		ok: false,
		sessions: connected,
		error: "No Figma file is connected. In Figma Desktop run the \"Figma UI MCP Bridge (Sight)\" plugin (Plugins → Development) and wait for its green dot."
	};
	return {
		ok: false,
		sessions: connected,
		error: `${connected.length} Figma files are connected and no target is pinned: ${describe(connected)}. Call figma_files with { use: "<fileName>" } (or an explicit sessionId) before reading or writing.`
	};
}
/** The installed package's server directory + version. */
function upstreamServer() {
	try {
		const pkgPath = createRequire(import.meta.url).resolve("figma-ui-mcp/package.json");
		const dir = join(dirname(pkgPath), "server");
		if (!existsSync(join(dir, "index.js"))) return null;
		let version = "unknown";
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			if (typeof pkg.version === "string" && pkg.version.length > 0) version = pkg.version;
		} catch {}
		return {
			dir,
			version
		};
	} catch {
		return null;
	}
}
/** Why the generated entry is unavailable (set when the upstream one is used). */
let unpatchedChildReason = null;
/**
* Entry to spawn. The generated copy is preferred: its http-proxy forwards
* `sessionId`, without which routing degrades to "whichever plugin polled last"
* whenever another process owns the bridge. It is regenerated here rather than
* only from the settings page, so a moved module store or an upgraded package
* can never leave a stale copy behind.
*/
function childEntry() {
	const upstream = upstreamServer();
	if (upstream === null) throw new Error("figma-ui-mcp is not installed, so the write bridge cannot start.");
	if (statePath.length > 0) {
		const state = ensureBridgeServer(bridgeServerDir(dirname(statePath)), upstream.dir, upstream.version);
		if (state.patched && state.entryPath !== null) return state.entryPath;
		unpatchedChildReason = state.error ?? "unknown";
	}
	return join(upstream.dir, "index.js");
}
/** Tools whose calls can be pinned to one Figma file (upstream schema). */
const ROUTED_TOOLS = /* @__PURE__ */ new Set([
	"figma_read",
	"figma_rules",
	"figma_write"
]);
/** Suffix appended to routed tools' descriptions so the routing rule is visible. */
const ROUTING_SUFFIX = " Routing: pass sessionId to target a specific Figma file; otherwise the file shown by figma_files is used (exactly one connected file auto-selects; several files without a pin fail with the candidate list).";
var UpstreamEngine = class {
	client = null;
	specs = [];
	get tools() {
		return this.specs;
	}
	/** Spawn the child once and cache its tool list. */
	async ensure() {
		if (this.client !== null) return;
		let lastError = null;
		for (let attempt = 0; attempt < 2; attempt++) try {
			const client = new Client({
				name: "figma-ui-bridge",
				version: "1.0.0"
			}, { capabilities: {} });
			const transport = new StdioClientTransport({
				command: process.execPath,
				args: [childEntry()],
				env: { FIGMA_MCP_PORT: String(BRIDGE_PORT) },
				stderr: "inherit"
			});
			await client.connect(transport);
			this.client = client;
			this.specs = await this.listTools(client);
			return;
		} catch (error) {
			lastError = error;
			this.client = null;
			this.specs = [];
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}
	async listTools(client) {
		const specs = [];
		let cursor;
		for (;;) {
			const page = await client.listTools(cursor === void 0 ? {} : { cursor });
			for (const tool of page.tools) specs.push({
				name: tool.name,
				...tool.description !== void 0 ? { description: ROUTED_TOOLS.has(tool.name) ? `${tool.description}${ROUTING_SUFFIX}` : tool.description } : {},
				...tool.inputSchema !== void 0 ? { inputSchema: tool.inputSchema } : {}
			});
			cursor = page.nextCursor;
			if (cursor === void 0) break;
		}
		return specs;
	}
	async call(name, args) {
		await this.ensure();
		if (this.client === null) throw new Error("figma-ui-mcp child is not running.");
		return await this.client.callTool({
			name,
			arguments: args
		});
	}
	async close() {
		const client = this.client;
		this.client = null;
		this.specs = [];
		if (client !== null) await client.close().catch(() => {});
	}
};
const upstream = new UpstreamEngine();
function errorResult(message) {
	return {
		isError: true,
		content: [{
			type: "text",
			text: message
		}]
	};
}
const textOf = (result) => {
	const block = result.content.find((part) => part.type === "text");
	return block !== void 0 && "text" in block && typeof block.text === "string" ? block.text : null;
};
/** Prepend a note as its own block, keeping the child's payload intact. */
function withNote(result, note) {
	if (note === null) return result;
	return {
		...result,
		content: [{
			type: "text",
			text: note
		}, ...result.content]
	};
}
const FILES_TOOL = {
	name: "figma_files",
	description: "List the Figma files currently connected to the bridge and show which one this session routes to. Pass { use: \"<fileName>\" } (or a sessionId) to pin the target for figma_read / figma_rules / figma_write; pass { clear: true } to drop the pin. Reads and writes fail rather than guess when several files are connected and none is pinned.",
	inputSchema: {
		type: "object",
		properties: {
			use: {
				type: "string",
				description: "fileName (or sessionId) to pin as the routing target. Ambiguous file names are rejected — pass the sessionId then."
			},
			clear: {
				type: "boolean",
				description: "true = clear the pin and fall back to auto routing (single connected file)."
			}
		},
		required: []
	}
};
async function handleFiles(args) {
	const health = await bridgeHealth();
	if (!health.reachable) return errorResult(`The bridge on 127.0.0.1:${BRIDGE_PORT} is not responding. Start DSH's Figma write capability first.`);
	const connected = health.sessions.filter((session) => session.connected);
	if (args.clear === true) writePinned(null);
	else if (typeof args.use === "string" && args.use.length > 0) {
		const wanted = args.use;
		const byId = connected.filter((session) => session.id === wanted);
		const byName = connected.filter((session) => session.fileName === wanted);
		const hit = byId[0] ?? byName[0];
		if (hit === void 0) return errorResult(`No connected file matches "${wanted}". Connected files: ${describe(connected)}.`);
		if (byId.length === 0 && byName.length > 1) return errorResult(`"${wanted}" matches ${byName.length} connected files — pin one by sessionId instead: ${describe(byName)}.`);
		writePinned(hit.id);
	}
	const pinned = readPinned();
	const targets = (pinned === null ? void 0 : connected.find((session) => session.id === pinned)) ?? (connected.length === 1 ? connected[0] : void 0);
	const payload = {
		bridgePort: BRIDGE_PORT,
		files: connected.map((session) => ({
			sessionId: session.id,
			fileName: isIdentified(session) ? session.fileName : null,
			identified: isIdentified(session),
			lastPollAgoMs: session.lastPollAgoMs
		})),
		pinned,
		routing: {
			mode: pinned !== null ? "pinned" : connected.length === 1 ? "single" : connected.length === 0 ? "none" : "ambiguous",
			sessionId: pinned ?? (connected.length === 1 ? connected[0].id : null),
			fileName: targets !== void 0 && isIdentified(targets) ? targets.fileName : null
		},
		warning: notesOf(unpatchedChildNote()),
		hint: connected.length === 0 ? "No plugin is connected: run \"Figma UI MCP Bridge (Sight)\" in Figma Desktop (Plugins → Development)." : pinned !== null ? "Reads and writes target the pinned file." : connected.length === 1 ? "One file connected: reads and writes target it automatically." : "Several files connected: pin one with { use: \"<fileName>\" } before reading or writing."
	};
	return { content: [{
		type: "text",
		text: JSON.stringify(payload, null, 2)
	}] };
}
/**
* Re-attach the real session list (and the routing decision) to the child's
* `figma_status` payload: in HTTP-proxy mode the child reports `sessions: []`,
* and its `fileName` reflects whichever instance happened to answer.
*/
async function enrichStatus(result) {
	const text = textOf(result);
	if (text === null) return result;
	try {
		const parsed = JSON.parse(text);
		const connected = (await bridgeHealth()).sessions.filter((session) => session.connected);
		const pinned = readPinned();
		const files = connected.map((session) => ({
			sessionId: session.id,
			fileName: isIdentified(session) ? session.fileName : null,
			identified: isIdentified(session),
			lastPollAgoMs: session.lastPollAgoMs
		}));
		const enriched = {
			...parsed,
			sessions: files,
			warning: notesOf(unpatchedChildNote()),
			routing: {
				pinned,
				mode: pinned !== null ? "pinned" : connected.length === 1 ? "single" : connected.length === 0 ? "none" : "ambiguous",
				hint: connected.length > 1 && pinned === null ? "Multiple files connected: call figma_files with { use: \"<fileName>\" } first — reads and writes will not guess." : connected.some((session) => !isIdentified(session)) ? "An anonymous (unpatched) plugin is connected: re-import \"Figma UI MCP Bridge (Sight)\" from the DSH settings path to enable per-file routing." : null
			}
		};
		return {
			...result,
			content: [{
				type: "text",
				text: JSON.stringify(enriched, null, 2)
			}, ...result.content.slice(1)]
		};
	} catch {
		return result;
	}
}
const server = new Server({
	name: "figma-ui-bridge",
	version: "1.0.0"
}, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
	await upstream.ensure();
	return { tools: [FILES_TOOL, ...upstream.tools] };
});
server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
	const input = args ?? {};
	if (name === "figma_files") try {
		return await handleFiles(input);
	} catch (error) {
		return errorResult(error instanceof Error ? error.message : String(error));
	}
	if (!ROUTED_TOOLS.has(name)) try {
		const result = await upstream.call(name, input);
		return name === "figma_status" ? await enrichStatus(result) : result;
	} catch (error) {
		return errorResult(error instanceof Error ? error.message : String(error));
	}
	const decided = await route(typeof input.sessionId === "string" && input.sessionId.length > 0 ? input.sessionId : void 0);
	if (!decided.ok) return errorResult(decided.error);
	const payload = decided.route.sessionId === null ? input : {
		...input,
		sessionId: decided.route.sessionId
	};
	try {
		return withNote(await upstream.call(name, payload), notesOf(decided.route.warning, unpatchedChildNote()));
	} catch (error) {
		return errorResult(error instanceof Error ? error.message : String(error));
	}
});
const shutdown = async () => {
	await upstream.close().catch(() => {});
	process.exit(0);
};
process.on("SIGINT", () => {
	shutdown();
});
process.on("SIGTERM", () => {
	shutdown();
});
var SelfReportingStdioTransport = class extends StdioServerTransport {
	onClosed;
	constructor(onClosed) {
		super();
		this.onClosed = onClosed;
	}
	async close() {
		await super.close();
		this.onClosed();
	}
};
await server.connect(new SelfReportingStdioTransport(() => {
	shutdown();
}));
//#endregion
export {};
