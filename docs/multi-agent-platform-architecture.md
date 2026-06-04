# 多智能体协作平台 — 架构设计方案

> 基于 Claude Space + OpenClaw + Hermes 的本地/云端混合多智能体开发平台

---

## 一、现状分析

### 1.1 现有资产

```
claude-space (Electron 桌面端)
├── ChatPanel      — 单聊 + 群聊 UI
├── TerminalPanel  — Claude CLI 原生终端
├── TaskBoard      — 任务看板 + 计划列表
├── PixelOffice    — 虚拟办公室 (9 个角色)
├── agentPool.ts   — 多智能体池 (spawn ClaudeProcess)
├── useTaskSync    — Claude 工具调用 → 任务追踪
└── SshPanel       — SSH 远程连接

agent-dashboard (Web 面板)
├── FastAPI 后端 + SQLite
├── Vue 3 前端
└── Workflow 可视化编排
```

**核心能力**：单 Claude 进程驱动，通过 Agent/Workflow 工具调用 spawn 子智能体。但子智能体之间不能直接通信，没有共享记忆，任务结束后状态丢失。

### 1.2 关键局限

| 维度 | 当前状态 | 差距 |
|------|---------|------|
| 智能体通信 | 单向 (主 Claude → 子 agent) | 需要 peer-to-peer 网状通信 |
| 记忆共享 | 无（每个 agent 独立上下文） | 需要向量数据库 + 图数据库 |
| 角色固化 | 9 个预定义角色，静态配置 | 需要动态角色发现 + 技能注册 |
| 云端协同 | 仅有 SSH 远程终端 | 需要云端 agent 运行时 + 混合部署 |
| 任务编排 | TaskCreate/TaskUpdate 线性流程 | 需要 DAG 依赖图 + 条件分支 |
| 自我进化 | 无 | 需要 Hermes 式技能蒸馏 |
| 安全边界 | 桌面级权限 | 需要沙箱隔离 + 零信任网络 |

---

## 二、目标架构

### 2.1 四层架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    协作表面层 (Surface)                        │
│  Claude Space  │  agent-dashboard  │  Slack/飞书  │  VS Code │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket / REST / MCP
┌──────────────────────────▼──────────────────────────────────┐
│                    编排网关层 (Gateway)                        │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ 任务路由 │ │ 能力注册 │ │ 会话管理  │ │ 安全策略引擎    │  │
│  │ Router  │ │Registry │ │ Session  │ │ Policy Engine  │  │
│  └─────────┘ └─────────┘ └──────────┘ └────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ Agent Interaction Protocol (AIP)
┌──────────────────────────▼──────────────────────────────────┐
│                    智能体运行时层 (Runtime)                     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ OpenClaw     │  │ Hermes       │  │ 自定义 Agent  │      │
│  │ 本地执行引擎  │  │ 自进化引擎   │  │ 专用技能容器  │      │
│  │ (Claude CLI) │  │ (Skills DB)  │  │ (Docker/K8s) │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────┐   │
│  │              混合部署调度器 (Hybrid Scheduler)         │   │
│  │  本地: Ollama + node-pty    │   云端: K8s + Serverless │   │
│  │  隐私数据 → 本地执行        │   重计算 → 云端弹性伸缩   │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    共享记忆层 (Memory)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ 向量数据库│ │ 图数据库 │ │ SQLite   │ │ 技能文件系统  │  │
│  │ (Qdrant) │ │(Neo4j)  │ │ (FTS5)   │ │ .hermes/      │  │
│  │ 语义搜索 │ │ 知识图谱 │ │ 全文检索 │ │ skills/       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 四层详解

#### 协作表面层 (Surface)

用户交互入口，支持多种界面共存：

| 界面 | 定位 | 用户 |
|------|------|------|
| **Claude Space** | 桌面 IDE 级开发工作台 | 开发者（本地） |
| **agent-dashboard** | Web 管理面板 | 项目经理/QA（远程） |
| **Slack/飞书 Bot** | 即时消息入口 | 全团队 |
| **VS Code 插件** | 编辑器内联协作 | 开发者 |

所有界面通过统一 WebSocket 连接到同一网关，看到同一份会话状态。

#### 编排网关层 (Gateway)

参考 IETF DMSC 草案的集中式网关设计：

