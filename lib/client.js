window.__ModuleLoader__.load({
	id: "@eric.wen/dsh-sight",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
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
			visionStatus: "visionStatus",
			sessionImages: "sessionImages",
			clearImages: "clearImages"
		};
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-sight browser half: the settings page ("多模态图片直传") and the composer
		* controls (vision badge + clear-images button). Every Host call goes through
		* the plugin-owned `/sight` loopback RPC channel (`connection.rpc.call`).
		* Plain React.createElement (no JSX), inline styles only.
		* @module dsh-sight/client
		*/
		/** Required client services: slot UI + the Connection RPC carrier. */
		const inject = ["slots", "connection"];
		/** Module-level client context captured by `apply`, used by the React views. */
		let clientCtx;
		/** Call one `/sight` endpoint and unwrap the RPC result. */
		async function rpc(connection, endpoint, payload) {
			const result = await connection.rpc.call(SIGHT_RPC_CHANNEL, endpoint, payload);
			if (result.ok) return result.value;
			throw new Error(`${result.error.code}: ${result.error.message}`);
		}
		const BUTTON = {
			border: "1px solid rgba(128,128,128,0.35)",
			background: "transparent",
			color: "inherit",
			borderRadius: 6,
			padding: "5px 10px",
			fontSize: 12,
			cursor: "pointer"
		};
		const CHIP_ON = {
			borderRadius: 999,
			padding: "1px 8px",
			fontSize: 11,
			background: "rgba(34,197,94,0.16)",
			color: "#22c55e",
			whiteSpace: "nowrap"
		};
		const CHIP_OFF = {
			borderRadius: 999,
			padding: "1px 8px",
			fontSize: 11,
			background: "rgba(128,128,128,0.14)",
			color: "#9ca3af",
			whiteSpace: "nowrap"
		};
		const CHIP_WARN = {
			borderRadius: 999,
			padding: "1px 8px",
			fontSize: 11,
			background: "rgba(250,204,21,0.16)",
			color: "#eab308",
			whiteSpace: "nowrap"
		};
		const CHIP_INFO = {
			borderRadius: 999,
			padding: "1px 8px",
			fontSize: 11,
			background: "rgba(59,130,246,0.16)",
			color: "#3b82f6",
			whiteSpace: "nowrap"
		};
		const ROW = {
			display: "flex",
			alignItems: "center",
			gap: 10,
			padding: "7px 12px",
			borderTop: "1px solid rgba(128,128,128,0.15)",
			fontSize: 13
		};
		const GROUP = {
			border: "1px solid rgba(128,128,128,0.25)",
			borderRadius: 8,
			overflow: "hidden"
		};
		const GROUP_HEAD = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			padding: "8px 12px",
			fontSize: 12,
			fontWeight: 600,
			borderBottom: "1px solid rgba(128,128,128,0.25)"
		};
		function Chip(props) {
			const style = props.tone === "on" ? CHIP_ON : props.tone === "off" ? CHIP_OFF : props.tone === "warn" ? CHIP_WARN : CHIP_INFO;
			return react.default.createElement("span", { style }, props.children);
		}
		function ModelRow(props) {
			const { model, provider, busy, onToggle } = props;
			const statusChip = model.vision ? react.default.createElement(Chip, { tone: "on" }, "图片直传已启用") : react.default.createElement(Chip, { tone: "off" }, "仅文本");
			const dictChip = model.matched !== null ? react.default.createElement(Chip, { tone: "info" }, `字典匹配: ${model.matched}`) : react.default.createElement(Chip, { tone: "warn" }, "未匹配");
			const working = busy === `${provider}/${model.id}`;
			return react.default.createElement("div", { style: ROW }, react.default.createElement("div", { style: {
				flex: 1,
				minWidth: 0
			} }, react.default.createElement("div", {
				style: {
					fontWeight: 600,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				},
				title: model.id
			}, model.id), react.default.createElement("div", { style: {
				fontSize: 11,
				opacity: .6
			} }, model.name)), statusChip, dictChip, react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "" || working,
				onClick: () => onToggle(provider, model.id, !model.vision)
			}, working ? "处理中…" : model.vision ? "取消直传标记" : "启用图片直传"));
		}
		function SightPage() {
			const [data, setData] = react.default.useState(null);
			const [error, setError] = react.default.useState(null);
			const [busy, setBusy] = react.default.useState("");
			const load = react.default.useCallback(() => {
				rpc(clientCtx.get("connection"), SIGHT_RPC.status, {}).then((value) => {
					setData(value);
					setError(null);
				}).catch((e) => setError(e instanceof Error ? e.message : String(e)));
			}, []);
			react.default.useEffect(() => {
				load();
			}, [load]);
			const toggle = (provider, model, vision) => {
				if (busy !== "") return;
				setBusy(`${provider}/${model}`);
				rpc(clientCtx.get("connection"), SIGHT_RPC.setVision, {
					provider,
					model,
					vision
				}).then(() => load()).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(""));
			};
			const applyDictionary = () => {
				if (busy !== "") return;
				setBusy("apply");
				rpc(clientCtx.get("connection"), SIGHT_RPC.applyDictionary, {}).then(() => load()).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(""));
			};
			const children = [];
			children.push(react.default.createElement("h2", { style: {
				margin: 0,
				fontSize: 16,
				fontWeight: 600
			} }, "多模态图片直传 (Sight)"));
			children.push(react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 13,
				opacity: .75,
				lineHeight: 1.6
			} }, "在输入框粘贴或拖入的图片会以原生图片内容直接发送给多模态模型（不经文本转换）。下方可逐个模型声明「支持图片」，或一键应用字典匹配。声明写入 llm-pi-ai 配置，下次请求即生效。"));
			children.push(react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8
			} }, react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "",
				onClick: applyDictionary
			}, busy === "apply" ? "应用中…" : "一键应用字典匹配"), react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "",
				onClick: load
			}, "刷新")));
			if (error !== null) children.push(react.default.createElement("div", { style: {
				color: "#ef4444",
				fontSize: 12,
				whiteSpace: "pre-wrap"
			} }, error));
			if (data === null) children.push(react.default.createElement("div", { style: {
				fontSize: 12,
				opacity: .65
			} }, busy === "" ? "加载中…" : "处理中…"));
			else {
				const providers = data.providers;
				if (Array.isArray(providers) && providers.length > 0) for (const group of providers) {
					const rows = group.models.map((model) => react.default.createElement(ModelRow, {
						key: model.id,
						model,
						provider: group.provider,
						busy,
						onToggle: toggle
					}));
					const head = react.default.createElement("div", { style: GROUP_HEAD }, react.default.createElement("span", null, group.name), react.default.createElement("span", { style: {
						fontSize: 12,
						opacity: .65
					} }, group.provider));
					children.push(react.default.createElement("div", {
						style: GROUP,
						key: group.provider
					}, head, ...rows.length > 0 ? rows : [react.default.createElement("div", { style: {
						...ROW,
						fontSize: 12,
						opacity: .65
					} }, "该 provider 暂无可用模型")], group.error === null ? null : react.default.createElement("div", { style: {
						color: "#ef4444",
						fontSize: 12,
						whiteSpace: "pre-wrap",
						padding: "7px 12px"
					} }, group.error)));
				}
				else children.push(react.default.createElement("div", { style: {
					fontSize: 12,
					opacity: .65
				} }, "未发现 llm-pi-ai 配置的 provider。"));
				if (Array.isArray(data.dictionary) && data.dictionary.length > 0) {
					children.push(react.default.createElement("div", { style: {
						fontSize: 12,
						opacity: .65
					} }, "内置多模态模型字典（正则匹配模型 id）："));
					children.push(react.default.createElement("div", { style: {
						display: "flex",
						flexWrap: "wrap",
						gap: 6
					} }, ...data.dictionary.map((entry) => react.default.createElement(Chip, {
						key: `${entry.family}${entry.label}`,
						tone: "info"
					}, `${entry.family} (${entry.label})`))));
				}
			}
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 14,
				maxWidth: 720
			} }, ...children);
		}
		/** Composer badge: current model accepts direct image input. */
		function VisionBadge(props) {
			const [vision, setVision] = react.default.useState(false);
			const [loading, setLoading] = react.default.useState(true);
			react.default.useEffect(() => {
				let alive = true;
				let models;
				try {
					models = clientCtx.get("modelDirectories");
				} catch {
					models = void 0;
				}
				if (models === void 0) {
					setLoading(false);
					return;
				}
				let directory;
				try {
					directory = models.directoryFor(props.sessionId);
				} catch {
					setLoading(false);
					return;
				}
				const refresh = () => {
					const current = directory.store.getSnapshot().current;
					if (current === null || current === void 0) {
						setLoading(false);
						return;
					}
					rpc(clientCtx.get("connection"), SIGHT_RPC.visionStatus, {
						provider: current.provider,
						model: current.model
					}).then((value) => {
						if (alive) {
							setLoading(false);
							setVision(value.vision);
						}
					}).catch(() => {
						if (alive) {
							setLoading(false);
							setVision(false);
						}
					});
				};
				refresh();
				let stop = () => {};
				try {
					stop = directory.store.subscribe(refresh);
				} catch {}
				return () => {
					alive = false;
					stop();
				};
			}, [props.sessionId]);
			if (loading || !vision) return null;
			return react.default.createElement("span", {
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 4,
					height: 24,
					padding: "0 8px",
					borderRadius: 999,
					fontSize: 12,
					background: "rgba(34,197,94,0.16)",
					color: "#22c55e",
					border: "1px solid rgba(34,197,94,0.35)"
				},
				title: "当前模型支持多模态：粘贴/拖入的图片将直接发送给模型（不经文本转换）"
			}, react.default.createElement("span", { "aria-hidden": true }, "🖼"), react.default.createElement("span", null, "图片直传"));
		}
		/** Clear-images button: strips images from the MODEL-visible history (surface replace). */
		function ClearImagesButton(props) {
			const [count, setCount] = react.default.useState(null);
			const [phase, setPhase] = react.default.useState("idle");
			const [error, setError] = react.default.useState(null);
			const fingerprint = react.default.useMemo(() => {
				const snapshot = props.session;
				return (snapshot !== null && typeof snapshot === "object" && Array.isArray(snapshot.nodes) ? snapshot.nodes : []).map((node) => String(node.seq)).join(",");
			}, [props.session]);
			const refresh = react.default.useCallback(() => {
				rpc(clientCtx.get("connection"), SIGHT_RPC.sessionImages, { sessionId: props.sessionId }).then((value) => {
					setCount(value.count);
					if (value.count === 0) setPhase("idle");
				}).catch(() => setCount(0));
			}, [props.sessionId]);
			react.default.useEffect(() => {
				setError(null);
				refresh();
			}, [refresh, fingerprint]);
			if (count === null || count === 0) return null;
			const clear = () => {
				if (phase === "confirm") {
					setPhase("busy");
					setError(null);
					rpc(clientCtx.get("connection"), SIGHT_RPC.clearImages, { sessionId: props.sessionId }).then(() => {
						setPhase("done");
						setCount(0);
					}).catch((e) => {
						setPhase("idle");
						setError(e instanceof Error ? e.message : String(e));
					});
				} else setPhase("confirm");
			};
			const label = phase === "confirm" ? "确认清除" : phase === "busy" ? "清除中…" : phase === "done" ? "已清除 ✓" : `清除图片 (${count})`;
			const base = {
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				height: 24,
				padding: "0 8px",
				borderRadius: 999,
				fontSize: 12,
				cursor: phase === "busy" ? "default" : "pointer",
				background: phase === "done" ? "rgba(34,197,94,0.14)" : phase === "confirm" ? "rgba(239,68,68,0.22)" : "rgba(239,68,68,0.10)",
				color: phase === "done" ? "#4ade80" : "#f87171",
				border: "1px solid rgba(239,68,68,0.35)",
				whiteSpace: "nowrap",
				opacity: phase === "busy" ? .6 : 1
			};
			return react.default.createElement(react.default.Fragment, null, react.default.createElement("button", {
				type: "button",
				style: base,
				disabled: phase === "busy",
				title: "从模型上下文移除历史图片（界面转录保留），之后即可切换到纯文本模型。再点一次确认。",
				onClick: clear,
				onBlur: () => {
					if (phase === "confirm") setPhase("idle");
				}
			}, react.default.createElement("span", { "aria-hidden": true }, phase === "done" ? "✓" : "🗑"), react.default.createElement("span", null, label)), error === null ? null : react.default.createElement("span", {
				style: {
					color: "#f87171",
					fontSize: 12
				},
				title: error
			}, "!"));
		}
		/** Mount the Sight browser surfaces. */
		function apply(ctx) {
			clientCtx = ctx;
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "sight-vision",
				order: 12,
				label: () => "多模态图片直传"
			}, () => react.default.createElement(SightPage, null)));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "sight-vision-badge",
				order: 20
			}, (props) => react.default.createElement(VisionBadge, { sessionId: props.sessionId })));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "sight-clear-images",
				order: 30
			}, (props) => react.default.createElement(ClearImagesButton, {
				sessionId: props.sessionId,
				session: props.session
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map