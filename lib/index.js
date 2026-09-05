import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
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
	setVision: "setVision",
	applyDictionary: "applyDictionary",
	applyReasoning: "applyReasoning",
	visionStatus: "visionStatus",
	sessionImages: "sessionImages",
	clearImages: "clearImages",
	figmaMcpStatus: "figmaMcpStatus",
	figmaMcpApply: "figmaMcpApply",
	figmaMcpRemove: "figmaMcpRemove"
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
* Resolve the entry script of a Figma MCP server. Both packages ship as
* dependencies of dsh-sight and stay external in the build so the standalone
* entry files exist on disk for the mcp-client child processes to spawn.
* - `figma-read-server`: localhost bridge facade (read-only design-to-code,
*   dual engine: figma-ui-mcp bridge + figwright child, switched at runtime).
* - `figma-ui-mcp`: localhost plugin bridge (AI-driven design, read/write).
*/
const figmaServerBin = (pkg, rel) => {
	try {
		const resolved = createRequire(import.meta.url).resolve(`${pkg}/package.json`);
		return join(dirname(resolved), ...rel);
	} catch {
		return join(homedir(), "AppData", "Local", "Temp", "figma-ui-mcp-test", "node_modules", pkg, ...rel);
	}
};
/** Read-only localhost plugin MCP server entry (design-to-code). */
const FIGMA_READ_BIN = join(dirname(fileURLToPath(import.meta.url)), "figma-read-server.js");
/** Write-capable localhost plugin bridge server entry. */
const FIGMA_WRITE_BIN = figmaServerBin("figma-ui-mcp", ["server", "index.js"]);
/** Curated dictionary of popular multimodal models (regex against lowercase model ids). */
const VISION_DICTIONARY = [
	{
		re: /^qwen-vl/,
		family: "Qwen-VL"
	},
	{
		re: /^qwen2-vl/,
		family: "Qwen-VL"
	},
	{
		re: /^qwen2\.5-vl/,
		family: "Qwen-VL"
	},
	{
		re: /^qwen3-vl/,
		family: "Qwen-VL"
	},
	{
		re: /^qwen2\.5-omni/,
		family: "Qwen-Omni"
	},
	{
		re: /^qwen3-omni/,
		family: "Qwen-Omni"
	},
	{
		re: /^qwen-omni/,
		family: "Qwen-Omni"
	},
	{
		re: /^qwen-turbo/,
		family: "Qwen-Turbo"
	},
	{
		re: /^gpt-4o/,
		family: "OpenAI GPT-4o"
	},
	{
		re: /^gpt-4\.1/,
		family: "OpenAI GPT-4.1"
	},
	{
		re: /^gpt-4-turbo/,
		family: "OpenAI GPT-4 Turbo"
	},
	{
		re: /^chatgpt-4o/,
		family: "OpenAI ChatGPT-4o"
	},
	{
		re: /^gpt-5/,
		family: "OpenAI GPT-5"
	},
	{
		re: /^o4-mini/,
		family: "OpenAI o-series"
	},
	{
		re: /^o3/,
		family: "OpenAI o-series"
	},
	{
		re: /^gemini-/,
		family: "Google Gemini"
	},
	{
		re: /^claude-3-5-/,
		family: "Anthropic Claude 3.5"
	},
	{
		re: /^claude-3-7-/,
		family: "Anthropic Claude 3.7"
	},
	{
		re: /^claude-4-/,
		family: "Anthropic Claude 4"
	},
	{
		re: /^claude-opus-4/,
		family: "Anthropic Claude Opus 4"
	},
	{
		re: /^claude-sonnet-4/,
		family: "Anthropic Claude Sonnet 4"
	},
	{
		re: /^claude-haiku-4/,
		family: "Anthropic Claude Haiku 4"
	},
	{
		re: /^claude-opus-/,
		family: "Anthropic Claude Opus"
	},
	{
		re: /^claude-sonnet-/,
		family: "Anthropic Claude Sonnet"
	},
	{
		re: /^claude-haiku-/,
		family: "Anthropic Claude Haiku"
	},
	{
		re: /^claude-3-/,
		family: "Anthropic Claude 3"
	},
	{
		re: /^moonshot-v1-.*-vision-preview/,
		family: "Kimi (Moonshot)"
	},
	{
		re: /^kimi-vl/,
		family: "Kimi (Moonshot)"
	},
	{
		re: /^glm-4v/,
		family: "Zhipu GLM-4V"
	},
	{
		re: /^glm-4\.1v/,
		family: "Zhipu GLM-4.1V"
	},
	{
		re: /^glm-5/,
		family: "Zhipu GLM-5"
	},
	{
		re: /^doubao-.*vision/,
		family: "Doubao Vision"
	},
	{
		re: /^deepseek-vl/,
		family: "DeepSeek-VL"
	},
	{
		re: /^llava/,
		family: "LLaVA"
	},
	{
		re: /^internvl/,
		family: "InternVL"
	},
	{
		re: /^phi-3-vision/,
		family: "Phi-3 Vision"
	},
	{
		re: /^phi-4-multimodal/,
		family: "Phi-4 Multimodal"
	},
	{
		re: /^pixtral/,
		family: "Mistral Pixtral"
	},
	{
		re: /^cogvlm/,
		family: "CogVLM"
	},
	{
		re: /^minicpm-v/,
		family: "MiniCPM-V"
	},
	{
		re: /^step-1v/,
		family: "Step-1V"
	},
	{
		re: /^hunyuan-vision/,
		family: "Hunyuan Vision"
	},
	{
		re: /^nova-/,
		family: "Amazon Nova"
	},
	{
		re: /^grok-2-vision/,
		family: "xAI Grok"
	},
	{
		re: /^grok-4/,
		family: "xAI Grok"
	},
	{
		re: /^qwen3\.7-plus/,
		family: "Qwen 3.7 Plus"
	},
	{
		re: /^kimi-k3/,
		family: "Kimi K3"
	}
];
/** First dictionary family matching a model id, or undefined. */
function familyOf(modelId) {
	const id = modelId.toLowerCase();
	for (const entry of VISION_DICTIONARY) if (entry.re.test(id)) return entry.family;
}
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
/**
* Host half: serve the `/sight` loopback channel. The channel is registered on
* the Connection service with `authority: 'loopback'`, so only the plugin's
* own browser half (and any local page) may call it.
*/
function apply(ctx) {
	ctx.inject([
		"connection",
		"settings",
		"llm",
		"agents"
	], (sightCtx) => {
		const connection = sightCtx.get("connection");
		const settings = sightCtx.get("settings");
		const llm = sightCtx.get("llm");
		const agents = sightCtx.get("agents");
		/** Raw (stored) user section of the llm-pi-ai namespace, or undefined. */
		const rawSection = () => {
			try {
				const user = settings.describe().find((d) => d.ns === NS)?.user;
				return user !== null && typeof user === "object" ? user : void 0;
			} catch {
				return;
			}
		};
		/** Whether the raw profile already declares image input for one model. */
		const rawDeclaresImage = (profile, model) => {
			if (profile === void 0) return false;
			if (Array.isArray(profile.models)) {
				const entry = profile.models.find((m) => m !== null && typeof m === "object" && m.id === model);
				return Array.isArray(entry?.input) && entry.input.includes("image");
			}
			const override = profile.modelOverrides?.[model];
			return Array.isArray(override?.input) && override.input.includes("image");
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
		/** Write the vision declaration for one model into the llm-pi-ai user section. */
		const writeModelVision = async (provider, model, vision) => {
			const profile = rawSection()?.providers?.[provider];
			if (profile === void 0 || typeof profile !== "object") throw new Error(`provider "${provider}" is not configured under ${NS}`);
			const rawModels = Array.isArray(profile.models) ? profile.models : void 0;
			const ops = [];
			if (rawModels !== void 0) {
				if (rawModels.find((m) => m !== null && typeof m === "object" && m.id === model) === void 0) throw new Error(`model "${model}" is not listed in provider "${provider}" models`);
				const next = rawModels.map((m) => {
					if (m === null || typeof m !== "object" || m.id !== model) return m;
					if (vision) return {
						...m,
						input: ["text", "image"]
					};
					const { input: _dropped, ...rest } = m;
					return rest;
				});
				ops.push({
					op: "set",
					path: [
						"providers",
						provider,
						"models"
					],
					value: next
				});
			} else if (vision) ops.push({
				op: "set",
				path: [
					"providers",
					provider,
					"modelOverrides",
					model,
					"input"
				],
				value: ["text", "image"]
			});
			else ops.push({
				op: "unset",
				path: [
					"providers",
					provider,
					"modelOverrides",
					model,
					"input"
				]
			});
			await settings.mutate(NS, ops);
		};
		/** Full overview for the settings page. */
		const status = async () => {
			const rawProviders = rawSection()?.providers;
			const dictionary = VISION_DICTIONARY.map((entry) => ({
				family: entry.family,
				label: entry.re.source
			}));
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
						let vision = false;
						let adapterReasoning;
						try {
							const info = await llm.resolveModelInfo(provider, m.id);
							vision = Array.isArray(info.inputModalities) && info.inputModalities.includes("image");
							adapterReasoning = info.reasoning?.efforts;
						} catch {
							vision = false;
						}
						const matched = familyOf(m.id);
						const declared = rawDeclaresImage(rawProviders?.[provider], m.id);
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
							vision,
							declared,
							matched: matched === void 0 ? null : matched,
							source: declared ? "declared" : vision ? "adapter" : matched === void 0 ? "none" : "dictionary",
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
							vision: false,
							declared: false,
							matched: null,
							source: "none",
							reasoning: null
						};
						let vision = false;
						let adapterReasoning;
						try {
							const info = await llm.resolveModelInfo(DEEPSEEK_PROVIDER, id);
							vision = Array.isArray(info.inputModalities) && info.inputModalities.includes("image");
							adapterReasoning = info.reasoning?.efforts;
						} catch {
							vision = false;
						}
						const matched = familyOf(id);
						const declared = Array.isArray(dm.input) && dm.input.includes("image");
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
							vision,
							declared,
							matched: matched === void 0 ? null : matched,
							source: declared ? "declared" : vision ? "adapter" : matched === void 0 ? "none" : "dictionary",
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
				dictionary,
				reasoningDictionary,
				providers
			};
		};
		/** Bulk-declare image input for every configured model matching the dictionary. */
		const applyDictionary = async () => {
			const rawProviders = rawSection()?.providers;
			if (rawProviders === void 0 || typeof rawProviders !== "object") return {
				applied: 0,
				providers: 0
			};
			let applied = 0;
			let touchedProviders = 0;
			for (const [provider, profile] of Object.entries(rawProviders)) {
				if (profile === void 0 || typeof profile !== "object") continue;
				const rawModels = Array.isArray(profile.models) ? profile.models : void 0;
				if (rawModels !== void 0) {
					let changed = false;
					const next = rawModels.map((m) => {
						if (m === null || typeof m !== "object" || typeof m.id !== "string") return m;
						if (familyOf(m.id) === void 0) return m;
						if (Array.isArray(m.input) && m.input.includes("image")) return m;
						changed = true;
						return {
							...m,
							input: ["text", "image"]
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
						applied += next.filter((m) => m !== null && typeof m === "object" && Array.isArray(m.input) && m.input.includes("image")).length;
						touchedProviders += 1;
					}
					continue;
				}
				const ops = [];
				try {
					const models = await llm.listModels(provider);
					for (const m of models) {
						if (familyOf(m.id) === void 0) continue;
						const override = profile.modelOverrides?.[m.id];
						if (Array.isArray(override?.input) && override.input.includes("image")) continue;
						ops.push({
							op: "set",
							path: [
								"providers",
								provider,
								"modelOverrides",
								m.id,
								"input"
							],
							value: ["text", "image"]
						});
						applied += 1;
					}
					if (ops.length > 0) {
						await settings.mutate(NS, ops);
						touchedProviders += 1;
					}
				} catch {}
			}
			return {
				applied,
				providers: touchedProviders
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
		/** Cheap per-model vision status for the composer badge. */
		const visionStatus = async (provider, model) => {
			try {
				const info = await llm.resolveModelInfo(provider, model);
				const vision = Array.isArray(info.inputModalities) && info.inputModalities.includes("image");
				const matched = familyOf(model);
				return {
					vision,
					source: rawDeclaresImage(rawSection()?.providers?.[provider], model) ? "declared" : vision ? "adapter" : matched === void 0 ? "none" : "dictionary",
					matched: matched === void 0 ? null : matched
				};
			} catch {
				return {
					vision: false,
					source: "unknown",
					matched: null
				};
			}
		};
		/** Surface-node seqs of user messages whose model-visible content has an image. */
		const imageNodeSeqs = (session) => {
			const seqs = [];
			const nodes = session.surface.nodes;
			const events = session.events;
			for (const seq of nodes) {
				const event = events[seq];
				if (event === void 0 || event.type !== "user/message") continue;
				const data = event.data;
				if (data !== null && typeof data === "object" && Array.isArray(data.content) && data.content.some((block) => block !== null && typeof block === "object" && block.type === "image")) seqs.push(seq);
			}
			return seqs;
		};
		/** Count of image-bearing user messages on the current model-visible surface. */
		const sessionImages = (sessionId) => {
			const agent = agents.get(sessionId);
			if (agent === void 0) return { count: 0 };
			return { count: imageNodeSeqs(agent.session).length };
		};
		/** Strip image blocks; ensure a text block remains. */
		const stripImageBlocks = (content) => {
			const kept = content.filter((block) => block.type !== "image");
			if (kept.length === 0) kept.push({
				type: "text",
				text: "[图片已移除]"
			});
			return kept;
		};
		/**
		* Replace every image-bearing user message on the surface with a stripped
		* copy (one `user/message` event per node, `op: 'replace'`). The original
		* events stay in the log; only the model-visible history changes, so the
		* `session.selectModel` gate passes for text-only models again.
		*/
		const clearImages = async (sessionId) => {
			const agent = agents.get(sessionId);
			if (agent === void 0) throw new Error(`session "${sessionId}" is not loaded in this process`);
			const session = agent.session;
			const appender = session;
			const seqs = imageNodeSeqs(session);
			const failures = [];
			let cleared = 0;
			for (const seq of seqs) {
				const original = session.events[seq];
				if (original === void 0 || original.type !== "user/message") continue;
				const content = stripImageBlocks(original.data.content);
				const message = {
					id: `sight-clear-${seq}`,
					role: "user",
					content,
					source: { kind: "user" }
				};
				try {
					appender.append("user/message", message, {
						surfaceOp: {
							op: "replace",
							start: seq,
							end: seq
						},
						sourceEventSeqs: [seq]
					});
					cleared += 1;
				} catch (error) {
					failures.push({
						seq,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
			return {
				cleared,
				total: seqs.length,
				failures
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
		/** Resolve the Figma plugin manifest path for the write bridge (unconditional — the package ships as a dep). */
		const figmaManifestPath = () => {
			try {
				const resolved = createRequire(import.meta.url).resolve("figma-ui-mcp/package.json");
				const candidate = join(dirname(resolved), "plugin", "manifest.json");
				return existsSync(candidate) ? candidate : null;
			} catch {
				return null;
			}
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
		/** Serialize the patch array back to the file (UTF-8, no BOM). */
		const writePatch = (patch) => {
			const file = patchPath();
			const dir = dirname(file);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(file, stringify(patch), "utf8");
		};
		/** Status: both capabilities' presence in the patch. */
		const figmaMcpStatus = () => {
			const file = patchPath();
			try {
				const patch = readPatch();
				const manifest = figmaManifestPath();
				const read = rowStatus(findFigmaRow(patch, "read"));
				const write = rowStatus(findFigmaRow(patch, "write"));
				const readEngine = readSightReadState();
				return {
					read: {
						...read,
						backend: readEngine.backend,
						repoDir: readEngine.repoDir,
						manifestPath: readEngine.backend === "figma-ui-mcp" ? manifest : null
					},
					write: {
						...write,
						backend: "figma-ui-mcp",
						repoDir: null,
						manifestPath: manifest
					},
					patchPath: file,
					profile: activeProfile(),
					error: null
				};
			} catch (error) {
				return {
					read: {
						configured: false,
						hasToken: false,
						manifestPath: null,
						backend: "figma-ui-mcp",
						repoDir: null
					},
					write: {
						configured: false,
						hasToken: false,
						manifestPath: null,
						backend: "figma-ui-mcp",
						repoDir: null
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
					args: [FIGMA_WRITE_BIN]
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
					case SIGHT_RPC.setVision: {
						const p = payload;
						if (typeof p.provider !== "string" || typeof p.model !== "string" || typeof p.vision !== "boolean") return fail("setVision requires { provider, model, vision }");
						await writeModelVision(p.provider, p.model, p.vision);
						return ok({ ok: true });
					}
					case SIGHT_RPC.applyDictionary: return ok(await applyDictionary());
					case SIGHT_RPC.applyReasoning: return ok(await applyReasoning());
					case SIGHT_RPC.visionStatus: {
						const p = payload;
						if (typeof p.provider !== "string" || typeof p.model !== "string") return fail("visionStatus requires { provider, model }");
						return ok(await visionStatus(p.provider, p.model));
					}
					case SIGHT_RPC.sessionImages: {
						const p = payload;
						if (typeof p.sessionId !== "string") return fail("sessionImages requires { sessionId }");
						return ok(sessionImages(p.sessionId));
					}
					case SIGHT_RPC.clearImages: {
						const p = payload;
						if (typeof p.sessionId !== "string") return fail("clearImages requires { sessionId }");
						return ok(await clearImages(p.sessionId));
					}
					case SIGHT_RPC.figmaMcpStatus: return ok(figmaMcpStatus());
					case SIGHT_RPC.figmaMcpApply: return ok(await figmaMcpApply(payload));
					case SIGHT_RPC.figmaMcpRemove: {
						const p = payload;
						if (p.mode !== "read" && p.mode !== "write") return fail("figmaMcpRemove requires { mode }");
						return ok(figmaMcpRemove(p.mode));
					}
					default: return fail(`unknown dsh-sight endpoint "${String(endpoint)}"`);
				}
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		};
		sightCtx.effect(() => connection.rpc.handle(SIGHT_RPC_CHANNEL, handler, { authority: "loopback" }), "dsh-sight: loopback RPC");
	});
}
//#endregion
export { apply, name };
