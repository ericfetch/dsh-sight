# @eric.wen/dsh-sight

DeepSeek Harness 插件（社区标准 `dsh.bundle` 形态）：**多模态图片直传声明** + **会话图片清除**。

- **多模态图片直传**：把 `input: ['text','image']` 写进 `llm-pi-ai` 配置（内置主流多模态模型字典 / 设置页逐模型开关），让多模态模型（qwen3.7-plus / kimi-k3 / glm-5.2 / gpt-5.6-* 等）直接接收输入框粘贴的图片——以原生图片内容块发送，不做任何「图片转文本」的降级。
- **清除会话图片**：用 surface replace（compaction 同款机制）把图片从**模型可见历史**移除，使 `session.selectModel` 门禁放行、可切回纯文本模型；界面转录保留原图，非破坏性、持久化。

## 仓库与包

| 项 | 值 |
| --- | --- |
| GitHub | `github.com/ericfetch/dsh-sight` |
| npm | `@eric.wen/dsh-sight`（`dsh-sight` 已被他人占用；npm scope 取自账号 `eric.wen`） |
| 形态 | `dsh.bundle` + `dsh.client`，Host/Client 双半区，loopback RPC 通信 |

## 结构

| 路径 | 说明 |
| --- | --- |
| `src/index.ts` | Host 半区：注册 `/sight` loopback RPC 信道，处理 6 个端点（status / setVision / applyDictionary / visionStatus / sessionImages / clearImages） |
| `src/client/index.ts` | 浏览器半区：设置页 + 输入框徽标 + 清除按钮，经 `connection.rpc.call` 调 Host |
| `src/config.ts` | 共享信道/端点/类型 |
| `cordis.patch.yml` | bundle 补丁层（插入插件行） |
| `tsdown.config.ts` | 独立构建（node 半区 + client bundle，无 monorepo 依赖） |

## 构建

```sh
pnpm install
pnpm build        # tsdown：lib/index.js + lib/client.js
pnpm typecheck    # tsc --noEmit
```

## 安装（DSH 用户侧）

### 方式一：GitHub 安装（当前可用）

```sh
# pnpm 的 github: 简写（等价于 git+https://github.com/ericfetch/dsh-sight.git#<sha>）
dsh plugin --profile web add github:ericfetch/dsh-sight#<commit-sha>
```

git 安装拉的是**源码**，pnpm 会运行 `prepare`（tsdown）构建 —— 需要授权：

1. 首次 `add` 会失败，pnpm 会打印一个**精确**的 allowBuilds 键（形如
   `@eric.wen/dsh-sight@https://codeload.github.com/ericfetch/dsh-sight/tar.gz/<sha>: true`）；
2. 把**该精确键**复制进该 profile 的 `pnpm-workspace.yaml`：

   ```yaml
   allowBuilds:
     '@eric.wen/dsh-sight@https://codeload.github.com/ericfetch/dsh-sight/tar.gz/<sha>': true
   ```

3. 重新执行 `add`。

如实看待这项授权：它允许包代码在安装时于你的机器上执行，且不在 agent 的沙箱之内。
只对源码可信的包授权，并锁定 commit（`#<sha>`），让后续推送无法悄悄改变实际运行的内容。

### 方式二：npm 安装（npm 审核通过后可用）

```sh
dsh plugin --profile web add @eric.wen/dsh-sight
```

npm 分发预构建 `lib/`，无需任何授权。

### 验证与重启（两种方式相同）

```sh
dsh --profile web --dump-config   # 应出现 "# == @eric.wen/dsh-sight" 补丁层
# 重启 DSH Desktop —— 启动时按 bundles 组合：host 行激活、client bundle 进 __DSH_BOOT__
```

卸载：`dsh plugin --profile web remove @eric.wen/dsh-sight`

## 发布

> ⚠️ **当前状态**：`@eric.wen/dsh-sight@0.1.1` 已发布到 npm（PUT 200 接受），但 packument 仍返回
> 404 —— 新账号/新包处于 npm 自动审核门禁，通常几小时内自动公开。公开前 npm 安装不可用，
> 请用 GitHub 安装；公开后可切换到 npm 方式。

```sh
# 发布前先构建
pnpm build

# 改版本号（会自动改 package.json 并打 git tag，如不想要 tag 加 --no-git-tag-version）
npm version 0.1.2

# 发布（需 npm 登录；账号开 2FA 时需用「bypass 2FA」的 granular access token）
npm publish --access public

# 同步推 GitHub
git push origin main --tags
```

## 说明

- 「支持图片」是用户对端点的声明，插件不做端点探测；端点实际不支持图片时由 provider 侧拒绝。
- 清除图片只作用于模型可见历史（surface）；原始事件仍留在会话日志与界面转录中。
- 依赖的 `@deepseek-ai/*` 运行时由 DSH 的模块表提供（peer 声明）。
