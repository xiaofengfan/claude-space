# Claude Space v1.0.0

> **AI 驱动的项目开发工作台** — 将 Claude Code CLI 的强大能力封装为桌面应用，支持多智能体协作、实时任务追踪、文件编辑与终端操作。
> -刚开始做-碎片时间AI生成-当前仅在个人环境上再用
> -计划进行符合本地项目开发的云边协同开发管理和同步平台，采用本地+云的开发模式，集合openClaw，hermes，claudeCode等进行独立+共享协作的方式的24小时开发中心。

<p align="center">
  <img src="assets/icon.png" alt="Claude Space" width="128" />
</p>

---
<img width="3071" height="1844" alt="image" src="https://github.com/user-attachments/assets/243e1a6e-21f1-429f-abf0-c2a0b67e242d" />

<img width="3050" height="1319" alt="image" src="https://github.com/user-attachments/assets/c76a9432-f7ab-4601-a364-0f1f5fbd9fff" />

<img width="3070" height="1792" alt="image" src="https://github.com/user-attachments/assets/d82e1fb4-ddb7-4519-9680-f1ca2a75266b" />

<img width="1335" height="1267" alt="image" src="https://github.com/user-attachments/assets/cc723ed2-5391-4753-b550-425af62bfc60" />

<img width="1828" height="639" alt="image" src="https://github.com/user-attachments/assets/5c056b74-fd52-43ab-9808-4ca82571515d" />


## 一、系统定位

Claude Space 是一款 **AI 增强型项目开发桌面工作台**，定位为开发者的 "AI 指挥中心"。

它不是简单的 Chat 对话窗口，而是将 Claude Code CLI 的完整能力（流式对话、工具调用、文件操作、任务管理）整合到一个可操作的 GUI 环境中，并在此基础上构建了 **多智能体协作系统** 和 **项目管理层**，让 AI 辅助开发从 "一问一答" 升级为 "团队协同"。

### 核心理念

| 维度 | 传统 AI Chat | Claude Space |
|------|-------------|--------------|
| 交互模式 | 单线程对话 | 多标签页 + 多智能体会话 |
| 项目管理 | 手动切换目录 | 工作区自动扫描 + 一键切换 |
| 任务追踪 | 对话中口头承诺 | 可视化看板 + 状态持久化 |
| 文件操作 | 不可见 | 内置代码编辑器 + 文件树 |
| 终端 | 分离的终端窗口 | 集成终端 + Claude 联动 |
| 团队协作 | 单人使用 | 8 人虚拟团队 + 角色分工 |
| 审批控制 | 无 | 敏感操作弹窗审批 |

### 竞品对比

| 特性 | Claude Code CLI | Cursor / Copilot | Claude Space |
|------|----------------|------------------|--------------|
| 运行方式 | 终端命令行 | IDE 插件 | 独立桌面应用 |
| 文件编辑 | 通过工具调用 | IDE 内直接编辑 | 内置编辑器 + 外部打开 |
| 多项目支持 | 手动 cd | 工作区切换 | 自动扫描 + 导航栏 |
| 智能体协作 | @mention | 不支持 | 5 种角色定义 + 群聊模式 |
| 任务看板 | 无 | 无 | 看板 + 任务统计 + 同步 |
| 离线安装 | npm 全局包 | IDE 市场 | NSIS 安装包 / 便携版 |

---

## 二、使用场景

### 场景 1：日常代码开发 "AI 结对编程"

> 你是一个全栈开发者，同时维护 3-5 个项目。

- 打开 Claude Space，左侧自动列出 `E:\claudespace` 下所有项目
- 点击项目，Claude 自动识别 `CLAUDE.md` 了解项目上下文
- 在 Chat 面板描述需求，Claude 实时读取代码、编写修改、运行测试
- thinking 过程可折叠查看，tool_use 以卡片形式展示
- 修改的文件自动在右侧编辑器打开，可手动审查和调整

### 场景 2：多智能体团队协作

> 你有一个复杂功能需求，需要架构设计 + 编码实现 + 安全审查。

- 在输入框使用 `@张架构` 让架构师角色给出设计方案
- 设计方案确认后，`@赵工 @钱开发` 分配编码任务
- 代码完成后，`@吴审查` 执行安全审查
- 切换到右侧 **像素办公室** 视图，观察每个角色的工作状态
- 切换到 **群聊模式**，所有角色在同一会话中协作

