# @eric.wen/dsh-sight

DeepSeek Harness（DSH）插件：**自动补推理等级** + **Figma MCP 桥接**。

设置页分两个独立入口：`模型推理等级` 与 `Figma MCP`，各自独立配置、互不影响。

## 功能

### 🧠 自动补推理等级

新增第三方渠道后，模型默认没有任何推理档位（模型选择器里看不到 Low/High/Max 等选项）。设置页点一下「**自动补推理等级**」，插件会按内置的模型家族字典，给未声明推理档位的模型写入其官方支持的档位：

| 模型家族 | 写入档位（reasoningEfforts） |
| --- | --- |
| GPT-5.x | off / high / xhigh / max |
| o3 / o4 | off / low / medium / high |
| Grok 4.x | off / low / medium / high / xhigh |
| DeepSeek V4 | off / high / max |
| GLM-5.x | off / high / xhigh / max |
| Kimi K3 | off / low / high / max |
| Qwen 3 | off / low / medium / high |
| MiniMax | off / high |

- 只补**未声明**的模型，已有档位或目录自带推理能力的模型一律不动；
- 档位值跟随各家族官方 API 文档（DeepSeek off/high/max、Grok 4.x low/medium/high/xhigh、GLM-5.2 high/xhigh/max、Kimi K3 low/high/max）；
- 写入 `llm-pi-ai` 配置的 `reasoningEfforts`，下次请求即生效。

### 🔗 Figma MCP（渐进式）

在设置页的 `Figma MCP` 入口，通过两个递进的引导区块接入 Figma：

#### ① 设计稿 → 代码（只读插件，无 REST API）

让模型读取 Figma 设计稿并生成代码。通过 Figma Desktop 中的本地插件桥接读取画布，**不调用 Figma REST API，不需要 Personal Access Token 或代理**，因此不会触发官方 API 限流。

- 数据来源：Figma Desktop 插件 localhost bridge，提供节点树、选区、CSS、样式、变量、组件、截图与仓库匹配等读取工具；
- **底层引擎可随时切换**（设置页「Figma MCP → ① 设计稿 → 代码 → 底层引擎」，保存后即时生效、无需重启 DSH）：
  - `figma-ui-mcp` 原引擎（默认）：Figma 插件「Figma UI MCP Bridge (Sight)」，模型可见 `figma_status` / `figma_read` / `figma_rules` / `figma_files`，保留 get_css / export_svg / scan_design 等读取操作；
  - `figwright` 接地引擎：Figma 插件「Figwright」。在设置页插件安装卡点「一键下载最新版」即可自动下载并解压最新 release（保存在本机配置文件旁，只保留最新一份；网络失败时可点「手动下载（Releases）」兜底），再在 Figma 中 Import plugin from manifest... 选择解压出的 manifest.json 并运行一次。模型可见约 27 个只读工具（`get_design_context` / `component_map` / `token_map` / `icon_map` / `design_diff` / `get_screenshot` 等）。可选填「目标代码目录」，服务器会只读扫描该本机工程，把 Figma 组件/Token/图标匹配到工程已有实现，生成能直接落地、复用既有组件的代码——目录仅本机读取，**不会上传任何代码**；
- 使用：启用后在 Figma Desktop 运行**当前引擎对应的插件**（两者可同时安装，互不冲突），打开目标文件并选中画板/节点，再对模型说"实现成 React/CSS"即可；
- 安全边界：此入口无论哪个引擎都只注册只读工具，不能创建、修改、删除或移动画布节点。

#### ② AI 主动设计（需要 Figma 桌面版 + 插件）

让模型**直接在 Figma 画布上绘制/修改设计**。需要：

- **Figma 桌面版**（网页版无法连接 localhost）；
- **首次安装** Figma 插件（一次性）：
  1. Plugins → Development → Import plugin from manifest...
  2. 选择设置页显示的 manifest.json 路径
  3. 运行「Figma UI MCP Bridge (Sight)」插件，看到**绿点**即已连接（该副本带多文件路由补丁：同时开多个文件时读写会锁定指定文件，见下方「多文件路由」）