```
Gateway Service (Go/Rust)
├── Router         — 基于能力的任务路由 (capability-based routing)
├── Registry       — 智能体注册 + 心跳 + 健康检查
├── Session Manager— 会话粘性路由 + 状态持久化
├── Policy Engine  — OPA/Rego 规则引擎 (RBAC + ABAC)
├── Message Bus    — NATS JetStream (持久化消息 + 至少一次投递)
└── Telemetry      — OpenTelemetry (trace + metrics + logs)
```

关键设计决策：
- **持久化运行记录**（参考 Harvey Spectre）：任务运行记录是主要对象，worker 是无状态的
- **Agent Interaction Protocol**（参考 UFO3 AIP）：标准化 agent 间通信协议
- **能力注册**：智能体启动时声明自己的 tools/skills，网关据此路由任务

#### 智能体运行时层 (Runtime)

三种运行时并存：

| 运行时 | 基于 | 适用场景 | 隔离级别 |
|--------|------|---------|---------|
| **OpenClaw 引擎** | Claude CLI + node-pty | 本地文件操作、shell 命令、桌面自动化 | Windows Job Object / macOS App Sandbox |
| **Hermes 引擎** | Python + Skills DB | 工作流蒸馏、GEPA 自我进化、记忆管理 | Docker Container |
| **自定义 Agent 容器** | Docker/K8s Pod | 云端重计算、CI/CD、安全扫描 | K8s Namespace + NetworkPolicy |

混合部署调度策略：

```
任务到达 → 调度器分析
  ├─ 涉及本地文件? → OpenClaw 本地执行
  ├─ 涉及隐私数据? → 本地 Ollama + 私有模型
  ├─ 纯计算/无状态? → K8s 云端弹性伸缩
  ├─ 需要 GPU? → 云端 GPU 节点
  └─ 混合? → 本地预处理 → 云端计算 → 本地回写
```

#### 共享记忆层 (Memory)

混合存储架构：

```
┌─────────────────────────────────────────────┐
│              记忆查询 API (gRPC)              │
├─────────────────────────────────────────────┤
│  语义记忆         │  结构记忆                 │
│  Qdrant          │  Neo4j                   │
│  - 历史对话向量   │  - 代码调用图             │
│  - 代码片段语义   │  - 项目依赖关系           │
│  - 错误模式匹配   │  - 团队协作网络           │
├──────────────────┼──────────────────────────┤
│  全文搜索         │  程序性记忆               │
│  SQLite FTS5     │  .hermes/skills/         │
│  - 会话历史       │  - 蒸馏后的工作流         │
│  - 决策记录       │  - 最佳实践模板           │
│  - 审批日志       │  - 修复模式              │
└──────────────────┴──────────────────────────┘
```

参考 Hermes 的四层记忆架构，增加向量数据库和知识图谱：

| 层级 | Hermes 原版 | 本方案增强 |
|------|-----------|----------|
| L1 提示记忆 | MEMORY.md + USER.md | 同，但由网关统一注入 |
| L2 会话检索 | SQLite FTS5 | SQLite FTS5 + 时间衰减权重 |
| L3 技能记忆 | `.hermes/skills/` | skills/ + 向量索引用于语义匹配 |
| L4 用户建模 | Honcho | Honcho + Neo4j 团队协作图 |

---

## 三、关键子系统设计

### 3.1 多智能体通信协议 (MACom)

参考 UFO3 的 Agent Interaction Protocol (AIP)：

```protobuf
// 智能体间通信消息格式
message AgentMessage {
  string message_id = 1;
  string from_agent = 2;       // 发送方 agent ID
  oneof target {
    string to_agent = 3;       // 点对点
    string to_role = 4;        // 按角色广播 (e.g., "all-implementers")
    string to_topic = 5;       // 按主题订阅
  }
  MessageType type = 6;
  oneof body {
    TaskRequest task = 7;      // 委派任务
    TaskResult result = 8;     // 返回结果
    ClarifyQuestion question = 9; // 澄清请求
    StatusUpdate status = 10;  // 状态更新
    SkillShare skill = 11;     // 技能共享
  }
  map<string, string> metadata = 12;
  string parent_task_id = 13;  // 任务树跟踪
}
```

通信模式：

```
┌─────────────┐     ┌─────────────┐
│  PM Agent   │────▶│ Arch Agent  │  点对点委派
└─────────────┘     └─────────────┘

┌─────────────┐     ┌─────────────┐
│  Lead Dev   │────▶│ Dev1        │  一对多广播
│             │────▶│ Dev2        │  (广播给所有 Implementer)
└─────────────┘     └─────────────┘

┌─────────────┐     ┌─────────────┐
│  QA Agent   │◀───▶│ CI Agent    │  双向协商
└─────────────┘     └─────────────┘
```

