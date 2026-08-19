# @eric.wen/dsh-sight

DeepSeek Harness（DSH）插件：**多模态图片直传** + **会话图片清除**。

## 功能

### 🖼 多模态图片直传

在输入框**直接粘贴/拖入图片**，以原生图片内容块发送给多模态模型——不做「图片转文本」的降级流程。

插件内置主流多模态模型字典（Qwen-VL/Omni、GPT-4o/4.1/5、Gemini、Claude 3/3.5/4、Kimi/Moonshot、GLM、Doubao、DeepSeek-VL、LLaVA 等），也可以**逐模型手动声明**。声明后，qwen3.7-plus / kimi-k3 / glm-5.2 / gpt-5.6-* 等模型即可直接接收输入框粘贴的图片。

### 🗑 清除会话图片

会话里发过图片后，DSH 会阻止切换到纯文本模型（报 `session already contains images`）。点一下「清除图片」，把图片从**模型可见历史**移除，就能正常切回 deepseek-v4-flash 等纯文本模型继续对话。

- 界面转录**保留原图**，历史可回看，非破坏性；
- 结果持久化，重启后依然有效。

## 安装

### 方式一：npm（推荐）

```sh
dsh plugin --profile web add @eric.wen/dsh-sight
```

npm 分发预构建产物，无需任何授权。

### 方式二：GitHub

```sh
dsh plugin --profile web add github:ericfetch/dsh-sight#<commit-sha>
```

git 安装会运行构建脚本，首次 `add` 会提示授权：把 pnpm 打印的**精确键**加入该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后重新执行。

### 验证

```sh
dsh --profile web --dump-config   # 应出现 "# == @eric.wen/dsh-sight" 补丁层
```

然后**重启 DSH Desktop**，插件自动加载。

卸载：`dsh plugin --profile web remove @eric.wen/dsh-sight`

## 使用

1. **声明模型**：打开 设置 → 多模态图片直传，逐模型开启「图片直传」，或点「一键应用字典匹配」批量声明；
2. **粘贴发送**：输入框粘贴/拖入图片 → 缩略图草稿 → 发送 → 图片以原生内容直传模型；
3. **徽标提示**：当前模型支持图片时，输入框左侧显示「🖼 图片直传」；
4. **切回文本模型**：会话有历史图片时，输入框出现「🗑 清除图片 (n)」→ 点两次确认 → 切换到纯文本模型不再被拦截。

## 说明

- 「支持图片」是用户对端点的声明，插件不做端点探测；端点实际不支持图片时由 provider 侧拒绝。
- 清除图片只影响**模型可见历史**（surface），原始消息仍保留在会话日志与界面转录中。
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