- 之后每次只需在 Figma 里运行该插件即可，无需重复导入。

启用后，模型通过 `figma_write` / `figma_read` / `figma_status` 等工具在画布上绘制/修改/截图验证。

> 两个区块相互独立：① 需要运行插件但只读画布，② 才允许 AI 修改画布。两者可以同时启用，分别使用 `figma-read` 与 `figma-ui` 工具 namespace。

#### ✅ 无需开通 Figma 会员

插件走的是社区开源 `figma-ui-mcp` localhost bridge，并由 dsh-sight 提供只读 MCP facade，**不依赖 Figma 的任何付费功能**：

| 能力 | 依赖 | 需要会员吗 |
| --- | --- | --- |
| ① 设计稿 → 代码 | Figma Desktop + 本地只读插件桥 | ❌ 免费账号即可装插件 |
| ② AI 主动设计 | Figma 桌面版 + 插件（localhost 桥） | ❌ 免费账号即可装插件 |

> 对比官方 Figma MCP：远程 server 需要 OAuth，且按套餐/席位限流（View/Collab 席位每月仅约 6 次调用，写画布要求 Dev/Full 席位）。本插件用免费账号即可跑通全部能力，无套餐门槛。

## 安装

### 方式一：npm（推荐）

```sh
dsh plugin --profile desktop add @eric.wen/dsh-sight
```

> 桌面版 DSH Desktop 用 `desktop` profile；本地 CLI 用 `web`（按你的实际 profile 替换）。

npm 分发预构建产物，无需任何授权。

### 方式二：GitHub

```sh
dsh plugin --profile desktop add github:ericfetch/dsh-sight#<commit-sha>
```

一条命令即可：仓库已提交预构建 `lib/` 且无 `prepare` 构建脚本，安装时无需任何构建授权。

### 验证

```sh
dsh --profile desktop --dump-config   # 应出现 "# == @eric.wen/dsh-sight" 补丁层
```

然后**重启 DSH Desktop**，插件自动加载。

## 升级

发布新版本后，**不需要卸载重装**——通过 `--latest` 参数直接升级到 npm 最新版：

```sh
dsh plugin --profile desktop update --latest @eric.wen/dsh-sight
```

- 想锁死大版本范围或装指定版本：`dsh plugin --profile desktop add @eric.wen/dsh-sight@0.1.4`；
- 更新后**重启 DSH Desktop** 生效。

卸载：`dsh plugin --profile desktop remove @eric.wen/dsh-sight`

## 使用

### 模型推理等级

1. **补推理等级**：打开 设置 → 模型推理等级，点「自动补推理等级」，为未声明档位的模型按模型家族写入其官方支持的推理档位；
2. **确认**：结果区列出每个被写入的 `provider/model → 家族 [档位]`，模型选择器随即出现这些档位；
3. **复核**：渠道列表里每行显示该模型当前的推理来源（`推理: …` = 来自适配器/目录，`推理(声明): …` = 来自你写入的 `reasoningEfforts`）。

### Figma MCP

1. **设计稿 → 代码**（区块 ①）：设置页选择底层引擎并（可选）填「目标代码目录」→ 启用 → 重启 DSH（首次启用需要）→ 在 Figma Desktop 运行**当前引擎对应的插件**（figma-ui-mcp 引擎跑「Figma UI MCP Bridge (Sight)」；figwright 引擎跑「Figwright」，均在设置页指引内安装）→ 打开目标文件并选中画板/节点，说"实现"；
2. **AI 主动设计**（区块 ②）：按区块内指引安装「Figma UI MCP Bridge (Sight)」→ 启用 → 重启 DSH → 在 Figma 运行该插件 → 回对话描述设计需求。

