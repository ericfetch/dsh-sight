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

两种方式任选其一（GitHub 安装当前可用；npm 安装需先发布，见下方「发布」）。

### 方式一：GitHub 安装（当前可用）

```sh
# pnpm 的 github: 简写（等价于完整 git 地址 git+https://github.com/ericfetch/dsh-sight.git#<sha>）
dsh plugin --profile web add github:ericfetch/dsh-sight#33bdecfb929513684712d910c2482c96c808eb6d
```

git 安装拉的是**源码**，pnpm 会运行 `prepare`（tsdown）构建 —— 需要授权：

1. 首次 `add` 会失败，pnpm 会打印一个**精确**的 allowBuilds 键（形如
   `@ericfetch/dsh-sight@https://codeload.github.com/ericfetch/dsh-sight/tar.gz/<sha>: true`）；
2. 把**该精确键**复制进该 profile 的 `pnpm-workspace.yaml`：

   ```yaml
   allowBuilds:
     '@ericfetch/dsh-sight@https://codeload.github.com/ericfetch/dsh-sight/tar.gz/<sha>': true
   ```

3. 重新执行 `add`。

如实看待这项授权：它允许包代码在安装时于你的机器上执行，且不在 agent 的沙箱之内。
只对源码可信的包授权，并锁定 commit（`#<sha>`），让后续推送无法悄悄改变实际运行的内容。

### 方式二：npm 安装（发布后可用）

```sh
# 发布到 npm 后（见「发布」），直接按包名安装 —— npm 分发预构建 lib/，无需任何授权
dsh plugin --profile web add @ericfetch/dsh-sight
```

### 验证与重启（两种方式相同）

```sh
dsh --profile web --dump-config   # 应出现 "# == @ericfetch/dsh-sight" 补丁层
# 重启 DSH Desktop —— 启动时按 bundles 组合：host 行激活、client bundle 进 __DSH_BOOT__
```

卸载：`dsh plugin --profile web remove @ericfetch/dsh-sight`

## 发布

> ⚠️ **npm 包名 `dsh-sight` 已被他人占用**（`fu3rte` 的另一个插件）。要发布到 npm，必须先：
> 1. 改包名（`package.json` 的 `name`），例如 `@ericfetch/dsh-sight` 或 `dsh-sight-direct` 等未被占用的名字；
> 2. 本机 `npm login`（需要你的 npm 账号）；
> 3. `npm publish`（`lib/` 已预构建，`prepare` 已配置，git 安装时自动构建）。
>
> GitHub 仓库名 `ericfetch/dsh-sight` 不受影响（GitHub 包名可跨用户重复）。

```sh
npm publish       # 发布前先 pnpm build
```

## 说明

- 「支持图片」是用户对端点的声明，插件不做端点探测；端点实际不支持图片时由 provider 侧拒绝。
- 清除图片只作用于模型可见历史（surface）；原始事件仍留在会话日志与界面转录中。
- 依赖的 `@deepseek-ai/*` 运行时由 DSH 的模块表提供（peer 声明）。
