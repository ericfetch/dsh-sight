# dsh-sight

DeepSeek Harness 插件（社区标准 `dsh.bundle` 形态）：**多模态图片直传声明** + **会话图片清除**。

- **多模态图片直传**：把 `input: ['text','image']` 写进 `llm-pi-ai` 配置（内置主流多模态模型字典 / 设置页逐模型开关），让多模态模型（qwen3.7-plus / kimi-k3 / glm-5.2 / gpt-5.6-* 等）直接接收输入框粘贴的图片（原生图片内容块，不做文本转换）。
- **清除会话图片**：用 surface replace（compaction 同款机制）把图片从**模型可见历史**移除，使 `session.selectModel` 门禁放行、可切回纯文本模型；界面转录保留原图，非破坏性、持久化。

## 结构

| 路径 | 说明 |
| --- | --- |
| `src/index.ts` | Host 半区：注册 `/sight` loopback RPC 信道，处理 6 个端点（status / setVision / applyDictionary / visionStatus / sessionImages / clearImages） |
| `src/client/index.ts` | 浏览器半区：设置页 + 输入框徽标 + 清除按钮，经 `connection.rpc.call` 调 Host |
| `src/config.ts` | 共享信道/端点/类型 |
| `cordis.patch.yml` | bundle 补丁层 |
| `tsdown.config.ts` | 独立构建（node 半区 + client bundle，无 monorepo 依赖） |

## 构建

```sh
pnpm install
pnpm build        # tsdown：lib/index.js + lib/client.js
pnpm typecheck    # tsc --noEmit
```

## 安装（DSH 用户侧）

```sh
# npm 安装（推荐：npm 分发的是预构建 lib/，无需任何授权）
dsh plugin --profile web add dsh-sight

# 或 GitHub 安装（git 拉的是源码，pnpm 会运行 prepare 构建 —— 需要授权）：
dsh plugin --profile web add github:<your-name>/dsh-sight#<commit-sha>
# 首次 add 会失败并提示，把 pnpm 打印的确切包键复制进该 profile 的 pnpm-workspace.yaml：
#   allowBuilds:
#     dsh-sight: true
# 然后重新执行 add。
# 如实看待这项授权：它允许包代码在安装时于你的机器上执行，且不在 agent 的沙箱之内。
# 只对源码可信的包授权，并锁定 commit（#<sha>），让后续推送无法悄悄改变实际运行的内容。

# 验证补丁层
dsh --profile web --dump-config

# 重启 DSH Desktop —— 启动时按 bundles 组合：host 行激活、client bundle 进 __DSH_BOOT__
```

卸载：`dsh plugin --profile web remove dsh-sight`

## 发布

```sh
npm publish       # 发布前先 pnpm build（prepare 已配置，git 安装时自动构建）
```

## 说明

- 「支持图片」是用户对端点的声明，插件不做端点探测；端点实际不支持图片时由 provider 侧拒绝。
- 清除图片只作用于模型可见历史（surface）；原始事件仍留在会话日志与界面转录中。
- 依赖的 `@deepseek-ai/*` 运行时由 DSH 的模块表提供（peer 声明）。
