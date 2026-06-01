# Claude Space

本地 Claude Code 桌面管理程序 — 项目管理、Chat 交互、任务看板。

## Tech Stack

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 28 |
| UI 框架 | React 18 + TypeScript |
| 构建 | Vite 5 + vite-plugin-electron |
| Claude 集成 | CLI `stream-json` 双向实时通信 |

## 开发命令

```bash
npm install
npm run dev          # Vite + Electron 开发模式
npm run build        # TypeScript 检查 + 构建
npm run electron:build  # 构建 + 打包 (electron-builder)
```

## 架构

```
electron/
├── main.ts           # Electron 主进程 — 窗口/菜单/IPC路由
├── preload.ts        # contextBridge API
└── claudeProcess.ts  # Claude CLI 子进程管理器 (stdin/stdout)

src/
├── App.tsx           # 4面板布局 + 状态
├── components/
│   ├── ChatPanel.tsx      # Chat 交互核心
│   ├── MessageBubble.tsx  # 消息气泡
│   ├── ThinkingBlock.tsx  # 可折叠 thinking
│   ├── ToolUseBlock.tsx   # 工具调用卡片
│   ├── InputBox.tsx       # 消息输入
│   ├── ProjectBrowser.tsx # 项目列表
│   ├── TaskBoard.tsx      # 任务看板
│   ├── SessionList.tsx    # 会话历史
│   ├── TitleBar.tsx       # 标题栏
│   ├── StatusBar.tsx      # 状态栏
│   └── SettingsDialog.tsx # 设置
└── types/
    ├── claude.ts     # Claude 事件类型
    ├── project.ts    # Project/Task 类型
    └── electron.d.ts # ElectronAPI 类型
```

## Claude 集成

通过 spawn `claude --input-format stream-json --output-format stream-json --verbose` 子进程实现：

- **stdin** → 发送用户消息 (JSONL)
- **stdout** → 接收实时事件: `system/init`, `assistant` (流式内容+thinking+tool_use), `result/success`
- IPC 将 stdout 事件转发到渲染进程，React 实时更新 UI

## 环境要求

- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- ANTHROPIC_API_KEY 环境变量