### 3.2 动态角色工厂

替代现有 9 个预定义角色，实现按需创建：

```typescript
// 角色定义 → 动态实例化
interface AgentRole {
  id: string
  name: string
  archetype: 'Coordinator' | 'Architect' | 'Implementer' | 'CodeExplorer' | 'SecurityReviewer'
  skills: Skill[]
  tools: ToolBinding[]
  modelBinding: ModelBinding  // 本地/云端模型绑定
  sandbox: SandboxConfig
}

// OpenClaw 集成: Agent 创建 = Role + Skills + Tools
const agent = await openclaw.createAgent({
  role: 'frontend-dev',
  archetype: 'Implementer',
  skills: ['react', 'typescript', 'css'],
  tools: ['Read', 'Write', 'Bash(npm)', 'Grep'],
  model: 'claude-sonnet-4-6',    // 推理用云端
  localModel: 'qwen-coder-7b',    // 代码补全用本地
  sandbox: { type: 'docker', image: 'node:20' }
})
```

### 3.3 Hermes 技能蒸馏管道

```
Claude 执行任务
  │
  ├─ 工具调用 > 5 次? ──▶ 触发蒸馏评估
  ├─ 中途出错后自修复? ─▶ 触发蒸馏评估
  ├─ 用户纠正过输出? ──▶ 触发蒸馏评估
  └─ 走不常见但有效的路径? ─▶ 触发蒸馏评估
         │
         ▼
  GEPA 算法进化 (Genetic-Pareto Prompt Evolution)
         │
         ├─ 反思性变异: 分析成功/失败点，生成改进变体
         ├─ 帕累托选择: 多维度评估 (效率/质量/可靠性)
         └─ 自然语言反馈: 用户评价 → 权重调整
         │
         ▼
  .hermes/skills/<skill-name>.md
         │
         ▼
  注册到能力注册中心 (Registry) → 其他 agent 可发现和复用
```

### 3.4 混合部署决策树

```
任务特征分析
  │
  ├─ 需要访问本地文件系统? ──────▶ 本地 OpenClaw 运行时
  ├─ 数据敏感级别 > threshold? ──▶ 本地 Ollama + 私有模型
  ├─ 需要 GPU 推理? ─────────────▶ 云端 GPU 节点 (Lambda/AutoSpot)
  ├─ 无状态 + 可并行? ────────────▶ K8s Serverless (Scale-to-zero)
  ├─ 需要交互式终端? ────────────▶ 本地 PTY session
  └─ 定时批处理? ────────────────▶ 云端 CronJob

成本优化:
  - 本地: 桌面空闲 GPU → Ollama 推理 (零边际成本)
  - 云端: Spot Instance + 自动缩容 → 比按需实例便宜 70%
  - 混合: 本地预处理 (token 压缩 10x) → 云端推理 (API 费用降低)
```

### 3.5 安全架构

参考 IETF DMSC 的零信任设计：

```
┌────────────────────────────────────────────┐
│              安全策略引擎 (OPA)              │
├────────────────────────────────────────────┤
│  认证层    │  mTLS + JWT + Agent Identity   │
│  授权层    │  RBAC (角色) + ABAC (属性+上下文) │
│  隔离层    │  Docker/K8s Namespace (云端)    │
│           │  Windows Job Object (本地)      │
│  审计层    │  区块链哈希链 (操作不可篡改)      │
│  数据层    │  传输加密 (mTLS) + 静态加密      │
└────────────────────────────────────────────┘
```

Agent 权限分级：

| 级别 | 权限范围 | 示例 |
|------|---------|------|
| L0 | 只读文件 + 搜索 | CodeExplorer |
| L1 | 读写文件（限定目录） | Implementer |
| L2 | Shell 命令（白名单） | DevOps Agent |
| L3 | 网络 + 外部 API | Integration Agent |
| L4 | 系统级操作（需审批） | Coordinator |

---

## 四、与现有代码的集成路径

### 4.1 演进路线图