### 场景 3：项目代码审查 / 技术调研

> 你需要快速了解一个陌生项目的架构和关键代码。

- 在 Welcome 页面一键扫描工作区所有项目
- 选中项目后，在 Chat 中提问："分析这个项目的架构，列出关键模块和数据流"
- Claude 通过 `Glob` / `Grep` / `Read` 工具探索代码库
- 使用 **文件浏览器** 手动浏览目录结构
- 探索结果可保存为会话，下次继续

### 场景 4：任务追踪与进度管理

> 你同时推进多个开发任务，需要跟踪 AI 的工作进度。

- Claude 执行的工具操作会自动同步到 **任务看板**
- 看板按 todo / in_progress / done 三列展示
- **任务统计** 面板显示完成率和分布
- 敏感操作（Bash / Write / Edit / Agent 等）会弹出 **审批对话框**，确认后执行
- 任务数据持久化到 `~/.claude/claude-space-tasks.json`

### 场景 5：集成终端开发

> 你需要在终端中执行命令，同时让 Claude 理解上下文。

- 切换到 **终端模式** (`chat` → `terminal`)
- 终端集成 `node-pty`，支持完整 PTY 功能
- Claude 可以读取终端输出，理解运行结果
- 支持多标签页终端会话

### 场景 6：Git 版本控制

> 你需要在开发过程中频繁提交代码。

- 左侧栏切换到 **Git 视图**，查看变更文件列表
- **Git 滑出面板** 支持 staging、commit、查看 diff
- Git 状态与当前项目绑定

---

## 三、系统能力矩阵

### 3.1 项目管理

