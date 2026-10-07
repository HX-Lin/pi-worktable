# Pi Worktable — v1 功能规格（草案）

本文件记录已确定的产品决策。实现进度以代码与测试为准。

## 0. 身份

| 字段           | 值                                                     |
| -------------- | ------------------------------------------------------ |
| productName    | `Pi Worktable`                                         |
| userData       | `~/.config/Pi Worktable/`                              |
| appId          | `app.hxlin.pi-worktable`                               |
| executableName | `pi-worktable`（Wayland app_id / niri `match app-id`） |
| npm 包名       | `@hxlin/pi-worktable`                                  |
| 深链协议       | `pi-worktable://session/<id>`                          |
| 仓库           | `https://github.com/HX-Lin/pi-worktable`               |

`~/.pi/agent/` 下的会话、`pi-desktop-*.json` 配置与 `pi-desktop-*` 会话标记**保持不变**：
会话格式属于 pi 与既有历史，改名会丢历史或需要迁移。

首次启动会把旧 userData 中可移植的状态（窗口布局、渠道配对、凭据保险箱、中断快照）
一次性复制到新目录；Chromium 缓存、热更新覆盖层、托管工具链不复制。

## 1. 目标与非目标

**目标**：多项目并发、以对话为中心、可看代码、手机远程干活、多 agent、项目级记忆、
任务看板、语音输入；单人使用；中英双语。

**非目标（v1）**：终端/跑命令、插件系统、工具链自动安装、飞书以外的渠道、
应用内透明度与壁纸取色、多用户与权限体系。

## 2. 架构

- **保留 SDK 内嵌**（`AgentSession` 在 agent-host 进程内），因为需求是**多会话并发**：
  一个进程内跑 N 个会话并共享模型运行时。pi 的 RPC 模式一次只有一个活跃会话，
  不满足该需求。
- 进程模型不变：shell（Electron main）/ agent-host（utilityProcess）/ renderer（Chromium）。
- 可选能力（闸门、压缩、路由、记忆、子代理）以扩展或 host 模块形式存在，互不耦合。

## 3. 界面

| #   | 界面         | 内容                                                                                                                                   |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 主界面       | 左：项目/会话（分组、运行中、未读、待审批徽标）；中：对话（流式、工具卡片、diff、审批卡）；右：代码面板（文件树 + 只读查看器，可折叠） |
| 2   | Agent 面板   | 主会话与所有子 agent：状态、模型、token、成本、上下文占用；点入查看该 agent 的流                                                       |
| 3   | 看板         | 列（待办/进行中/待审/完成）；卡片（标题、指派 agent、关联会话、结果）；拖拽、派活                                                      |
| 4   | 记忆         | 项目记忆条目（事实/决策/脚本）；查看、编辑、删除；显示本轮注入了什么                                                                   |
| 5   | 设置         | 模型 / MCP / 通用（语言、外观跟随系统）                                                                                                |
| H5  | 手机（飞书） | 会话列表、对话、下达指令、审批、图片、看板（轻量）、语音                                                                               |

## 4. 数据模型

```
session   复用 ~/.pi/agent（pi 原生格式，零迁移）
task      项目内 .pi/tasks.json  { id, title, desc, status, priority, agentId, sessionId, result }
memory    项目内 .pi/memory/     { facts, decisions, scripts, summary }
agent     .pi/agents/*.md        frontmatter（名称、模型、工具、提示）
theme     env → DMS colors.kdl → 内置默认
```

## 5. 新功能实现路径

| 功能       | 机制                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 多 agent   | pi 官方 `examples/extensions/subagent/` 同款：agent 定义文件 + `subagent` 工具；每个子 agent 独立上下文窗口，支持并行流式、用量统计、中断传播；统一进 Agent 面板；可从看板卡片派活。内置 `scout` / `planner` / `reviewer` / `worker` |
| 看板       | 参考官方 `todo.ts`，但任务状态落盘（跨会话聚合）；`task` 工具（add/update/list）+ 拖拽 UI                                                                                                                                            |
| 项目级记忆 | `before_agent_start` 注入项目记忆段；会话结束或手动触发 → 分类器蒸馏写回；轻量查看与编辑                                                                                                                                             |
| 语音输入   | v1 走云 STT（复用已配置 provider）；本地 whisper.cpp 作为可选开关；桌面麦克风按钮 + 手机录音上传                                                                                                                                     |

## 6. 主题与桌面集成

外观（透明、模糊、圆角、配色）由 **niri + DMS/Quickshell** 提供，应用只暴露主题契约。

```kdl
window-rule {
    match app-id=r#"^pi-worktable$"#
    opacity 0.96
    geometry-corner-radius 12
    clip-to-geometry true
    draw-border-with-background false
    background-effect { xray true; blur true }
}
```

应用侧：

- CSS 变量 `--app-bg` / `--app-surface` / `--app-fg` / `--app-accent` / `--app-radius`；
- 取值优先级：`PI_ACCENT` 等环境变量 → DMS `~/.config/niri/dms/colors.kdl` → 内置默认；
- 明暗跟随 XDG portal `org.freedesktop.appearance color-scheme`；
- 默认不自行做透明（由合成器 `opacity` 决定），可选 `PI_TRANSPARENT=1` 让根背景透明；
- 保留 niri 适配：`prefer-no-csd` 下自绘 header 与拖动区域、Wayland/缩放、托盘、通知。

## 7. 裁剪清单（v1 不做）

终端（含 `node-pty`）、插件系统、工具链自动安装、微信与 Telegram 渠道、能力总览面板、
会话诊断面板、迷你地图、上下文折叠（含 vendored 引擎）、壁纸取色、应用内透明度与 glow、
Skills/Prompts/Channels 的配置界面（改为直接编辑文件）。

保留：i18n 双语、热更新、中断自动继续、系统通知、托盘与菜单、工具闸门、压缩、
模型与 MCP 设置、飞书远程。

## 8. 里程碑

| 阶段 | 内容                                                 | 验收                                             |
| ---- | ---------------------------------------------------- | ------------------------------------------------ |
| M0   | 身份脱离（已完成）                                   | typecheck / lint / 567 测试 / 契约与安全检查全绿 |
| M1   | 裁剪：终端、插件、工具链、折叠、记忆面板、非飞书渠道 | 代码量下降，功能不回归                           |
| M2   | 主界面收敛（对话为中心 + 代码面板）                  | 可日常替代旧界面                                 |
| M3   | 多 agent + Agent 面板                                | 并行子代理可跑、用量可见                         |
| M4   | 看板 + `task` 工具                                   | 任务可增改、可派活、手机可看                     |
| M5   | 项目级记忆                                           | 按项目隔离、自动注入、可编辑                     |
| M6   | 语音输入                                             | 桌面与手机可用                                   |
| M7   | 主题契约 + niri/DMS 接线                             | 跟随 DMS 配色与合成器透明度                      |

## 9. 待定

- 看板是否允许手动新建任务（倾向允许）。
- 语音：云 STT 优先还是本地 whisper 优先。
- 多标签页是否保留（倾向仅保留"打开的会话"）。
- 子 agent 是否出现在侧栏会话列表（倾向只进 Agent 面板）。
- `~/.pi/agent/pi-desktop-*.json` 配置文件是否改名（需迁移，倾向暂不改）。