> 引擎切换**即时生效**：工具列表会自动刷新，当前对话即可使用新工具；若未刷新，重启 DSH Desktop 即可。① 与 ② 可同时启用；两个 Figma 插件可同时安装、互不冲突（各自只连本机 127.0.0.1 的桥接服务）。

#### 多文件路由（同时开多个 Figma 文件）

「Figma UI MCP Bridge (Sight)」是 DSH 生成的**补丁副本**（设置页有「多文件路由补丁」状态与「重新生成副本」按钮），它让每个 Figma 文件在桥接服务里各自占一条会话（`f:<fileKey>` + 文件名），于是读写可以锁定到指定文件：

- 只开一个文件：自动路由，无感；
- 同时开多个文件：模型必须先用 `figma_files` 指定目标（`{ use: "<文件名>" }`），**否则读写会直接报错并列出候选文件——绝不猜**（宁可报错也不写错文件）；
- 指定后写入会锁定该文件；该文件关掉插件/关闭后，DSH 会报错提示重新指定，**不会**改写到另一个打开的文件；
- 也可以在调用时显式传 `sessionId`（覆盖锁定值）。

> ⚠️ **Figma 导入 dev 插件时会复制文件到它自己的目录**：如果你以前导入过旧版「Figma UI MCP Bridge」，请在插件列表里删掉那一项，再用设置页里的路径**重新导入一次**（现在显示为「Figma UI MCP Bridge (Sight)」，用于区分旧的那份）；没重新导入时仍可用（单文件），但结果里会带一条提醒。
>
> 写入端还有一个隐藏的补丁（`figma-ui-mcp` 生成的入口，设置页显示「服务端入口已补丁」）：上游服务在「桥接已被别的进程占用」时会走 HTTP 代理并丢掉 `sessionId`，补丁把它补回来，因此在任何启动顺序下路由都成立。