| 能力 | 描述 |
|------|------|
| 自动扫描 | 扫描工作区根目录下所有项目，跳过 node_modules / .git / dist / target |
| 智能识别 | 读取 CLAUDE.md、package.json、pom.xml、requirements.txt 推断技术栈 |
| 快速切换 | 项目导航栏一键切换，切换时自动终止旧 Claude 进程 |
| 新建项目 | 弹窗创建项目目录 + 生成 CLAUDE.md 模板 |
| 多窗口 | 支持新窗口打开项目，独立的 Electron BrowserWindow |
| Session 管理 | 按项目统计 session 数量，路径编码兼容 Windows（`C:\` → `C--`） |

### 3.2 Chat 交互

| 能力 | 描述 |
|------|------|
| 流式渲染 | 逐 token 显示 Claude 回复，支持 Markdown + 代码高亮 |
| Thinking 折叠 | Claude 思考过程可折叠展示，不影响阅读主回复 |
| 工具调用卡片 | Bash / Read / Write / Edit / Grep / Glob 等操作以卡片展示输入和结果 |
| 多标签会话 | 支持多个并行会话标签页，独立上下文，可重命名、切换、删除 |
| 会话持久化 | 会话名保存到 `~/.claude/claude-space-session-names.json` |
| 历史恢复 | 点击历史 session 可恢复查看过往对话 |
| 命令模式 | 支持 `/cmd` 指令和 `@mention` 智能体指定 |
| 群聊模式 | 多个智能体在同一会话中轮流响应 |

### 3.3 多智能体系统

| 智能体 | 角色 | 擅长 |
|--------|------|------|
| 👔 王经理 (Coordinator) | 项目经理 | 需求分解、任务分配、进度跟踪 |
| 👔 李产品 (Coordinator) | 产品经理 | 需求分析、用户故事 |
| 🏗️ 张架构 (Architect) | 系统架构师 | 架构设计、技术选型、API 设计 |
| 💻 赵工 (Implementer) | 高级工程师 | 核心功能实现、代码优化 |
| 💻 钱开发 (Implementer) | 开发工程师 | 前后端功能开发 |
| 💻 孙开发 (Implementer) | 开发工程师 | 前端组件开发 |
| 🔍 周测试 (SecurityReviewer) | 测试工程师 | 自动化测试、质量保障 |
| 🔍 吴审查 (SecurityReviewer) | 代码审查员 | 安全审查、代码审计 |
| 🔎 Claude (CodeExplorer) | AI 助手 | 代码分析、全栈开发 |

每个智能体有独立的 System Prompt 和回复风格（简洁/详细/技术），通过 `src/agents/personas.ts` 定义。

**智能体池 (AgentPool)**：`electron/agentPool.ts` 管理多个 Claude 子进程实例，支持：
- 按智能体 ID 路由消息
- 上下文传递（前一个智能体的回复注入下一个的输入）
- 并发控制（可配置最大并发数）
- 每个智能体可绑定不同模型

### 3.4 文件管理

| 能力 | 描述 |
|------|------|
| 文件树浏览 | 左侧 ProjectBrowser 展示项目文件树，支持展开/折叠/点击打开 |
| 代码编辑器 | FileEditor 支持多标签页，语法高亮，脏状态标记 |
| Markdown 编辑器 | MarkdownEditor 专用编辑视图 |
| 文件查看器 | FileViewer 独立窗口查看文件内容 |
| 文件类型识别 | `src/utils/fileTypeUtils.ts` 根据扩展名判断文件类型和语言 |

### 3.5 终端集成

| 能力 | 描述 |
|------|------|
| PTY 终端 | node-pty 驱动的全功能终端，支持颜色、光标控制 |
| Claude 联动 | 终端启动时自动关联 Claude 会话 |
| xterm.js | 使用 xterm 5.x + WebGL 渲染，流畅体验 |
| 多标签 | 每个项目独立终端会话 |

### 3.6 Git 集成

| 能力 | 描述 |
|------|------|
| 变更查看 | GitPanel 展示 modified / staged / untracked 文件 |
| 滑出面板 | GitSlidePanel 支持 stage / unstage / commit |
| Diff 查看 | 查看文件变更差异 |

### 3.7 任务管理

| 能力 | 描述 |
|------|------|
| 看板视图 | Todo / In Progress / Done 三列 |
| 任务统计 | TaskStats 展示完成率、状态分布 |
| 任务计划 | TaskPlanList 展示 AI 生成的执行计划 |
| 任务监控 | TaskMonitor 实时监控 Claude 工具调用并生成任务项 |
| 审批流程 | 敏感工具（Bash / Write / Edit / Agent 等）弹窗审批，支持一键批准/拒绝 |
| 持久化 | 任务数据保存到 `~/.claude/claude-space-tasks.json` |

### 3.8 像素办公室 (PixelOffice)

| 能力 | 描述 |
|------|------|
| 虚拟团队 | 8 个等距像素风格人物（SVG 绘制） |
| 工作状态 | working / busy / idle 三种状态，含进度条动画 |
| 工位渲染 | 显示器、键盘、鼠标、椅背像素风格渲染 |
| 点击交互 | 点击人物可查看/编辑属性和工作状态 |
| 团队持久化 | 保存到 `~/.claude/claude-space-team.json` |
| 空闲气泡 | 空闲角色显示随机思考气泡 |

### 3.9 主题与布局

| 能力 | 描述 |
|------|------|
| 暗色/亮色主题 | 一键切换，localStorage 持久化 |
| 可拖拽面板 | 左侧栏 180-420px / 右侧栏 280-560px，拖拽分割线调整 |
| 自定义标题栏 | 无框窗口 + TitleBar 组件（最小化/最大化/关闭） |
| 菜单栏 | 文件/项目/视图/主题/AI/关于 6 组菜单 |
| 状态栏 | 底部状态栏显示 Claude 运行状态 / 模型 / Token / 费用 |

### 3.10 连接与模型管理

| 能力 | 描述 |
|------|------|
| ConnectionPanel | 查看和管理 Claude API 连接状态 |
| 模型选择 | 支持切换 Anthropic 模型（opus / sonnet / haiku） |
| 自定义 API | 支持配置 baseUrl 和 apiKey（兼容第三方 API） |
| 审批模式 | auto / manual 权限模式切换 |

---

## 四、技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程                        │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ main.ts  │  │ claudeProcess│  │  agentPool.ts     │  │
│  │ 窗口管理  │  │ spawn/解析   │  │  多智能体调度      │  │
│  │ IPC 路由  │  │ stream-json  │  │  并发控制         │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │preload.ts│  │terminalProc  │  │connectionService  │  │
│  │contextBr │  │node-pty 集成  │  │  模型连接管理      │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
├─────────────────────────────────────────────────────────┤
│                 IPC (contextBridge)                      │
├─────────────────────────────────────────────────────────┤
│                 渲染进程 (React 18)                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ App.tsx — 4面板布局 + 全局状态 + 菜单定义          │   │
│  ├────────────┬──────────────────┬──────────────────┤   │
│  │  左侧栏     │    中间面板       │    右侧栏         │   │
│  │ 文件树      │  ChatPanel       │  任务看板         │   │
│  │ 会话历史    │  流式渲染         │  像素办公室       │   │
│  │ Git 视图   │  工具调用卡片     │  连接管理         │   │
│  │            │  输入框           │  任务计划         │   │
│  │            │                  │  助手面板         │   │
│  ├────────────┴──────────────────┴──────────────────┤   │
│  │  文件编辑器 (FileEditor) — 多标签页                │   │
│  │  集成终端 (TerminalPanel) — xterm.js              │   │
│  │  状态栏 (StatusBar) — 模型/Tokens/费用             │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面框架 | Electron | 28.x |
| UI 框架 | React | 18.x |
| 语言 | TypeScript | 5.x |
| 构建 | Vite | 5.x |
| Electron 插件 | vite-plugin-electron | 0.28 |
| 终端 | xterm + node-pty | 5.x / 1.x |
| Markdown | react-markdown + remark-gfm | 9.x |
| 代码高亮 | react-syntax-highlighter | 15.x |
| 打包 | electron-builder | 24.x |

### Claude CLI 集成

```
渲染进程                      主进程                    Claude CLI
   │                           │                          │
   │──IPC "claude:send"───────▶│                          │
   │                           │──spawn "claude"────────▶│
   │                           │  --output-format          │
   │                           │  stream-json              │
   │                           │  --verbose                │
   │                           │                          │
   │                           │◀──stdout JSONL───────────│
   │◀──IPC "claude:event"─────│  system/init              │
   │◀──IPC "claude:event"─────│  assistant (text chunk)   │
   │◀──IPC "claude:event"─────│  assistant (thinking)     │
   │◀──IPC "claude:event"─────│  assistant (tool_use)     │
   │◀──IPC "claude:event"─────│  result/success           │
   │                           │                          │
   │──IPC "claude:abort"──────▶│──kill()─────────────────▶│
