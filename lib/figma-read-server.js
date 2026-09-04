#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BridgeServer, CONFIG } from "figma-ui-mcp/server/bridge-server.js";
import http from "node:http";
//#region src/figma-read-server.ts
/**
* Read-only MCP facade for the Figma UI plugin bridge.
*
* The upstream bridge plugin can write, but this server intentionally exposes
* only read tools and rejects every non-read operation before it reaches the
* bridge. The write-capable figma-ui-mcp server remains a separate opt-in row.
*/
const READ_OPERATIONS = /* @__PURE__ */ new Set([
	"get_selection",
	"get_design",
	"get_page_nodes",
	"screenshot",
	"export_svg",
	"get_styles",
	"get_local_components",
	"get_viewport",
	"get_variables",
	"get_node_detail",
	"get_css",
	"get_design_context",
	"get_component_map",
	"get_unmapped_components",
	"export_image",
	"search_nodes",
	"scan_design"
]);
const TOOLS = [
	{
		name: "figma_status",
		description: "Check whether the read-only Figma plugin bridge is connected.",
		inputSchema: {
			type: "object",
			properties: {},
			required: []
		}
	},
	{
		name: "figma_read",
		description: "Read design data, styles, tokens, components, CSS, SVG, or screenshots from the current Figma canvas. This tool cannot modify the canvas.",
		inputSchema: {
			type: "object",
			properties: {
				operation: {
					type: "string",
					enum: [...READ_OPERATIONS]
				},
				nodeId: { type: "string" },
				nodeName: { type: "string" },
				scale: { type: "number" },
				depth: { type: "string" },
				format: { type: "string" },
				detail: { type: "string" },
				includeHidden: { type: "boolean" },
				sessionId: { type: "string" }
			},
			required: ["operation"]
		}
	},
	{
		name: "figma_rules",
		description: "Read the current Figma file design system: paint styles, variables, typography, and local components.",
		inputSchema: {
			type: "object",
			properties: { sessionId: { type: "string" } },
			required: []
		}
	}
];
function errorResult(message) {
	return {
		isError: true,
		content: [{
			type: "text",
			text: message
		}]
	};
}
function notConnected() {
	return errorResult("Figma read-only plugin is not connected. Run the 'Figma UI MCP Bridge' plugin in Figma Desktop first.");
}
function health() {
	return new Promise((resolve) => {
		const req = http.request({
			hostname: "127.0.0.1",
			port: CONFIG.PORT,
			path: "/health",
			method: "GET"
		}, (res) => {
			let data = "";
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch {
					resolve({ pluginConnected: false });
				}
			});
		});
		req.on("error", () => resolve({ pluginConnected: false }));
		req.setTimeout(2e3, () => {
			req.destroy();
			resolve({ pluginConnected: false });
		});
		req.end();
	});
}
async function createBridge() {
	if ((await health()).pluginConnected) return {
		bridge: {
			port: CONFIG.PORT,
			isPluginConnected: async () => (await health()).pluginConnected === true,
			sendOperation: (operation, params, sessionId) => postExec(operation, params, sessionId),
			checkHealth: health
		},
		proxy: true
	};
	const bridge = await new BridgeServer().start();
	if (bridge.port !== CONFIG.PORT) {
		if ((await health()).pluginConnected !== void 0) {
			bridge.stop();
			return {
				bridge: {
					port: CONFIG.PORT,
					isPluginConnected: async () => (await health()).pluginConnected === true,
					sendOperation: (operation, params, sessionId) => postExec(operation, params, sessionId),
					checkHealth: health
				},
				proxy: true
			};
		}
	}
	return {
		bridge,
		proxy: false
	};
}
function postExec(operation, params, sessionId) {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify({
			operation,
			params
		});
		const path = sessionId ? `/exec?sessionId=${encodeURIComponent(sessionId)}` : "/exec";
		const req = http.request({
			hostname: "127.0.0.1",
			port: CONFIG.PORT,
			path,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(payload)
			}
		}, (res) => {
			let data = "";
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				try {
					const parsed = JSON.parse(data);
					if (parsed.success) resolve(parsed.data);
					else reject(new Error(parsed.error ?? "Bridge error"));
				} catch {
					reject(/* @__PURE__ */ new Error("Invalid bridge response"));
				}
			});
		});
		req.on("error", (error) => reject(/* @__PURE__ */ new Error(`Bridge connection failed: ${error.message}`)));
		req.setTimeout(CONFIG.OP_TIMEOUT_MS, () => {
			req.destroy();
			reject(/* @__PURE__ */ new Error("Bridge timeout"));
		});
		req.end(payload);
	});
}
const { bridge } = await createBridge();
const server = new Server({
	name: "figma-read-mcp",
	version: "1.0.0"
}, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
	if (name === "figma_status") {
		const connected = await bridge.isPluginConnected();
		let pluginInfo = null;
		if (connected) try {
			pluginInfo = await bridge.sendOperation("status", {});
		} catch {}
		return { content: [{
			type: "text",
			text: JSON.stringify({
				bridgePort: bridge.port || CONFIG.PORT,
				pluginConnected: connected,
				pluginInfo,
				readOnly: true,
				hint: connected ? "CONNECTED. Read operations only." : "Run the Figma UI MCP Bridge plugin in Figma Desktop."
			}, null, 2)
		}] };
	}
	if (name === "figma_read") {
		const input = args ?? {};
		const operation = input.operation;
		if (typeof operation !== "string" || !READ_OPERATIONS.has(operation)) return errorResult(`Operation "${String(operation)}" is not allowed in read-only mode.`);
		if (!await bridge.isPluginConnected()) return notConnected();
		const { nodeId, nodeName, scale, depth, format, detail, includeHidden, sessionId, ...searchParams } = input;
		const params = {};
		if (nodeId) params.id = nodeId;
		if (nodeName) params.name = nodeName;
		if (scale) params.scale = scale;
		if (depth !== void 0) params.depth = depth;
		if (format) params.format = format;
		if (detail) params.detail = detail;
		if (includeHidden !== void 0) params.includeHidden = includeHidden;
		if (operation === "search_nodes") Object.assign(params, searchParams);
		try {
			const data = await bridge.sendOperation(operation, params, sessionId);
			if (operation === "screenshot" && data?.dataUrl) {
				let image = data.dataUrl;
				if (image.includes(",")) image = image.split(",")[1] ?? image;
				const metadata = { ...data };
				delete metadata.dataUrl;
				const content = [{
					type: "image",
					data: image,
					mimeType: "image/png"
				}];
				if (Object.keys(metadata).length > 0) content.push({
					type: "text",
					text: JSON.stringify(metadata, null, 2)
				});
				return { content };
			}
			return { content: [{
				type: "text",
				text: JSON.stringify(data, null, 2)
			}] };
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}
	}
	if (name === "figma_rules") {
		if (!await bridge.isPluginConnected()) return notConnected();
		const sessionId = args?.sessionId;
		try {
			const [styles, variables, components] = await Promise.all([
				bridge.sendOperation("get_styles", {}, sessionId),
				bridge.sendOperation("get_variables", {}, sessionId),
				bridge.sendOperation("get_local_components", {}, sessionId)
			]);
			const lines = [
				"# Design System Rules",
				"",
				"Use these read-only tokens, styles, and components when writing code for this Figma file.",
				""
			];
			if (styles.paintStyles?.length) {
				lines.push("## Color Tokens (Paint Styles)", "```");
				for (const style of styles.paintStyles) if (style.hex) lines.push(`--${String(style.name).replaceAll("/", "-")}: ${style.hex};  /* ${style.name} */`);
				lines.push("```", "");
			}
			if (variables.collections?.length) for (const collection of variables.collections) {
				if (!collection.variables?.length) continue;
				lines.push(`## Variables — ${collection.name}`, "```");
				for (const variable of collection.variables) {
					const values = Object.values(variable.valuesByMode ?? {});
					lines.push(`${variable.name} (${variable.resolvedType})${values.length ? `: ${String(values[0])}` : ""}`);
				}
				lines.push("```", "");
			}
			if (styles.textStyles?.length) {
				lines.push("## Typography Styles", "```");
				for (const style of styles.textStyles) lines.push(`${style.name}: ${style.fontFamily} ${style.fontWeight} ${style.fontSize}px`);
				lines.push("```", "");
			}
			if (components.componentSets?.length) {
				lines.push("## Component Sets");
				for (const set of components.componentSets) lines.push(`- **${set.name}** (${set.variantCount} variants)${set.description ? ` — ${set.description}` : ""}`);
				lines.push("");
			}
			lines.push("---", "_Generated from the Figma canvas through the read-only plugin bridge._");
			return { content: [{
				type: "text",
				text: lines.join("\n")
			}] };
		} catch (error) {
			return errorResult(`figma_rules failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return errorResult(`Unknown tool: ${name}`);
});
await server.connect(new StdioServerTransport());
//#endregion
export {};
