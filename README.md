# @eric.wen/dsh-sight

DeepSeek Harness（DSH）插件：**多模态图片直传** + **会话图片清除** + **自动补推理等级** + **Figma MCP 桥接**。

设置页分两个独立入口：`多模态图片直传` 与 `Figma MCP`，各自独立配置、互不影响。

## 功能

### 🖼 多模态图片直传

在输入框**直接粘贴/拖入图片**，以原生图片内容块发送给多模态模型——不做「图片转文本」的降级流程。

插件内置主流多模态模型字典（Qwen-VL/Omni、GPT-4o/4.1/5、Gemini、Claude 3/3.5/4、Kimi/Moonshot、GLM、Doubao、DeepSeek-VL、LLaVA 等），也可以**逐模型手动声明**。声明后，qwen3.7-plus / kimi-k3 / glm-5.2 / gpt-5.6-* 等模型即可直接接收输入框粘贴的图片。

### 🗑 清除会话图片

会话里发过图片后，DSH 会阻止切换到纯文本模型（报 `session already contains images`）。点一下「清除图片」，把图片从**模型可见历史**移除，就能正常切回 deepseek-v4-flash 等纯文本模型继续对话。

- 界面转录**保留原图**，历史可回看，非破坏性；
- 结果持久化，重启后依然有效。

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

#### ① 设计稿 → 代码（只填 Token，零插件）

让模型读取 Figma 设计稿并生成代码。**只需要一个 Figma Personal Access Token**，无需安装任何插件、无需打开 Figma 桌面版。

- 数据来源：Figma **REST API**（在线云端），`get_figma_data` / `download_figma_images` 两个工具；
- 使用：把 Figma 文件/帧链接贴进对话，说"实现成 React/CSS"即可；
- 需要网络代理时在区块里填代理地址（如 `http://127.0.0.1:7897`）。

#### ② AI 主动设计（需要 Figma 桌面版 + 插件）

让模型**直接在 Figma 画布上绘制/修改设计**。需要：

- **Figma 桌面版**（网页版无法连接 localhost）；
- **首次安装** Figma 插件（一次性）：
  1. Plugins → Development → Import plugin from manifest...
  2. 选择设置页显示的 manifest.json 路径
  3. 运行「Figma UI MCP Bridge」插件，看到**绿点**即已连接
- 之后每次只需在 Figma 里运行该插件即可，无需重复导入。

启用后，模型通过 `figma_write` / `figma_read` / `figma_status` 等工具在画布上绘制/修改/截图验证。

> 两个区块相互独立：可以只开 ① 不装插件，需要 AI 画图时才去 ②。（服务可冗余，都启用时两个 server 各自运行。）

#### ✅ 无需开通 Figma 会员

插件走的是社区开源 MCP（`figma-developer-mcp` + `figma-ui-mcp`），**不依赖 Figma 的任何付费功能**：

| 能力 | 依赖 | 需要会员吗 |
| --- | --- | --- |
| ① 设计稿 → 代码 | 个人 access token（REST API） | ❌ 免费账号即可生成 token |
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

发布新版本后，**不需要卸载重装**——pnpm 按已声明的版本范围自动拉取最新：

```sh
dsh plugin --profile desktop update @eric.wen/dsh-sight
```

- 安装时声明的是 `^0.1.x`（允许小版本升级），`update` 会拉到范围内最新版；
- 想锁死大版本范围或装指定版本：`dsh plugin --profile desktop add @eric.wen/dsh-sight@0.1.4`；
- 更新后**重启 DSH Desktop** 生效。

卸载：`dsh plugin --profile desktop remove @eric.wen/dsh-sight`

## 使用

### 多模态图片直传

1. **声明模型**：打开 设置 → 多模态图片直传，逐模型开启「图片直传」，或点「一键应用字典匹配」批量声明；
2. **补推理等级（可选）**：新增第三方渠道后，点「自动补推理等级」为未声明档位的模型写入其支持的推理档位；
3. **粘贴发送**：输入框粘贴/拖入图片 → 缩略图草稿 → 发送 → 图片以原生内容直传模型；
4. **徽标提示**：当前模型支持图片时，输入框左侧显示「🖼 图片直传」；
5. **切回文本模型**：会话有历史图片时，输入框出现「🗑 清除图片 (n)」→ 点两次确认 → 切换到纯文本模型不再被拦截。

### Figma MCP

1. **设计稿 → 代码**（区块 ①）：在设置页填 Figma Token（可选代理）→ 启用 → 重启 DSH → 把 Figma 链接贴进对话，说"实现"；
2. **AI 主动设计**（区块 ②）：按区块内指引安装 Figma 插件 → 启用 → 重启 DSH → 在 Figma 运行「Figma UI MCP Bridge」→ 回对话描述设计需求。

## 说明

- 「支持图片」是用户对端点的声明，插件不做端点探测；端点实际不支持图片时由 provider 侧拒绝。
- 清除图片只影响**模型可见历史**（surface），原始消息仍保留在会话日志与界面转录中。
- Figma MCP 区块①走 Figma REST API（需代理），区块②走本地桥（无需代理/Token）。
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