```

---

## 五、快速开始

### 环境要求

- **Node.js** 18+
- **Claude Code CLI** (`npm install -g @anthropic-ai/claude-code`)
- **ANTHROPIC_API_KEY** 环境变量（或通过 Settings 界面配置）
- **Windows 10/11**（当前版本仅支持 Windows，macOS/Linux 适配计划中）

### 安装方式

#### 方式 1：NSIS 安装包（推荐）

下载 `claude-space-1.0.0-x64.exe`，双击安装。支持选择安装目录，生成桌面快捷方式和开始菜单入口。

#### 方式 2：便携版

下载 `claude-space-portable-1.0.0.exe`，直接运行，无需安装。

#### 方式 3：源码启动

```bash
git clone <repo-url> claude-space
cd claude-space
npm install
npm run dev          # 开发模式（Vite + Electron 热重载）
```

### 构建安装包

```bash
npm run electron:build   # tsc + vite build + electron-builder
# 输出: release/claude-space-1.0.0-x64.exe
# 输出: release/claude-space-portable-1.0.0.exe
```

---

## 六、项目结构

```
claude-space/
├── electron/                    # Electron 主进程
│   ├── main.ts                  # 窗口管理 / IPC 路由 / 项目扫描 / 会话管理
│   ├── preload.ts               # contextBridge API（20+ 安全通道）
│   ├── claudeProcess.ts         # Claude CLI 子进程 spawn + JSONL 解析
│   ├── terminalProcess.ts       # node-pty 终端进程管理
│   ├── agentPool.ts             # 多智能体池调度
│   └── connectionService.ts     # API 连接管理
│
├── src/                         # React 渲染进程
│   ├── App.tsx                  # 根组件 — 4面板布局 + 全局状态
│   ├── App.css                  # 全局样式（暗色/亮色主题变量）
│   ├── agents/
│   │   └── personas.ts          # 5 种智能体角色定义
│   ├── components/
│   │   ├── ChatPanel.tsx        # Chat 核心 — 流式接收 + 工具调用解析
│   │   ├── MessageBubble.tsx    # 消息气泡渲染（Markdown + 代码高亮）
│   │   ├── ThinkingBlock.tsx    # 可折叠 thinking 块
│   │   ├── ToolUseBlock.tsx     # 工具调用卡片
│   │   ├── InputBox.tsx         # 消息输入框（/cmd + @mention）
│   │   ├── TerminalPanel.tsx    # xterm.js 终端面板
│   │   ├── FileEditor.tsx       # 多标签页代码编辑器
│   │   ├── FileViewer.tsx       # 文件查看器组件
│   │   ├── FileViewerWindow.tsx # 独立文件查看窗口
│   │   ├── MarkdownEditor.tsx   # Markdown 编辑视图
│   │   ├── ProjectBrowser.tsx   # 项目文件树浏览器
│   │   ├── ProjectNav.tsx       # 项目导航栏
│   │   ├── ProjectManagerDialog.tsx # 项目管理弹窗
│   │   ├── ProjectSwitchDialog.tsx  # 项目切换确认弹窗
│   │   ├── SessionList.tsx      # 会话历史列表
│   │   ├── WelcomePage.tsx      # 欢迎页面（扫描项目/快速打开）
│   │   ├── TaskBoard.tsx        # 任务看板（看板视图）
│   │   ├── TaskStats.tsx        # 任务统计面板
│   │   ├── TaskPlanList.tsx     # 任务计划列表
│   │   ├── TaskMonitor.tsx      # 任务实时监控
│   │   ├── ApprovalDialog.tsx   # 敏感操作审批弹窗
│   │   ├── AssistantPanel.tsx   # 智能体助手面板
│   │   ├── PixelOffice.tsx      # 像素办公室（8 人虚拟团队）
│   │   ├── OfficeView.tsx       # 办公室视图包装
│   │   ├── GitPanel.tsx         # Git 变更查看面板
│   │   ├── GitSlidePanel.tsx    # Git 滑出操作面板
│   │   ├── ConnectionPanel.tsx  # API 连接管理面板
│   │   ├── SettingsDialog.tsx   # 设置弹窗
│   │   ├── MenuBar.tsx          # 自定义菜单栏
│   │   ├── TitleBar.tsx         # 自定义标题栏（窗口控制）
│   │   └── StatusBar.tsx        # 底部状态栏
│   ├── hooks/
│   │   ├── useSplitter.ts       # 面板拖拽分割 hook
│   │   └── useTaskSync.ts       # 任务同步 hook
│   ├── types/
│   │   ├── claude.ts            # Claude stream-json 事件类型
│   │   ├── project.ts           # ProjectInfo / SessionInfo / TaskItem
│   │   ├── settings.ts          # 应用设置接口
│   │   ├── connection.ts        # 连接状态类型
│   │   ├── electron.d.ts        # ElectronAPI 全局类型声明
│   │   └── index.ts             # 类型聚合导出
│   └── utils/
│       └── fileTypeUtils.ts     # 文件类型和语言识别
│
├── assets/
│   └── icon.png                 # 应用图标
├── CLAUDE.md                    # AI 上下文文件
├── OPTIMIZATION_PLAN.md         # v1.0.0 问题诊断与优化方案
├── electron-builder.yml         # 打包配置
├── vite.config.ts               # Vite 构建配置
├── tsconfig.json                # TypeScript 配置
└── package.json                 # 项目配置 + 依赖
```

---

## 七、版本路线

### v1.0.0（当前版本）

- [x] 项目管理（扫描/新建/切换/多窗口）
- [x] Chat 交互（流式/thinking/工具卡片/多标签会话）
- [x] 任务看板 + 审批流程
- [x] 像素办公室（8 人虚拟团队）
- [x] 文件浏览器 + 代码编辑器
- [x] 集成终端（node-pty + xterm.js）
- [x] Git 面板
- [x] 多智能体系统（5 种角色 + AgentPool）
- [x] 暗色/亮色主题
- [x] Windows NSIS 安装包 + 便携版

### v1.1（计划中）

- [ ] 空 catch 错误处理 + UI 反馈
- [ ] 闭包过期修复（Ref 模式）
- [ ] TypeScript `any` 类型消除
- [ ] macOS / Linux 跨平台适配
- [ ] `console.log` → 结构化 logger
- [ ] App.tsx 组件拆分（666 行 → ~150 行）

### v1.2（规划中）

- [ ] Claude 进程长连接模式
- [ ] 会话内容全文搜索
- [ ] 项目模板初始化
- [ ] 插件系统
- [ ] 国际化（i18n）
- [ ] 自动更新（electron-updater）

---

## 八、许可

MIT License

---

<p align="center">
  <sub>Built with Electron 28 + React 18 + TypeScript + ❤️</sub>
</p>