> 📖 场景化的「怎么对模型说」见下方 **[Figma MCP 使用手册](#figma-mcp-使用手册场景与话术)**。

## Figma MCP 使用手册（场景与话术）

### 0. 先知道模型手里有哪些工具

DSH 把 MCP 工具挂给模型时带命名空间前缀（形如 `mcp__figma-read__figma_read`、`mcp__figma-ui__figma_write`）。对话里不必背前缀——按功能名说即可，模型会自动调用正确的工具；它拿不到图时会先运行 `figma_status` 自检。

| 能力 | 工具面 | 由哪个插件/引擎提供 |
| --- | --- | --- |
| ① 设计稿 → 代码（figma-ui-mcp 引擎） | `figma_status` · `figma_read`（get_selection / get_design / get_css / get_design_context / get_component_map / export_svg / scan_design …）· `figma_rules` · `figma_files` | Figma UI MCP Bridge (Sight) |
| ① 设计稿 → 代码（figwright 引擎） | `figma_status` + `get_design_context` / `component_map` / `token_map` / `icon_map` / `design_diff` / `get_screenshot` / `analyze_project` 等约 27 个只读工具 | Figwright |
| ② AI 主动设计 | `figma_status` · `figma_write` · `figma_read` · `figma_docs` · `figma_rules` · `figma_files`（可写画布） | Figma UI MCP Bridge (Sight) |

`figma_files` 是写入端新增的**路由开关**：列出当前连着桥接服务的 Figma 文件，并锁定本次要操作的那个（同时开多个文件时，不锁定就会直接报错而不是猜）。

**连接自检话术**（任何会话开始时可选）：

> 先调用 figma_status 确认 Figma 插件已连接；如果没连上，直接告诉我该在 Figma 里运行哪个插件。

### 1. ① 设计稿 → 代码：什么场景用哪个引擎

| 你的需求 | 推荐引擎 | 为什么 |
| --- | --- | --- |
| 快速把设计转成**独立**代码/原型（不落仓库） | figma-ui-mcp | 有 `get_css`（即贴即用的 CSS）、`export_svg`、`figma_rules`、`scan_design` 大画布扫描 |
| 生成**能直接落进你工程**的代码，复用既有组件/Token/图标 | figwright（填「目标代码目录」） | `component_map` / `token_map` / `icon_map` 把 Figma 对象对到本地代码 |
| 设计改版后只更新**受影响的文件** | figwright | `design_diff` 对照基线报告变化 |
| 只要**设计规范/样式系统**（色板、字号、间距） | 两者均可 | figma-ui-mcp 的 `figma_rules`/`get_css` 更快出结果 |
| 一次要读**非常大的画布** | figma-ui-mcp | `scan_design` 渐进式扫描；figwright 对超大树会分节 |

### 2. ① 设计稿 → 代码：场景与话术

> 通用要点：**先选中**要转的画板/节点再发话；话术里给足「技术栈 + 输出位置 + 复用规则」，越具体越准；说完让它**截图自查**。

| 场景 | 怎么对模型说（示例） |
| --- | --- |
| A. 选中的组件/卡片转代码 | “把我在 Figma 里选中的卡片实现成 React 组件（Tailwind），先用 get_design_context / get_css 读结构和样式，按选中画板为准，完成后贴出完整代码。” |
| B. 整页/多画板拆组件 | “这个登录流程页里有 3 个画板（在 Page 1）。按画板逐个读取，拆成页面 + 可复用组件，输出目录结构建议，先不要写文件，给我方案。” |
| C. 落地到现有工程（figwright 引擎） | “读取当前选中帧 → get_design_context 全量 → 再用 component_map / token_map / icon_map 对照我工程（/Users/you/project）里已有的实现。规则：能复用 src/components 里的组件就 import 复用，颜色间距用工程既有 token，图标用已有 svg；确实没有的才新建，并列出新增清单。” |
| D. 设计改版增量更新 | “图上有新版本的设计改动。先对选中的画板做 design_diff 与基线对比，把变化点列给我，再只更新受影响的组件/样式文件，不要重写无关部分。” |
| E. 抽取设计规范 | “读取选中页面（或整个文件的设计系统）：把用到的颜色/字号/间距/圆角整理成一份 Tailwind theme（或 CSS 变量/SCSS token）草案；标注每个值的来源图层，方便我核对。” |
| F. 只做走查/评审 | “不要写代码。读取选中画板结构与截图，按视觉层级、间距一致性、溢出风险做一轮走查，列出问题清单和修改建议。” |

**一句话模板**（可自行填空）：

> 把我在 Figma 选中的【对象】实现成【技术栈：React + Tailwind v4 / Vue3 + scss …】。项目在【目录：figwright 引擎时必填】；【复用规则：优先 import 已有组件、用工程 token、图标走 assets】；输出到【src/components/…】；完成后用截图核对。

**关于图片/资源**：代码里遇到位图（logo、摄影图）时，让模型留占位并提示“请从 Figma 手动导出资源”，不要凭空近似。

### 3. ② AI 主动设计：场景与话术

> 前提：设置页 ② 已启用且 Figma 里运行了「Figma UI MCP Bridge (Sight)」（绿点）。② 与 ① 可同时启用，模型两种工具都有；**只有 ② 能改画布**，想避免任何误写时只启用 ①。

| 场景 | 怎么对模型说（示例） |
| --- | --- |
| A. 从零画一个界面 | “先在画布上找一块空白位置（用 get_page_nodes 看现有画板），然后画一个移动端登录页：390×844，深色风格，包含邮箱/密码输入、主按钮（用文件里已有的变量与样式，不要硬编码色值），画完截图自查。” |
| B. 改选中的设计 | “修改当前选中的画板：标题居中、卡片间距统一为 16、主色换成 accent 变量。改完截图给我看，并列出改动点。” |
| C. 一排/一套页面 | “在登录页右侧 440px 处再画一个注册页，风格与登录页一致，复用它的组件/样式，再补一个忘记密码页，三屏间距统一。” |
| D. 建组件与设计系统 | “把选中的按钮帧转成 Component（btn/primary），设置好组件属性（文本可替换），再把它用到的颜色建为变量集合 Design Tokens（带 light/dark 模式），后续所有节点都绑定变量。” |
| E. 图标 | “这一行按钮用内置图标库（loadIcon，比如 settings、bell），不要用 emoji 当图标，尺寸 18、颜色用 token。” |
| F. 深浅主题预览 | “把 Home 帧克隆两份：Preview/Light 与 Preview/Dark，分别 pin 到 light/dark 模式，让我对照效果。” |
| G. 原型交互 | “给登录按钮加点击跳转到首页帧的交互（Smart Animate），并列出我还可以加哪些跳转。” |
| H. 整理/批处理 | “把当前页面里所有叫 Button Copy 的图层批量重命名为 btn/xxx，并统一它们的圆角与填充。” |
| I. 由描述/代码反向画 UI | “照这段 React 代码的界面结构，在 Figma 画一个 1440×900 的后台页面，布局 1:1 还原：侧边栏 240、顶栏 64、内容区卡片网格。” |

**通用动作模板**：

> 画之前先【读取画布/选区】→ 用文件里已有的【变量/样式/组件】→ 尺寸给【具体数值】→ 每完成一步【截图自查】→ 结尾告诉我【创建/改动清单】和下一步建议。

### 4. 常见问题速查

| 现象 | 处理 |
| --- | --- |
| 报 “plugin not connected / Run the … plugin” | ① figma-ui-mcp 引擎跑「Figma UI MCP Bridge (Sight)」；① figwright 引擎跑「Figwright」；② 跑「Figma UI MCP Bridge (Sight)」。在 Figma 里运行对应插件后重试即可。 |
| 想让模型改画布，但它说没有写工具/工具被拒 | ① 是严格只读的；去设置页启用 ②（并重启 DSH 生效），② 才有 `figma_write`。 |
| 报「多个 Figma 文件已连接」/ 写入报错说没锁定目标 | 同时开了多个文件：让模型先 `figma_files` 指定（`{ use: "<文件名>" }`），或直接说“写到 XXX 文件”。这是故意的保护——宁可不写，也不写错文件。 |
| 结果里出现 “does not carry the per-file session patch” | 当前 Figma 里跑的还是旧插件（导入后没更新）。删掉插件列表里旧的那一项，用设置页路径重新导入「Figma UI MCP Bridge (Sight)」。旧插件下只在“只开一个文件”时可靠。 |
| 设置页显示「未打多文件路由补丁」 | 点「重新生成副本」；若仍失败，看提示里的原因（通常是 `figma-ui-mcp` 升级后结构变了），此时回退为单文件模式仍可用。 |
| 两个引擎/①+② 同时开，工具很多 | 属正常现象：模型按指令选用。想收窄就只开当前任务需要的那个。 |
| 大画板转码内容超长/丢失细节 | 一次只转一个画板；页面太大让模型“先 scan_design 分节/分区块逐个读”。 |
| 切换引擎后工具名变了 | 工具列表会自动刷新（当前对话下一轮即可用）；若没刷新，重启 DSH。切换后建议新开指令重新描述任务。 |
| 生成代码“风格不对、没有用我工程的东西” | ① 用 figwright 引擎并填「目标代码目录」；话术里写明复用规则（见场景 C）。 |
| 网络差时插件下载失败 | 设置页点「手动下载（Releases）」兜底；下载/解压不涉及 Figma。 |

## 说明

- Figma MCP 区块①和②都走 localhost 插件桥且无需代理/Token；① 的引擎与目录切换即时生效并持久化，只暴露读取工具，② 才暴露写画布工具。
- 依赖的 `@deepseek-ai/*` 运行时由 DSH 模块表提供（peer 声明）。

## 开发

```sh
pnpm install
pnpm build        # tsdown：lib/index.js + lib/client.js
pnpm typecheck    # tsc --noEmit
```

发布：`npm version <新版本>` → `npm publish --access public` → `git push origin main --tags`

## License

MIT