```
Phase 1 (当前 → 1个月): 底座加固
  ✅ 事件监听器泄漏修复
  ✅ Chat/Terminal 统一路由
  ✅ 智能体角色状态同步
  🔲 子智能体间消息传递 (MACom v0.1)
  🔲 Agent 启动声明 tools/skills 清单

Phase 2 (1→3个月): 记忆与技能
  🔲 Qdrant 向量数据库集成 (嵌入 + 语义搜索)
  🔲 Neo4j 代码知识图谱 (调用链 + 依赖图)
  🔲 .hermes/skills 目录结构 + 自动蒸馏触发
  🔲 能力注册中心 (Consul/etcd + REST API)

Phase 3 (3→6个月): 混合部署
  🔲 K8s Agent Runtime (Helm Chart)
  🔲 混合调度器 (本地 ↔ 云端路由)
  🔲 安全网关 (OPA + mTLS + 审计链)
  🔲 VS Code + Slack 集成

Phase 4 (6→12个月): 生态开放
  🔲 Skill Marketplace (社区技能市场)
  🔲 Multi-tenant SaaS (agent-dashboard 多租户版)
  🔲 联邦学习 (隐私保护跨组织知识共享)
```

### 4.2 代码改造优先级

| 现有模块 | 改造方向 | 工作量 |
|---------|---------|--------|
| `electron/agentPool.ts` | → Agent Runtime Manager (多运行时适配) | 大 |
| `src/hooks/useTaskSync.ts` | → Task DAG Engine + MACom 协议解析 | 中 |
| `src/components/PixelOffice.tsx` | → 动态角色工厂 UI | 中 |
| `electron/claudeProcess.ts` | → OpenClaw Adapter (封装 Claude CLI) | 小 |
| `electron/main.ts` | → Gateway 轻量版 (路由 + 会话 + 策略) | 大 |
| `agent-dashboard/backend/` | → Registry Service + Memory API | 大 |

### 4.3 技术栈建议

| 组件 | 技术选型 | 原因 |
|------|---------|------|
| 网关 | **Go** (KrakenD/自研) | 高并发、低延迟、成熟生态 |
| 消息总线 | **NATS JetStream** | 持久化、至少一次投递、Go 原生 |
| 向量数据库 | **Qdrant** | Rust 编写、高性能、过滤能力 |
| 图数据库 | **Neo4j** | 代码调用图最适合属性图模型 |
| 能力注册 | **Consul** | 服务发现 + 健康检查 + KV 存储 |
| 策略引擎 | **OPA** (Rego) | CNCF 毕业项目、声明式策略 |
| 云端运行时 | **K8s + Knative** | Scale-to-zero、事件驱动 |
| 本地推理 | **Ollama + llama.cpp** | 零成本、隐私保护 |
| 审计 | **区块链哈希链** | 操作不可篡改、合规审计 |

---

## 五、与 OpenClaw & Hermes 的关系

```
本平台的定位不是替代 OpenClaw 或 Hermes，
而是在它们之上构建协作层:

  ┌──────────────────────────────────┐
  │   我们的平台 (协作 + 编排 + UI)    │
  │   - Gateway (路由/安全/会话)      │
  │   - Multi-Agent Orchestration    │
  │   - Team Collaboration UI        │
  │   - Local/Cloud Hybrid Scheduler │
  └──────────┬───────────┬───────────┘
             │           │
  ┌──────────▼──┐  ┌─────▼──────────┐
  │  OpenClaw   │  │    Hermes      │
  │  执行运行时  │  │   记忆+进化     │
  │  (Claude    │  │  (Skills DB    │
  │   CLI/MCP)  │  │   GEPA/蒸馏)   │
  └─────────────┘  └────────────────┘
```

- **OpenClaw** 作为底层引擎：执行文件操作、Shell 命令、浏览器自动化
- **Hermes** 作为学习层：蒸馏工作流 → skills、GEPA 进化、跨会话记忆
- **我们的平台** 作为中间层：多智能体协作编排 + 混合部署 + 团队 UI

不是竞争关系，而是 **协作共生**：OpenClaw 做执行、Hermes 做记忆、我们做编排。

---

## 六、总结

这套架构的核心差异化在于：

1. **真正多智能体协作** — 不是简单的 "Claude 调用子 agent"，而是 peer-to-peer 网状通信 + 共享记忆 + 动态角色
2. **本地/云端混合** — 隐私数据本地处理，重计算云端弹性，成本最优
3. **自我进化** — 集成 Hermes GEPA 算法，越用越聪明，skill 自动沉淀
4. **安全第一** — 零信任架构 + OPA 策略引擎 + 沙箱隔离 + 审计链
5. **开放生态** — 不是封闭系统，而是 OpenClaw + Hermes 的协作编排层

**预计投资**: 12 个月 → 4 个 Phase → 3-5 人核心团队 → 可达到商业化 MVP 水平。
