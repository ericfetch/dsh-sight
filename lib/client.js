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
			applyReasoning: "applyReasoning",
			visionStatus: "visionStatus",
			sessionImages: "sessionImages",
			clearImages: "clearImages",
			figmaMcpStatus: "figmaMcpStatus",
			figmaMcpApply: "figmaMcpApply",
			figmaMcpRemove: "figmaMcpRemove",
			repoDirList: "repoDirList"
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
		/** Format user-facing error message, giving actionable hints for version mismatches / restart requirements. */
		function formatErrorMessage(e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes("unknown dsh-sight endpoint")) return "检测到插件已更新，但后端服务尚未重新加载。请完全退出并重启 DSH Desktop 客户端以生效。";
			return msg;
		}
		function Chip(props) {
			const style = props.tone === "on" ? CHIP_ON : props.tone === "off" ? CHIP_OFF : props.tone === "warn" ? CHIP_WARN : CHIP_INFO;
			return react.default.createElement("span", { style }, props.children);
		}
		/** Inline host-backed directory browser for picking the figwright repo root. */
		function RepoDirPicker(props) {
			const [path, setPath] = react.default.useState(null);
			const [parent, setParent] = react.default.useState(null);
			const [dirs, setDirs] = react.default.useState([]);
			const [busy, setBusy] = react.default.useState(false);
			const [pickError, setPickError] = react.default.useState(null);
			const [jump, setJump] = react.default.useState("");
			const browse = react.default.useCallback((target) => {
				setBusy(true);
				setPickError(null);
				rpc(clientCtx.get("connection"), SIGHT_RPC.repoDirList, target === void 0 || target.trim().length === 0 ? {} : { path: target.trim() }).then((listing) => {
					setPath(listing.path);
					setParent(listing.parent);
					setDirs([...listing.dirs]);
					setPickError(listing.error);
				}).catch((e) => setPickError(formatErrorMessage(e))).finally(() => setBusy(false));
			}, []);
			react.default.useEffect(() => {
				browse(props.value);
			}, []);
			const basename = (dir) => dir.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? dir;
			const dirRows = dirs.length === 0 ? [react.default.createElement("div", {
				key: "empty",
				style: {
					fontSize: 12,
					opacity: .6,
					padding: "6px 0"
				}
			}, "（没有子目录）")] : dirs.map((dir) => react.default.createElement("div", {
				key: dir,
				title: dir,
				onClick: () => {
					if (!busy) browse(dir);
				},
				style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "5px 8px",
					borderRadius: 4,
					cursor: "pointer",
					fontSize: 12,
					background: dir === props.value ? "rgba(59,130,246,0.14)" : "transparent"
				}
			}, react.default.createElement("span", { style: { opacity: .7 } }, "📁"), react.default.createElement("span", { style: {
				flex: 1,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			} }, basename(dir)), dir === props.value ? react.default.createElement("span", { style: {
				color: "#60a5fa",
				fontSize: 11
			} }, "当前") : null));
			const inputStyle = {
				flex: 1,
				minWidth: 0,
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(0,0,0,0.18)",
				color: "inherit",
				borderRadius: 4,
				padding: "5px 8px",
				fontSize: 12,
				fontFamily: "monospace"
			};
			return react.default.createElement("div", { style: {
				border: "1px solid rgba(59,130,246,0.35)",
				borderRadius: 6,
				padding: "8px 10px",
				display: "flex",
				flexDirection: "column",
				gap: 6,
				background: "rgba(59,130,246,0.05)"
			} }, react.default.createElement("div", { style: {
				fontSize: 12,
				fontWeight: 600,
				display: "flex",
				alignItems: "center",
				gap: 6
			} }, react.default.createElement("span", { style: { flex: 1 } }, "选择项目根目录"), parent !== null ? react.default.createElement("button", {
				type: "button",
				style: {
					...BUTTON,
					padding: "1px 8px",
					fontSize: 11
				},
				disabled: busy,
				onClick: () => browse(parent)
			}, "⬆ 上一级") : null), react.default.createElement("div", { style: {
				fontSize: 11,
				opacity: .75,
				fontFamily: "monospace",
				wordBreak: "break-all",
				lineHeight: 1.5
			} }, path ?? "加载中…"), react.default.createElement("div", { style: {
				display: "flex",
				gap: 6
			} }, react.default.createElement("input", {
				type: "text",
				value: jump,
				spellCheck: false,
				placeholder: "或直接输入绝对路径后回车",
				style: inputStyle,
				onChange: (e) => setJump(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter" && !busy) browse(jump.trim());
				}
			}), react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy || jump.trim().length === 0,
				onClick: () => browse(jump.trim())
			}, "前往")), react.default.createElement("div", { style: {
				maxHeight: 200,
				overflowY: "auto",
				border: "1px solid rgba(128,128,128,0.15)",
				borderRadius: 4,
				padding: "4px",
				display: "flex",
				flexDirection: "column",
				gap: 1
			} }, ...dirRows), pickError !== null ? react.default.createElement("div", { style: {
				fontSize: 11,
				color: "#f87171"
			} }, pickError) : null, react.default.createElement("div", { style: {
				display: "flex",
				gap: 6,
				justifyContent: "flex-end"
			} }, react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy || path === null,
				onClick: () => {
					if (path !== null) props.onPick(path);
				}
			}, busy ? "读取中…" : `选择此目录${path !== null ? `（${basename(path)}）` : ""}`), react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy,
				onClick: props.onClose
			}, "取消")));
		}
		function ModelRow(props) {
			const { model, provider, busy, onToggle } = props;
			const statusChip = model.vision ? react.default.createElement(Chip, { tone: "on" }, "图片直传已启用") : react.default.createElement(Chip, { tone: "off" }, "仅文本");
			const dictChip = model.matched !== null ? react.default.createElement(Chip, { tone: "info" }, `字典匹配: ${model.matched}`) : react.default.createElement(Chip, { tone: "warn" }, "未匹配");
			const reasoningChip = model.reasoning === null ? react.default.createElement(Chip, { tone: "warn" }, "无推理等级") : model.reasoning.source === "declared" ? react.default.createElement(Chip, { tone: "info" }, `推理(声明): ${model.reasoning.levels.join("/")}`) : react.default.createElement(Chip, { tone: "on" }, `推理: ${model.reasoning.levels.join("/")}`);
			const working = busy === `${provider}/${model.id}`;
			const visionLocked = provider === "deepseek-official";
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
			} }, model.name)), statusChip, dictChip, reasoningChip, react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "" || working || visionLocked,
				onClick: () => onToggle(provider, model.id, !model.vision),
				title: visionLocked ? "DeepSeek 官方渠道当前不支持图片直传" : void 0
			}, visionLocked ? "不支持图片直传" : working ? "处理中…" : model.vision ? "取消直传标记" : "启用图片直传"));
		}
		function SightPage() {
			const [data, setData] = react.default.useState(null);
			const [error, setError] = react.default.useState(null);
			const [busy, setBusy] = react.default.useState("");
			const [reasoningResult, setReasoningResult] = react.default.useState(null);
			const load = react.default.useCallback(() => {
				rpc(clientCtx.get("connection"), SIGHT_RPC.status, {}).then((value) => {
					setData(value);
					setError(null);
				}).catch((e) => setError(formatErrorMessage(e)));
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
				}).then(() => load()).catch((e) => setError(formatErrorMessage(e))).finally(() => setBusy(""));
			};
			const applyDictionary = () => {
				if (busy !== "") return;
				setBusy("apply");
				rpc(clientCtx.get("connection"), SIGHT_RPC.applyDictionary, {}).then(() => load()).catch((e) => setError(formatErrorMessage(e))).finally(() => setBusy(""));
			};
			const applyReasoning = () => {
				if (busy !== "") return;
				setBusy("reasoning");
				rpc(clientCtx.get("connection"), SIGHT_RPC.applyReasoning, {}).then((value) => {
					setReasoningResult(value);
					load();
				}).catch((e) => setError(formatErrorMessage(e))).finally(() => setBusy(""));
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
			} }, "在输入框粘贴或拖入的图片会以原生图片内容直接发送给多模态模型（不经文本转换）。下方可逐个模型声明「支持图片」，或一键应用字典匹配。新增第三方渠道后，「自动补推理等级」会按模型家族写入其支持的推理档位（reasoningEfforts）。声明写入 llm-pi-ai 配置，下次请求即生效。"));
			children.push(react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				flexWrap: "wrap"
			} }, react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "",
				onClick: applyDictionary
			}, busy === "apply" ? "应用中…" : "一键应用字典匹配"), react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "",
				onClick: applyReasoning
			}, busy === "reasoning" ? "补档中…" : "自动补推理等级"), react.default.createElement("button", {
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
			if (reasoningResult !== null) {
				const lines = [];
				lines.push(react.default.createElement("div", { style: {
					fontSize: 12,
					fontWeight: 600
				} }, `自动补推理等级完成：${reasoningResult.applied} 个模型，${reasoningResult.providers} 个渠道。`));
				if (Array.isArray(reasoningResult.changes) && reasoningResult.changes.length > 0) lines.push(react.default.createElement("div", { style: {
					fontSize: 12,
					opacity: .75,
					marginTop: 4
				} }, ...reasoningResult.changes.flatMap((change, index) => [react.default.createElement("div", { key: `c${index}` }, `· ${change.provider}/${change.model} → ${change.family} [${change.efforts.map((e) => e.wire || e.level).join(", ")}]`)])));
				children.push(react.default.createElement("div", { style: {
					border: "1px solid rgba(34,197,94,0.35)",
					borderRadius: 6,
					padding: "8px 12px",
					fontSize: 12,
					color: "#4ade80",
					background: "rgba(34,197,94,0.08)"
				} }, ...lines));
			}
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
				if (Array.isArray(data.reasoningDictionary) && data.reasoningDictionary.length > 0) {
					children.push(react.default.createElement("div", { style: {
						fontSize: 12,
						opacity: .65,
						marginTop: 8
					} }, "推理等级字典（正则匹配模型 id → 支持的档位）："));
					children.push(react.default.createElement("div", { style: {
						display: "flex",
						flexWrap: "wrap",
						gap: 6
					} }, ...data.reasoningDictionary.map((entry) => react.default.createElement(Chip, {
						key: `${entry.family}${entry.label}`,
						tone: "info"
					}, `${entry.family} [${entry.efforts.map((e) => e.wire || e.level).join(", ")}]`))));
				}
			}
			return react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 14,
				maxWidth: 720
			} }, ...children);
		}
		/** Independent settings page for the Figma MCP bridge (own sidebar entry). */
		function FigmaMcpPage() {
			const [status, setStatus] = react.default.useState(null);
			const [busy, setBusy] = react.default.useState("");
			const [readMessage, setReadMessage] = react.default.useState(null);
			const [writeMessage, setWriteMessage] = react.default.useState(null);
			const [copied, setCopied] = react.default.useState(false);
			const [error, setError] = react.default.useState(null);
			const [backend, setBackend] = react.default.useState("figma-ui-mcp");
			const [repoDir, setRepoDir] = react.default.useState("");
			const [pickerOpen, setPickerOpen] = react.default.useState(false);
			const load = react.default.useCallback(() => {
				rpc(clientCtx.get("connection"), SIGHT_RPC.figmaMcpStatus, {}).then((value) => {
					setStatus(value);
					setError(null);
				}).catch((e) => setError(formatErrorMessage(e)));
			}, []);
			react.default.useEffect(() => {
				load();
			}, [load]);
			react.default.useEffect(() => {
				const read = status?.read;
				if (read === void 0) return;
				setBackend(read.backend);
				setRepoDir(read.repoDir ?? "");
			}, [status]);
			const engineLabel = backend === "figwright" ? "figwright" : "figma-ui-mcp";
			const applyRead = () => {
				if (busy !== "") return;
				setBusy("read");
				setReadMessage(null);
				setError(null);
				const wasConfigured = status?.read?.configured === true;
				const req = {
					mode: "read",
					backend,
					repoDir: repoDir.trim()
				};
				rpc(clientCtx.get("connection"), SIGHT_RPC.figmaMcpApply, req).then((value) => {
					if (!value.ok) setReadMessage(`写入失败: ${value.error ?? "unknown"}`);
					else setReadMessage(`${wasConfigured ? "引擎设置已保存" : "已启用"}(${engineLabel}引擎)。工具列表会即时刷新,当前对话即可使用新工具;若未刷新,重启 DSH Desktop 即生效。${backend === "figwright" ? "请确认 Figma Desktop 中已运行「Figwright」插件(Connected)。" : "请确认 Figma Desktop 中已运行「Figma UI MCP Bridge」插件(绿点)。"}`);
					load();
				}).catch((e) => setError(formatErrorMessage(e))).finally(() => setBusy(""));
			};
			const removeRead = () => {
				if (busy !== "") return;
				setBusy("read");
				setReadMessage(null);
				setError(null);
				rpc(clientCtx.get("connection"), SIGHT_RPC.figmaMcpRemove, { mode: "read" }).then((value) => {
					setReadMessage(value.ok ? "已停用。" : `移除失败: ${value.error ?? "unknown"}`);
					load();
				}).catch((e) => setError(formatErrorMessage(e))).finally(() => setBusy(""));
			};
			const applyWrite = () => {
				if (busy !== "") return;
				setBusy("write");
				setWriteMessage(null);
				setError(null);
				rpc(clientCtx.get("connection"), SIGHT_RPC.figmaMcpApply, { mode: "write" }).then((value) => {
					setWriteMessage(value.ok ? "已启用，请重启 DSH Desktop 生效。" : `写入失败: ${value.error ?? "unknown"}`);
					load();
				}).catch((e) => setError(formatErrorMessage(e))).finally(() => setBusy(""));
			};
			const removeWrite = () => {
				if (busy !== "") return;
				setBusy("write");
				setWriteMessage(null);
				setError(null);
				rpc(clientCtx.get("connection"), SIGHT_RPC.figmaMcpRemove, { mode: "write" }).then((value) => {
					setWriteMessage(value.ok ? "已停用。" : `移除失败: ${value.error ?? "unknown"}`);
					load();
				}).catch((e) => setError(formatErrorMessage(e))).finally(() => setBusy(""));
			};
			const children = [];
			children.push(react.default.createElement("h2", { style: {
				margin: 0,
				fontSize: 16,
				fontWeight: 600
			} }, "Figma MCP"));
			children.push(react.default.createElement("p", { style: {
				margin: 0,
				fontSize: 13,
				opacity: .75,
				lineHeight: 1.6
			} }, "分两步接入 Figma：先用只读插件读取设计稿生成代码；需要 AI 直接修改画布时，再单独启用写入能力。"));
			if (error !== null) children.push(react.default.createElement("div", { style: {
				color: "#f87171",
				background: "rgba(239, 68, 68, 0.1)",
				border: "1px solid rgba(239, 68, 68, 0.3)",
				borderRadius: 6,
				padding: "8px 12px",
				fontSize: 13,
				lineHeight: 1.5
			} }, error));
			const readCfg = status?.read;
			const writeCfg = status?.write;
			const manifestPath = writeCfg?.manifestPath ?? readCfg?.manifestPath ?? null;
			const copyManifestPath = () => {
				if (!manifestPath) return;
				navigator.clipboard?.writeText(manifestPath).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 2e3);
				}).catch(() => {});
			};
			children.push(react.default.createElement("div", { style: {
				...GROUP,
				background: "rgba(128,128,128,0.04)"
			} }, react.default.createElement("div", { style: GROUP_HEAD }, react.default.createElement("span", null, "Figma 桌面端插件安装"), react.default.createElement("span", { style: {
				fontSize: 11,
				opacity: .6
			} }, "两个后端插件 · 可同时安装")), react.default.createElement("div", { style: {
				padding: "12px",
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("div", { style: {
				fontSize: 12,
				opacity: .8,
				lineHeight: 1.6
			} }, "「设计稿 → 代码」的两种底层引擎与「AI 主动设计」各自使用独立的本地桥接插件，互不冲突、可同时安装；在 Figma 中运行哪个，取决于当前要用的能力（①的引擎选择、②）。"), react.default.createElement("div", { style: {
				fontSize: 12,
				opacity: .9,
				lineHeight: 1.7,
				background: "rgba(128,128,128,0.08)",
				borderRadius: 6,
				padding: "10px 12px",
				border: "1px solid rgba(128,128,128,0.18)"
			} }, react.default.createElement("div", { style: { fontWeight: 600 } }, "插件 A — Figma UI MCP Bridge（用于 ① 原引擎 / ② AI 主动设计）"), react.default.createElement("div", { style: { marginTop: 4 } }, "① 打开 ", react.default.createElement("b", null, "Figma 桌面客户端"), "（网页版无法连接本地 localhost）"), react.default.createElement("div", null, "② 顶部菜单：Plugins → Development → Import plugin from manifest..."), react.default.createElement("div", null, "③ 导入下方插件清单文件："), react.default.createElement("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 4,
				background: "rgba(0,0,0,0.15)",
				borderRadius: 4,
				padding: "6px 8px"
			} }, react.default.createElement("div", { style: {
				fontFamily: "monospace",
				fontSize: 11,
				wordBreak: "break-all",
				flex: 1,
				opacity: .85
			} }, manifestPath ?? "（正在检测插件路径…）"), manifestPath !== null ? react.default.createElement("button", {
				type: "button",
				style: {
					...BUTTON,
					padding: "2px 8px",
					fontSize: 11,
					whiteSpace: "nowrap",
					minHeight: 24
				},
				onClick: copyManifestPath
			}, copied ? "已复制 ✓" : "复制路径") : null), react.default.createElement("div", { style: { marginTop: 6 } }, "④ 在 Figma 中运行「", react.default.createElement("b", null, "Figma UI MCP Bridge"), "」插件，看到绿点即已成功连接。"), react.default.createElement("div", { style: {
				fontWeight: 600,
				marginTop: 12
			} }, "插件 B — Figwright（用于 ① 接地引擎，仓库级组件/Token 匹配）"), react.default.createElement("div", { style: { marginTop: 4 } }, "① 下载插件 zip："), react.default.createElement("div", { style: { marginTop: 4 } }, react.default.createElement("a", {
				href: "https://github.com/awdr74100/figwright/releases/latest",
				target: "_blank",
				rel: "noreferrer",
				style: {
					...BUTTON,
					display: "inline-block",
					textDecoration: "none"
				}
			}, "打开 Figwright Releases 下载页")), react.default.createElement("div", { style: { marginTop: 4 } }, "② 解压 zip → Plugins → Development → Import plugin from manifest... 选择解压目录里的 manifest.json"), react.default.createElement("div", { style: { marginTop: 4 } }, "③ 在 Figma 中运行「", react.default.createElement("b", null, "Figwright"), "」插件，面板显示 Connected 即已成功连接。")), react.default.createElement("div", { style: {
				fontSize: 11,
				opacity: .6,
				lineHeight: 1.5
			} }, "提示：两个插件都只连接本机 127.0.0.1 的桥接服务，不上传任何数据；修改启停或引擎后，按下方提示重启/刷新 DSH。"))));
			const engines = [{
				id: "figma-ui-mcp",
				label: "figma-ui-mcp",
				note: "原引擎 · 保留 get_css / export_svg / figma_rules"
			}, {
				id: "figwright",
				label: "figwright",
				note: "接地引擎 · 扫描本机工程，复用既有组件 / Token / 图标"
			}];
			children.push(react.default.createElement("div", { style: {
				...GROUP,
				marginTop: 10
			} }, react.default.createElement("div", { style: GROUP_HEAD }, react.default.createElement("span", null, "① 设计稿 → 代码"), react.default.createElement("span", { style: {
				fontSize: 11,
				opacity: .6
			} }, "安全只读"), readCfg === void 0 ? null : readCfg.configured ? react.default.createElement(Chip, { tone: "on" }, `已启用 · ${readCfg.backend}引擎`) : react.default.createElement(Chip, { tone: "off" }, "未启用")), react.default.createElement("div", { style: {
				padding: "12px",
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("div", { style: {
				fontSize: 12,
				opacity: .8,
				lineHeight: 1.6
			} }, "让模型读取 Figma 画布并生成前端代码（React/Vue/CSS 等）。严格只读：只能提取图层、样式、Token、截图与仓库匹配信息，绝不修改画布，也不向任何远端发送数据。"), react.default.createElement("div", { style: {
				fontSize: 12,
				fontWeight: 600
			} }, "底层引擎（随时切换，即时生效）"), react.default.createElement("div", { style: {
				display: "flex",
				gap: 8,
				flexWrap: "wrap"
			} }, ...engines.map((option) => {
				const selected = backend === option.id;
				return react.default.createElement("button", {
					key: option.id,
					type: "button",
					onClick: () => setBackend(option.id),
					style: {
						...BUTTON,
						flex: "1 1 220px",
						textAlign: "left",
						padding: "7px 10px",
						borderColor: selected ? "rgba(59,130,246,0.85)" : "rgba(128,128,128,0.35)",
						background: selected ? "rgba(59,130,246,0.12)" : "transparent"
					}
				}, react.default.createElement("div", { style: {
					fontSize: 12,
					fontWeight: 600,
					color: selected ? "#60a5fa" : void 0
				} }, selected ? `✓ ${option.label}` : option.label), react.default.createElement("div", { style: {
					fontSize: 11,
					opacity: .65,
					marginTop: 2
				} }, option.note));
			})), backend === "figwright" ? react.default.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: 6
			} }, react.default.createElement("div", { style: {
				fontSize: 12,
				opacity: .8
			} }, "目标代码目录（可选）— 仅本机读取，用于把 Figma 组件/Token/图标匹配到你工程中的实现，不上传任何代码："), react.default.createElement("div", { style: {
				display: "flex",
				gap: 6,
				alignItems: "center"
			} }, react.default.createElement("input", {
				type: "text",
				value: repoDir,
				spellCheck: false,
				placeholder: "/Users/you/my-project（可手输，或点「浏览…」选择项目根目录）",
				onChange: (e) => setRepoDir(e.target.value),
				style: {
					flex: 1,
					minWidth: 0,
					border: "1px solid rgba(128,128,128,0.35)",
					background: "rgba(0,0,0,0.18)",
					color: "inherit",
					borderRadius: 4,
					padding: "5px 8px",
					fontSize: 12,
					fontFamily: "monospace"
				}
			}), react.default.createElement("button", {
				type: "button",
				style: {
					...BUTTON,
					whiteSpace: "nowrap"
				},
				disabled: busy !== "",
				onClick: () => setPickerOpen(true)
			}, "浏览…"), repoDir !== "" ? react.default.createElement("button", {
				type: "button",
				style: {
					...BUTTON,
					whiteSpace: "nowrap"
				},
				disabled: busy !== "",
				onClick: () => setRepoDir("")
			}, "清除") : null), pickerOpen ? react.default.createElement(RepoDirPicker, {
				value: repoDir,
				onPick: (picked) => {
					setRepoDir(picked);
					setPickerOpen(false);
				},
				onClose: () => setPickerOpen(false)
			}) : null, react.default.createElement("div", { style: {
				fontSize: 11,
				opacity: .6
			} }, "切换引擎后，模型可见的工具列表会立即刷新（当前对话即可使用新工具）；若未刷新，重启 DSH Desktop 即生效。")) : react.default.createElement("div", { style: {
				fontSize: 11,
				opacity: .6
			} }, "切换引擎后，模型可见的工具列表会立即刷新（当前对话即可使用新工具）；若未刷新，重启 DSH Desktop 即生效。"), readMessage !== null ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "#4ade80",
				background: "rgba(34,197,94,0.08)",
				border: "1px solid rgba(34,197,94,0.35)",
				borderRadius: 6,
				padding: "6px 10px"
			} }, readMessage) : null, react.default.createElement("div", { style: {
				display: "flex",
				gap: 8
			} }, react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "" || status === null,
				onClick: applyRead
			}, busy === "read" ? "配置中…" : readCfg !== void 0 && readCfg.configured ? "保存引擎设置" : "启用"), readCfg !== void 0 && readCfg.configured ? react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "",
				onClick: removeRead
			}, "停用") : null))));
			children.push(react.default.createElement("div", { style: {
				...GROUP,
				marginTop: 10
			} }, react.default.createElement("div", { style: GROUP_HEAD }, react.default.createElement("span", null, "② AI 主动设计"), react.default.createElement("span", { style: {
				fontSize: 11,
				opacity: .6
			} }, "完整读写"), writeCfg === void 0 ? null : writeCfg.configured ? react.default.createElement(Chip, { tone: "on" }, "已启用") : react.default.createElement(Chip, { tone: "off" }, "未启用")), react.default.createElement("div", { style: {
				padding: "12px",
				display: "flex",
				flexDirection: "column",
				gap: 10
			} }, react.default.createElement("div", { style: {
				fontSize: 12,
				opacity: .8,
				lineHeight: 1.6
			} }, "让模型直接在 Figma 画布上自动绘制、批量生成与修改设计。拥有完整读写权限，支持执行画布构建与排版指令。"), writeMessage !== null ? react.default.createElement("div", { style: {
				fontSize: 12,
				color: "#4ade80",
				background: "rgba(34,197,94,0.08)",
				border: "1px solid rgba(34,197,94,0.35)",
				borderRadius: 6,
				padding: "6px 10px"
			} }, writeMessage) : null, react.default.createElement("div", { style: {
				display: "flex",
				gap: 8
			} }, react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "",
				onClick: applyWrite
			}, busy === "write" ? "写入中…" : "启用"), writeCfg !== void 0 && writeCfg.configured ? react.default.createElement("button", {
				type: "button",
				style: BUTTON,
				disabled: busy !== "",
				onClick: removeWrite
			}, "停用") : null), status !== null ? react.default.createElement("div", { style: {
				fontSize: 11,
				opacity: .5,
				marginTop: 4
			} }, `配置文件: ${status.patchPath}`) : null)));
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
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "sight-figma-mcp",
				order: 13,
				label: () => "Figma MCP"
			}, () => react.default.createElement(FigmaMcpPage, null)));
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