/**
 * 内置模板定义（双模式版）
 *
 * 普通模式（5 个）：原有简单模板，线性 deps + maxAttempts，开箱即用
 * 高级模式（5 个）：v3 增强模板，retryPolicy + advisors + switch + params + edges
 *
 * 普通模式特点：
 * - 简单 maxAttempts 重试
 * - deps 隐式线性依赖
 * - 无参数声明
 * - 无 AI 顾问
 * - 适合快速启动、学习演示
 *
 * 高级模式特点：
 * - retryPolicy（指数/线性退避 + 抖动 + 条件）
 * - 显式 edges + when 条件路由
 * - params 参数声明（可配置）
 * - advisors AI 顾问（failure/gate-fail/after-node）
 * - switch 条件分支
 * - harness-call 多轮 AI 交互
 * - maxIterations 图级防死循环
 * - 适合生产级自动化编排
 */

import type { Template } from './types.js';

const PROMPT_PREFIX = `你是一个资深的全栈开发工程师。请严格遵循以下要求：
1. 仔细阅读项目代码和上下文
2. 输出结构化的 markdown 文档
3. 如果需要修改代码，请明确说明修改位置和原因
4. 保持代码风格与项目一致

项目目标：{goal}
`;

// ── 高级模式通用预设 ─────────────────────────────────────
const RETRY_EXECUTE = {
  maxAttempts: 3,
  backoff: 'exponential' as const,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  jitter: 0.2,
  condition: 'errorType !== "fatal"',
};
const RETRY_ANALYZE = {
  maxAttempts: 2,
  backoff: 'linear' as const,
  baseDelayMs: 2000,
  maxDelayMs: 10000,
};
const RETRY_FAST = {
  maxAttempts: 4,
  backoff: 'exponential' as const,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  jitter: 0.15,
};
const ADVISOR_ON_FAILURE = { trigger: 'failure' as const, harness: 'fix-advisor', injectAs: 'fixSuggestion' };
const ADVISOR_ON_GATE_FAIL = { trigger: 'gate-fail' as const, harness: 'fix-advisor', injectAs: 'gateFixSuggestion' };
const ADVISOR_AFTER_NODE = { trigger: 'after-node' as const, harness: 'review-advisor', injectAs: 'reviewHint' };

// ════════════════════════════════════════════════════════════
// 普通模式（5 个）— 简单模板，开箱即用
// ════════════════════════════════════════════════════════════

export const GREENFIELD_TEMPLATE: Template = {
  id: 'greenfield',
  name: '全新项目',
  description: '【普通】从零创建新项目，完整走通分析→架构→编码→部署流程',
  kind: 'greenfield',
  entry: 'ingest',
  terminals: ['done'],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析项目目录结构，识别项目类型、技术栈、依赖关系。输出 docs/ingest.md' },
    { id: 'comprehend', title: '解读代码库', kind: 'phase', phase: 'COMPREHEND', deps: ['ingest'], prompt: PROMPT_PREFIX + '深入解读代码库结构和意图。输出 docs/comprehend.md' },
    { id: 'analyze', title: '分析需求', kind: 'phase', phase: 'ANALYZE', deps: ['comprehend'], prompt: PROMPT_PREFIX + '分析项目需求，确定技术方案。输出 docs/analysis.md' },
    { id: 'understand', title: '理解代码细节', kind: 'phase', phase: 'UNDERSTAND', deps: ['analyze'], prompt: PROMPT_PREFIX + '深入理解代码细节。输出 docs/understanding.md' },
    { id: 'architect', title: '架构设计', kind: 'phase', phase: 'ARCHITECT', deps: ['understand'], prompt: PROMPT_PREFIX + '生成架构方案。输出 docs/architecture.md' },
    { id: 'decompose', title: '拆分模块', kind: 'phase', phase: 'DECOMPOSE', deps: ['architect'], prompt: PROMPT_PREFIX + '将架构方案拆分为可执行的模块任务。输出 docs/decomposition.md' },
    { id: 'plan', title: '生成计划', kind: 'phase', phase: 'PLAN', deps: ['decompose'], prompt: PROMPT_PREFIX + '生成详细的执行计划。输出 docs/plan.md' },
    { id: 'execute', title: '执行开发', kind: 'phase', phase: 'EXECUTE', deps: ['plan'], maxAttempts: 3, timeoutMs: 30 * 60 * 1000, prompt: PROMPT_PREFIX + '按照计划执行开发任务，编写代码。完成后提交 git commit' },
    { id: 'integrate', title: '整合代码', kind: 'phase', phase: 'INTEGRATE', deps: ['execute'], prompt: PROMPT_PREFIX + '整合各模块代码，解决冲突。输出 docs/integration.md' },
    { id: 'deploy', title: '部署', kind: 'phase', phase: 'DEPLOY', deps: ['integrate'], prompt: PROMPT_PREFIX + '执行部署流程。输出 docs/deploy.md' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['deploy'], prompt: PROMPT_PREFIX + '项目开发完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const REFACTOR_TEMPLATE: Template = {
  id: 'refactor',
  name: '项目重构',
  description: '【普通】对现有项目进行重构，含人工审批 + 测试门禁 + 失败回退',
  kind: 'refactor',
  entry: 'ingest',
  terminals: ['done'],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析现有项目结构，识别重构范围。输出 docs/ingest.md' },
    { id: 'analyze', title: '分析重构需求', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: PROMPT_PREFIX + '分析重构需求和技术方案。输出 docs/analysis.md' },
    { id: 'architect', title: '架构设计', kind: 'phase', phase: 'ARCHITECT', deps: ['analyze'], prompt: PROMPT_PREFIX + '生成重构架构方案。输出 docs/architecture.md' },
    { id: 'approve-architect', title: '审批架构方案', kind: 'human-gate', deps: ['architect'], approvalPrompt: '请审批架构方案', fallbackTo: 'architect' },
    { id: 'decompose', title: '拆分任务', kind: 'phase', phase: 'DECOMPOSE', deps: ['approve-architect'], prompt: PROMPT_PREFIX + '将重构方案拆分为可执行任务。输出 docs/decomposition.md' },
    { id: 'execute', title: '执行重构', kind: 'phase', phase: 'EXECUTE', deps: ['decompose'], maxAttempts: 3, timeoutMs: 30 * 60 * 1000, fallbackTo: 'execute', prompt: PROMPT_PREFIX + '执行重构任务。完成后提交 git commit' },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'integrate', title: '整合验证', kind: 'phase', phase: 'INTEGRATE', deps: ['test-gate'], prompt: PROMPT_PREFIX + '整合重构代码。输出 docs/integration.md' },
    { id: 'review-gate', title: '代码审查', kind: 'gate', gate: 'review', deps: ['integrate'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['review-gate'], prompt: PROMPT_PREFIX + '重构完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const MIGRATION_TEMPLATE: Template = {
  id: 'migration',
  name: '技术栈迁移',
  description: '【普通】将项目从旧技术栈迁移到新技术栈',
  kind: 'migration',
  entry: 'ingest',
  terminals: ['done'],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析现有项目结构和技术栈。输出 docs/ingest.md' },
    { id: 'tech-detect', title: '技术栈识别', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: PROMPT_PREFIX + '识别项目技术栈（6 维度）。输出 docs/tech-detect.md' },
    { id: 'plan', title: '迁移计划', kind: 'phase', phase: 'PLAN', deps: ['tech-detect'], prompt: PROMPT_PREFIX + '生成迁移计划。输出 docs/migration-plan.md' },
    { id: 'approve-plan', title: '审批迁移计划', kind: 'human-gate', deps: ['plan'], approvalPrompt: '请审批迁移计划', fallbackTo: 'plan' },
    { id: 'execute', title: '执行迁移', kind: 'phase', phase: 'EXECUTE', deps: ['approve-plan'], maxAttempts: 3, timeoutMs: 60 * 60 * 1000, fallbackTo: 'execute', prompt: PROMPT_PREFIX + '执行技术栈迁移。完成后提交 git commit' },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'integrate', title: '整合验证', kind: 'phase', phase: 'INTEGRATE', deps: ['test-gate'], prompt: PROMPT_PREFIX + '整合迁移代码。输出 docs/integration.md' },
    { id: 'review-gate', title: '代码审查', kind: 'gate', gate: 'review', deps: ['integrate'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['review-gate'], prompt: PROMPT_PREFIX + '迁移完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const UPGRADE_TEMPLATE: Template = {
  id: 'upgrade',
  name: '小型升级',
  description: '【普通】小型技术升级（依赖版本升级、API 替换）',
  kind: 'upgrade',
  entry: 'ingest',
  terminals: ['done'],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析项目结构和当前依赖版本。输出 docs/ingest.md' },
    { id: 'analyze', title: '分析升级范围', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: PROMPT_PREFIX + '分析需要升级的依赖和影响范围。输出 docs/analysis.md' },
    { id: 'execute', title: '执行升级', kind: 'phase', phase: 'EXECUTE', deps: ['analyze'], maxAttempts: 2, timeoutMs: 20 * 60 * 1000, prompt: PROMPT_PREFIX + '执行升级任务。完成后提交 git commit' },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'review-gate', title: '代码审查', kind: 'gate', gate: 'review', deps: ['test-gate'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['review-gate'], prompt: PROMPT_PREFIX + '升级完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const HOTFIX_TEMPLATE: Template = {
  id: 'hotfix',
  name: '紧急修复',
  description: '【普通】紧急 bug 修复，最短路径 + 自动重试',
  kind: 'hotfix',
  entry: 'ingest',
  terminals: ['done'],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '快速分析项目结构和 bug 上下文。输出 docs/ingest.md' },
    { id: 'analyze', title: '定位 bug', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: PROMPT_PREFIX + '定位 bug 根因。输出 docs/analysis.md' },
    { id: 'execute', title: '执行修复', kind: 'phase', phase: 'EXECUTE', deps: ['analyze'], maxAttempts: 3, timeoutMs: 15 * 60 * 1000, fallbackTo: 'execute', prompt: PROMPT_PREFIX + '执行 bug 修复。完成后提交 git commit' },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['test-gate'], prompt: PROMPT_PREFIX + '修复完成，输出总结报告。输出 docs/summary.md' },
  ],
};

// ════════════════════════════════════════════════════════════
// 高级模式（5 个）— v3 增强，生产级自动化编排
// ════════════════════════════════════════════════════════════

export const GREENFIELD_ADV_TEMPLATE: Template = {
  id: 'greenfield-adv',
  name: '全新项目 · 高级',
  description: '【高级】完整流程 + 退避重试 + AI 顾问 + 参数化配置',
  kind: 'greenfield',
  entry: 'ingest',
  terminals: ['done'],
  params: [
    { name: 'projectType', type: 'enum', required: false, default: 'web-app', description: '项目类型', enum: ['web-app', 'api-service', 'cli-tool', 'library'] },
    { name: 'techStack', type: 'string', required: false, default: '', description: '目标技术栈（如 React+Vite+TS）' },
  ],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析项目目录结构，识别项目类型、技术栈、依赖关系。输出 docs/ingest.md' },
    { id: 'comprehend', title: '解读代码库', kind: 'phase', phase: 'COMPREHEND', deps: ['ingest'], prompt: PROMPT_PREFIX + '深入解读代码库结构和意图。输出 docs/comprehend.md' },
    { id: 'analyze', title: '分析需求', kind: 'phase', phase: 'ANALYZE', deps: ['comprehend'], prompt: PROMPT_PREFIX + '分析项目需求，确定技术方案。输出 docs/analysis.md', retryPolicy: RETRY_ANALYZE },
    { id: 'understand', title: '理解代码细节', kind: 'phase', phase: 'UNDERSTAND', deps: ['analyze'], prompt: PROMPT_PREFIX + '深入理解代码细节。输出 docs/understanding.md' },
    { id: 'architect', title: '架构设计', kind: 'phase', phase: 'ARCHITECT', deps: ['understand'], prompt: PROMPT_PREFIX + '生成架构方案。输出 docs/architecture.md', advisors: [ADVISOR_AFTER_NODE] },
    { id: 'decompose', title: '拆分模块', kind: 'phase', phase: 'DECOMPOSE', deps: ['architect'], prompt: PROMPT_PREFIX + '将架构方案拆分为可执行的模块任务。输出 docs/decomposition.md' },
    { id: 'plan', title: '生成计划', kind: 'phase', phase: 'PLAN', deps: ['decompose'], prompt: PROMPT_PREFIX + '生成详细的执行计划。输出 docs/plan.md' },
    { id: 'execute', title: '执行开发', kind: 'phase', phase: 'EXECUTE', deps: ['plan'], prompt: PROMPT_PREFIX + '按照计划执行开发任务。完成后提交 git commit', retryPolicy: RETRY_EXECUTE, timeoutMs: 30 * 60 * 1000, advisors: [ADVISOR_ON_FAILURE] },
    { id: 'integrate', title: '整合代码', kind: 'phase', phase: 'INTEGRATE', deps: ['execute'], prompt: PROMPT_PREFIX + '整合各模块代码。输出 docs/integration.md' },
    { id: 'deploy', title: '部署', kind: 'phase', phase: 'DEPLOY', deps: ['integrate'], prompt: PROMPT_PREFIX + '执行部署流程。输出 docs/deploy.md' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['deploy'], prompt: PROMPT_PREFIX + '项目开发完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const REFACTOR_ADV_TEMPLATE: Template = {
  id: 'refactor-adv',
  name: '项目重构 · 高级',
  description: '【高级】条件分支（复杂度）+ 退避重试 + AI 顾问 + 参数化',
  kind: 'refactor',
  entry: 'ingest',
  terminals: ['done'],
  maxIterations: 150,
  params: [
    { name: 'complexity', type: 'enum', required: false, default: 'medium', description: '重构复杂度', enum: ['low', 'medium', 'high'] },
    { name: 'autoApprove', type: 'boolean', required: false, default: false, description: '自动审批架构方案' },
  ],
  edges: [
    { from: 'ingest', to: 'analyze', when: 'onSuccess' },
    { from: 'analyze', to: 'complexity-check', when: 'onSuccess' },
    { from: 'complexity-check', to: 'deep-architect', when: { expr: 'complexity === "high"' }, label: '高复杂度' },
    { from: 'complexity-check', to: 'simple-architect', when: { expr: 'complexity !== "high"' }, label: '常规' },
    { from: 'deep-architect', to: 'approve-architect', when: 'onSuccess' },
    { from: 'simple-architect', to: 'decompose', when: 'onSuccess' },
    { from: 'approve-architect', to: 'decompose', when: 'onManualApprove', label: '审批通过' },
    { from: 'approve-architect', to: 'deep-architect', when: 'onManualReject', label: '驳回重做' },
    { from: 'decompose', to: 'execute', when: 'onSuccess' },
    { from: 'execute', to: 'test-gate', when: 'onSuccess' },
    { from: 'execute', to: 'execute', when: 'onFailure', label: '重试', priority: 1 },
    { from: 'test-gate', to: 'review-gate', when: 'onSuccess' },
    { from: 'test-gate', to: 'execute', when: 'onGateFail', label: '测试失败回退' },
    { from: 'review-gate', to: 'done', when: 'onSuccess' },
    { from: 'review-gate', to: 'execute', when: 'onGateFail', label: '审查失败回退' },
  ],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析现有项目结构，识别重构范围。输出 docs/ingest.md' },
    { id: 'analyze', title: '分析重构需求', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: PROMPT_PREFIX + '分析重构需求和技术方案。输出 docs/analysis.md', retryPolicy: RETRY_ANALYZE },
    { id: 'complexity-check', title: '复杂度评估', kind: 'switch', deps: ['analyze'], cases: [
      { when: 'complexity === "high"', to: 'deep-architect', label: '高复杂度路径' },
      { when: 'complexity !== "high"', to: 'simple-architect', label: '常规路径' },
    ] },
    { id: 'deep-architect', title: '深度架构设计', kind: 'phase', phase: 'ARCHITECT', deps: ['complexity-check'], prompt: PROMPT_PREFIX + '高复杂度重构：生成详细架构方案。输出 docs/architecture.md', advisors: [ADVISOR_AFTER_NODE] },
    { id: 'simple-architect', title: '简化架构设计', kind: 'phase', phase: 'ARCHITECT', deps: ['complexity-check'], prompt: PROMPT_PREFIX + '常规重构：生成简化架构方案。输出 docs/architecture.md' },
    { id: 'approve-architect', title: '审批架构方案', kind: 'human-gate', deps: ['deep-architect'], approvalPrompt: '请审批架构方案（高复杂度重构需人工确认）', fallbackTo: 'deep-architect' },
    { id: 'decompose', title: '拆分任务', kind: 'phase', phase: 'DECOMPOSE', deps: ['simple-architect', 'approve-architect'], prompt: PROMPT_PREFIX + '将重构方案拆分为可执行任务。输出 docs/decomposition.md' },
    { id: 'execute', title: '执行重构', kind: 'phase', phase: 'EXECUTE', deps: ['decompose'], prompt: PROMPT_PREFIX + '执行重构任务。完成后提交 git commit', retryPolicy: RETRY_EXECUTE, timeoutMs: 30 * 60 * 1000, advisors: [ADVISOR_ON_FAILURE, ADVISOR_ON_GATE_FAIL] },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'review-gate', title: '代码审查', kind: 'gate', gate: 'review', deps: ['test-gate'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['review-gate'], prompt: PROMPT_PREFIX + '重构完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const MIGRATION_ADV_TEMPLATE: Template = {
  id: 'migration-adv',
  name: '技术栈迁移 · 高级',
  description: '【高级】技术栈识别 + 风险分支 + 退避重试 + AI 顾问 + 子工作流',
  kind: 'migration',
  entry: 'ingest',
  terminals: ['done'],
  maxIterations: 200,
  params: [
    { name: 'targetStack', type: 'enum', required: true, default: 'spring-boot-3', description: '目标技术栈', enum: ['spring-boot-3', 'spring-boot-2', 'quarkus', 'micronaut', 'react', 'vue3'] },
    { name: 'riskTolerance', type: 'enum', required: false, default: 'medium', description: '风险容忍度', enum: ['low', 'medium', 'high'] },
    { name: 'autoRollback', type: 'boolean', required: false, default: true, description: '失败时自动回滚' },
  ],
  edges: [
    { from: 'ingest', to: 'tech-detect', when: 'onSuccess' },
    { from: 'tech-detect', to: 'risk-assess', when: 'onSuccess' },
    { from: 'risk-assess', to: 'high-risk-path', when: { expr: 'risk === "high"' }, label: '高风险' },
    { from: 'risk-assess', to: 'normal-path', when: { expr: 'risk !== "high"' }, label: '正常' },
    { from: 'high-risk-path', to: 'approve-plan', when: 'onSuccess' },
    { from: 'normal-path', to: 'execute', when: 'onSuccess' },
    { from: 'approve-plan', to: 'execute', when: 'onManualApprove', label: '审批通过' },
    { from: 'approve-plan', to: 'high-risk-path', when: 'onManualReject', label: '驳回重做' },
    { from: 'execute', to: 'test-gate', when: 'onSuccess' },
    { from: 'execute', to: 'execute', when: 'onFailure', label: '重试', priority: 1 },
    { from: 'test-gate', to: 'review-gate', when: 'onSuccess' },
    { from: 'test-gate', to: 'execute', when: 'onGateFail', label: '测试失败回退' },
    { from: 'review-gate', to: 'done', when: 'onSuccess' },
    { from: 'review-gate', to: 'execute', when: 'onGateFail', label: '审查失败回退' },
  ],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析现有项目结构和技术栈。输出 docs/ingest.md' },
    { id: 'tech-detect', title: '技术栈识别', kind: 'harness-call', phase: 'ANALYZE', deps: ['ingest'], harness: 'tech-detector', injectAs: 'techStack', prompt: PROMPT_PREFIX + '6 维度识别技术栈。输出 docs/tech-detect.md', advisors: [ADVISOR_AFTER_NODE] },
    { id: 'risk-assess', title: '风险评估', kind: 'switch', deps: ['tech-detect'], cases: [
      { when: 'risk === "high"', to: 'high-risk-path', label: '高风险路径' },
      { when: 'risk !== "high"', to: 'normal-path', label: '正常路径' },
    ] },
    { id: 'high-risk-path', title: '高风险路径处理', kind: 'phase', phase: 'PLAN', deps: ['risk-assess'], prompt: PROMPT_PREFIX + '高风险迁移：制定分阶段迁移计划，含回滚策略。输出 docs/high-risk-plan.md', retryPolicy: { maxAttempts: 5, backoff: 'exponential', baseDelayMs: 2000, maxDelayMs: 60000, jitter: 0.2, condition: 'errorType !== "fatal"' }, advisors: [ADVISOR_ON_FAILURE] },
    { id: 'normal-path', title: '正常路径处理', kind: 'phase', phase: 'PLAN', deps: ['risk-assess'], prompt: PROMPT_PREFIX + '正常迁移：制定标准迁移计划。输出 docs/normal-plan.md', retryPolicy: RETRY_ANALYZE },
    { id: 'approve-plan', title: '审批迁移计划', kind: 'human-gate', deps: ['high-risk-path'], approvalPrompt: '请审批高风险迁移计划', fallbackTo: 'high-risk-path' },
    { id: 'execute', title: '执行迁移', kind: 'phase', phase: 'EXECUTE', deps: ['normal-path', 'approve-plan'], prompt: PROMPT_PREFIX + '执行技术栈迁移。完成后提交 git commit', retryPolicy: { maxAttempts: 4, backoff: 'exponential', baseDelayMs: 5000, maxDelayMs: 120000, jitter: 0.15 }, timeoutMs: 60 * 60 * 1000, advisors: [ADVISOR_ON_FAILURE, ADVISOR_ON_GATE_FAIL] },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'review-gate', title: '代码审查', kind: 'gate', gate: 'review', deps: ['test-gate'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['review-gate'], prompt: PROMPT_PREFIX + '迁移完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const UPGRADE_ADV_TEMPLATE: Template = {
  id: 'upgrade-adv',
  name: '小型升级 · 高级',
  description: '【高级】退避重试 + AI 顾问 + 参数化配置',
  kind: 'upgrade',
  entry: 'ingest',
  terminals: ['done'],
  params: [
    { name: 'upgradeScope', type: 'enum', required: false, default: 'dependency', description: '升级范围', enum: ['dependency', 'api', 'framework', 'language'] },
    { name: 'breakingChanges', type: 'boolean', required: false, default: false, description: '是否包含破坏性变更' },
  ],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '分析项目结构和当前依赖版本。输出 docs/ingest.md' },
    { id: 'analyze', title: '分析升级范围', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: PROMPT_PREFIX + '分析需要升级的依赖和影响范围。输出 docs/analysis.md', retryPolicy: RETRY_ANALYZE, advisors: [ADVISOR_AFTER_NODE] },
    { id: 'execute', title: '执行升级', kind: 'phase', phase: 'EXECUTE', deps: ['analyze'], prompt: PROMPT_PREFIX + '执行升级任务。完成后提交 git commit', retryPolicy: { maxAttempts: 3, backoff: 'linear', baseDelayMs: 3000, maxDelayMs: 30000, jitter: 0.1 }, timeoutMs: 20 * 60 * 1000, advisors: [ADVISOR_ON_FAILURE, ADVISOR_ON_GATE_FAIL] },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'review-gate', title: '代码审查', kind: 'gate', gate: 'review', deps: ['test-gate'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['review-gate'], prompt: PROMPT_PREFIX + '升级完成，输出总结报告。输出 docs/summary.md' },
  ],
};

export const HOTFIX_ADV_TEMPLATE: Template = {
  id: 'hotfix-adv',
  name: '紧急修复 · 高级',
  description: '【高级】快速退避重试 + AI 顾问 + 参数化',
  kind: 'hotfix',
  entry: 'ingest',
  terminals: ['done'],
  params: [
    { name: 'severity', type: 'enum', required: false, default: 'medium', description: '严重程度', enum: ['critical', 'high', 'medium', 'low'] },
    { name: 'rollbackOnFail', type: 'boolean', required: false, default: true, description: '失败时自动回滚' },
  ],
  tasks: [
    { id: 'ingest', title: '接入项目', kind: 'phase', phase: 'INGEST', deps: [], prompt: PROMPT_PREFIX + '快速分析项目结构和 bug 上下文。输出 docs/ingest.md' },
    { id: 'analyze', title: '定位 bug', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: PROMPT_PREFIX + '定位 bug 根因。输出 docs/analysis.md', advisors: [ADVISOR_AFTER_NODE] },
    { id: 'execute', title: '执行修复', kind: 'phase', phase: 'EXECUTE', deps: ['analyze'], prompt: PROMPT_PREFIX + '执行 bug 修复。完成后提交 git commit', retryPolicy: RETRY_FAST, timeoutMs: 15 * 60 * 1000, advisors: [ADVISOR_ON_FAILURE, ADVISOR_ON_GATE_FAIL] },
    { id: 'test-gate', title: '测试门禁', kind: 'gate', gate: 'test', deps: ['execute'], fallbackTo: 'execute' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['test-gate'], prompt: PROMPT_PREFIX + '修复完成，输出总结报告。输出 docs/summary.md' },
  ],
};

// ════════════════════════════════════════════════════════════
// 自定义工作流模板（从旧 phases 数组迁移）
// 这些模板对应原 TemplateManagerDialog 中的 6 个简单工作流
// 现统一为 DAG 形式存储，走 orchestrator 引擎执行
// ════════════════════════════════════════════════════════════

const CUSTOM_GREENFIELD: Template = {
  id: 'custom-single-module',
  name: '单模块开发',
  description: 'plan → code → review → test 四阶段线性工作流',
  kind: 'greenfield',
  entry: 'plan',
  terminals: ['test'],
  tasks: [
    { id: 'plan', title: '需求分析', kind: 'phase', phase: 'PLAN', deps: [], model: 'sonnet', prompt: '分析需求文档，输出技术方案和模块划分' },
    { id: 'code', title: '代码实现', kind: 'phase', phase: 'EXECUTE', deps: ['plan'], model: 'sonnet', prompt: '根据技术方案编写完整代码实现' },
    { id: 'review', title: '代码审查', kind: 'phase', phase: 'REVIEW', deps: ['code'], model: 'opus', prompt: '审查代码的正确性、性能、安全性' },
    { id: 'test', title: '测试验证', kind: 'phase', phase: 'TEST', deps: ['review'], model: 'sonnet', prompt: '编写并运行测试用例，确保覆盖率达标' },
  ],
};

const CUSTOM_MULTI_MODULE: Template = {
  id: 'custom-multi-module',
  name: '多模块并行',
  description: '规划 → 并行开发 → 并行审查 → 集成 → 测试',
  kind: 'greenfield',
  entry: 'plan',
  terminals: ['test'],
  tasks: [
    { id: 'plan', title: '模块规划', kind: 'phase', phase: 'PLAN', deps: [], model: 'opus', prompt: '分析需求，拆分模块，定义接口契约' },
    { id: 'code', title: '并行开发', kind: 'phase', phase: 'EXECUTE', deps: ['plan'], model: 'sonnet', prompt: '按模块划分并行实现各功能' },
    { id: 'review', title: '并行审查', kind: 'phase', phase: 'REVIEW', deps: ['code'], model: 'opus', prompt: '并行审查各模块代码' },
    { id: 'integrate', title: '集成合并', kind: 'phase', phase: 'INTEGRATE', deps: ['review'], model: 'opus', prompt: '合并所有模块，解决冲突' },
    { id: 'test', title: '集成测试', kind: 'phase', phase: 'TEST', deps: ['integrate'], model: 'sonnet', prompt: '运行集成测试并修复失败项' },
  ],
};

const CUSTOM_CODE_AUDIT: Template = {
  id: 'custom-code-audit',
  name: '代码审计',
  description: '扫描 → 并行审查 → 报告',
  kind: 'refactor',
  entry: 'scan',
  terminals: ['report'],
  tasks: [
    { id: 'scan', title: '代码扫描', kind: 'phase', phase: 'ANALYZE', deps: [], model: 'sonnet', prompt: '扫描项目所有源代码文件' },
    { id: 'review', title: '并行审查', kind: 'phase', phase: 'REVIEW', deps: ['scan'], model: 'opus', prompt: '按模块并行审查代码安全性和质量' },
    { id: 'report', title: '报告生成', kind: 'phase', phase: 'DONE', deps: ['review'], model: 'sonnet', prompt: '汇总审计结果，生成修复建议报告' },
  ],
};

const CUSTOM_MIGRATION: Template = {
  id: 'custom-migration',
  name: '迁移重构',
  description: '分析 → 转换 → 验证',
  kind: 'migration',
  entry: 'analyze',
  terminals: ['verify'],
  tasks: [
    { id: 'analyze', title: '代码分析', kind: 'phase', phase: 'ANALYZE', deps: [], model: 'opus', prompt: '分析现有代码结构和依赖关系' },
    { id: 'transform', title: '并行转换', kind: 'phase', phase: 'EXECUTE', deps: ['analyze'], model: 'sonnet', prompt: '按模块并行执行代码转换' },
    { id: 'verify', title: '验证测试', kind: 'phase', phase: 'TEST', deps: ['transform'], model: 'sonnet', prompt: '验证转换后代码的正确性和性能' },
  ],
};

const CUSTOM_BUG_SWEEP: Template = {
  id: 'custom-bug-sweep',
  name: 'Bug 批量修复',
  description: '分析 → 修复 → 验证',
  kind: 'hotfix',
  entry: 'analyze',
  terminals: ['verify'],
  tasks: [
    { id: 'analyze', title: 'Bug 分析', kind: 'phase', phase: 'ANALYZE', deps: [], model: 'opus', prompt: '分析项目找出所有潜在 Bug' },
    { id: 'fix', title: '并行修复', kind: 'phase', phase: 'EXECUTE', deps: ['analyze'], model: 'sonnet', prompt: '按模块并行修复 Bug' },
    { id: 'verify', title: '验证确认', kind: 'phase', phase: 'TEST', deps: ['fix'], model: 'sonnet', prompt: '验证修复的正确性' },
  ],
};

const CUSTOM_CI_MONITOR: Template = {
  id: 'custom-ci-monitor',
  name: 'CI 监控',
  description: '循环检查 CI 状态 → 自动修复',
  kind: 'hotfix',
  entry: 'check',
  terminals: ['check'],
  maxIterations: 50,
  tasks: [
    { id: 'check', title: 'CI 检查', kind: 'phase', phase: 'EXECUTE', deps: [], model: 'sonnet', maxAttempts: 5, timeoutMs: 10 * 60 * 1000, prompt: '循环检查 CI 构建状态，失败时自动修复并重试' },
  ],
};

// ════════════════════════════════════════════════════════════
// 多数据库适配模板
// ════════════════════════════════════════════════════════════

const DB_ADAPT_PROMPT_PREFIX = `你是一个资深的全栈开发工程师，专注于数据库适配改造。
请严格遵循以下要求：
1. 不改变任何业务逻辑和功能
2. 只进行数据库适配改造，保持接口不变
3. 输出结构化的 markdown 文档
4. 如果需要修改代码，请明确说明修改位置和原因

项目目标：{goal}
`;

export const DB_ADAPT_TEMPLATE: Template = {
  id: 'db-adapt',
  name: '多数据库适配',
  description: '对现有系统进行多数据库版本适配（MySQL/PostgreSQL/Oracle），不改变业务逻辑',
  kind: 'migration',
  icon: '🗄️',
  entry: 'ingest',
  terminals: ['done'],
  params: [
    { name: 'targetDbs', type: 'enum', required: true, default: 'mysql,pgsql', description: '目标数据库列表', enum: ['mysql', 'pgsql', 'oracle', 'mysql,pgsql', 'mysql,oracle', 'pgsql,oracle', 'all'] },
    { name: 'ormFramework', type: 'enum', required: false, default: 'auto', description: 'ORM 框架', enum: ['auto', 'mybatis', 'mybatis-plus', 'jpa', 'jooq', 'none'] },
    { name: 'multiVersion', type: 'boolean', required: false, default: true, description: '是否多版本并存（同一代码库多mapper）' },
  ],
  tasks: [
    { id: 'ingest', title: '项目接入分析', kind: 'phase', phase: 'INGEST', deps: [], prompt: DB_ADAPT_PROMPT_PREFIX + `
分析现有项目的数据库相关结构：
1. 识别所有 Mapper/DAO/Repository 文件和对应的 XML/SQL 文件
2. 识别数据库连接配置（DataSource、连接池、事务管理器）
3. 识别实体类/Model 中的数据库相关注解
4. 扫描项目中的原生 SQL 语句（硬编码 SQL、存储过程调用等）
5. 识别数据库专属函数/语法（如 MySQL GROUP_CONCAT、PostgreSQL JSON 操作等）
6. 识别所有 SQL 脚本和 Migration 文件
7. 统计 SQL 文件数量和涉及的表数量

输出 docs/ingest.md` },
    { id: 'analyze-sql', title: 'SQL 方言分析', kind: 'phase', phase: 'ANALYZE', deps: ['ingest'], prompt: DB_ADAPT_PROMPT_PREFIX + `
对已识别的 SQL 进行方言兼容性分析：
1. 逐文件标注 SQL 中的数据库专属语法
2. 按兼容性分类：完全兼容 / 需微调 / 需重写
3. 列出所有不兼容的函数、关键字、数据类型
4. 建立 函数映射表（如 MySQL NOW() → PostgreSQL NOW() / Oracle SYSDATE）
5. 标注分页语法差异
6. 标注日期/时间函数差异
7. 标注字符串函数差异
8. 标注聚合函数差异

输出 docs/sql-analysis.md` },
    { id: 'config-design', title: '多数据源配置设计', kind: 'phase', phase: 'ARCHITECT', deps: ['analyze-sql'], prompt: DB_ADAPT_PROMPT_PREFIX + `
设计多数据库配置方案：
1. 设计多环境配置文件结构（application-mysql.yml / application-pgsql.yml / application-oracle.yml）
2. 设计动态数据源切换方案（如有需要）
3. 设计多版本 Mapper 目录结构，例如：
   src/main/resources/mapper/
   ├── mysql/
   │   └── UserMapper.xml
   ├── postgresql/
   │   └── UserMapper.xml
   └── oracle/
       └── UserMapper.xml
4. 配置 MyBatis/ORM 的多环境 mapper-locations
5. 配置连接池（HikariCP/Druid）多数据库参数
6. 配置事务管理器（如需要多库事务）
7. 提供驱动依赖配置（pom.xml / build.gradle）

输出 docs/config-design.md` },
    { id: 'exec-mapper', title: 'Mapper 层适配', kind: 'phase', phase: 'EXECUTE', deps: ['config-design'], model: 'sonnet', prompt: DB_ADAPT_PROMPT_PREFIX + `
对每个 Mapper/XML 文件进行数据库适配改造（不改变业务逻辑）：
1. 为每个现有的 Mapper XML 创建目标数据库版本
2. 替换数据库专属函数/语法（参考函数映射表）
3. 适配分页语法
4. 适配数据类型映射
5. 适配自增主键/序列语法
6. 保持接口方法签名不变
7. 为 MyBatis 注解 SQL 适配多版本
8. 适配 GROUP BY / ORDER BY / LIMIT 等差异

完成后提交 git commit，消息格式："db-adapt: 添加 [数据库名] Mapper 适配"` },
    { id: 'exec-entity', title: '实体层适配', kind: 'phase', phase: 'EXECUTE', deps: ['config-design'], model: 'sonnet', prompt: DB_ADAPT_PROMPT_PREFIX + `
实体层/Model 层数据库适配（不改变业务逻辑）：
1. 适配 JPA/Hibernate 注解（@Table/@Column 等）
2. 适配 MyBatis-Plus @TableName/@TableField
3. 适配序列生成策略（@GeneratedValue）
4. 适配字段类型映射
5. 适配字段默认值
6. 保持 Java/Python 实体类业务逻辑不变

完成后提交 git commit，消息格式："db-adapt: 实体层 [数据库名] 适配"` },
    { id: 'exec-sql', title: 'SQL 脚本适配', kind: 'phase', phase: 'EXECUTE', deps: ['analyze-sql'], model: 'sonnet', prompt: DB_ADAPT_PROMPT_PREFIX + `
适配所有 SQL 脚本和 Migration 文件：
1. 创建目标数据库的初始化脚本
2. 适配 DDL（建表语句中的数据类型、引擎、字符集）
3. 适配 DML（INSERT/UPDATE/DELETE 语法差异）
4. 适配索引创建语法
5. 适配存储过程/函数/触发器
6. 创建对应的 Migration 文件（Flyway/Liquibase）
7. 保持表结构逻辑一致

完成后提交 git commit，消息格式："db-adapt: [数据库名] SQL 脚本适配"` },
    { id: 'exec-config', title: '数据库配置适配', kind: 'phase', phase: 'EXECUTE', deps: ['config-design'], model: 'sonnet', prompt: DB_ADAPT_PROMPT_PREFIX + `
实现多数据库配置切换支持：
1. 创建多环境配置文件
2. 配置数据源（主从/读写分离/多数据源）
3. 配置连接池参数
4. 配置 MyBatis mapper-locations 动态切换
5. 配置事务管理器
6. 配置 JPA/Hibernate 方言
7. 编写配置切换文档

完成后提交 git commit，消息格式："db-adapt: 多数据库配置实现"` },
    { id: 'test-verify', title: '验证测试', kind: 'phase', phase: 'TEST', deps: ['exec-mapper', 'exec-entity', 'exec-sql', 'exec-config'], prompt: DB_ADAPT_PROMPT_PREFIX + `
验证多数据库适配的完整性和正确性：
1. 检查所有 Mapper 接口方法是否都有对应的各数据库版本
2. 检查配置切换逻辑是否完整
3. 检查是否有遗漏的硬编码 SQL
4. 检查实体注解是否完整
5. 验证各数据库的建表脚本是否完整
6. 输出适配清单和测试报告
7. 如果有测试环境，运行集成测试

输出 docs/db-adapt-verify.md` },
    { id: 'review-gate', title: '代码审查', kind: 'gate', gate: 'review', deps: ['test-verify'], fallbackTo: 'test-verify' },
    { id: 'done', title: '完成', kind: 'phase', phase: 'DONE', deps: ['review-gate'], prompt: DB_ADAPT_PROMPT_PREFIX + `
多数据库适配完成，输出总结报告：
1. 适配的数据库列表
2. 适配的文件清单
3. 配置切换说明
4. 已知限制和注意事项
5. 后续维护建议

输出 docs/db-adapt-summary.md` },
  ],
};

// ════════════════════════════════════════════════════════════
// 模板注册（融合版 — 不再区分普通/高级模式）
// ════════════════════════════════════════════════════════════

/**
 * 全部内置模板（已融合普通/高级，统一展示）
 * 包括原 5 个普通 + 5 个高级 + 6 个从 phases 迁移的自定义工作流
 */
export const TEMPLATES: Template[] = [
  // 原 5 个普通模式
  GREENFIELD_TEMPLATE,
  REFACTOR_TEMPLATE,
  MIGRATION_TEMPLATE,
  UPGRADE_TEMPLATE,
  HOTFIX_TEMPLATE,
  // 原 5 个高级模式
  GREENFIELD_ADV_TEMPLATE,
  REFACTOR_ADV_TEMPLATE,
  MIGRATION_ADV_TEMPLATE,
  UPGRADE_ADV_TEMPLATE,
  HOTFIX_ADV_TEMPLATE,
  // 从 phases 迁移的 6 个自定义工作流
  CUSTOM_GREENFIELD,
  CUSTOM_MULTI_MODULE,
  CUSTOM_CODE_AUDIT,
  CUSTOM_MIGRATION,
  CUSTOM_BUG_SWEEP,
  CUSTOM_CI_MONITOR,
  // 多数据库适配
  DB_ADAPT_TEMPLATE,
];

/**
 * @deprecated 旧的双模式分类，仅为兼容保留
 * 新代码请直接使用 TEMPLATES
 */
export const SIMPLE_TEMPLATES: Template[] = [
  GREENFIELD_TEMPLATE,
  REFACTOR_TEMPLATE,
  MIGRATION_TEMPLATE,
  UPGRADE_TEMPLATE,
  HOTFIX_TEMPLATE,
];

/**
 * @deprecated 旧的双模式分类，仅为兼容保留
 * 新代码请直接使用 TEMPLATES
 */
export const ADVANCED_TEMPLATES: Template[] = [
  GREENFIELD_ADV_TEMPLATE,
  REFACTOR_ADV_TEMPLATE,
  MIGRATION_ADV_TEMPLATE,
  UPGRADE_ADV_TEMPLATE,
  HOTFIX_ADV_TEMPLATE,
];

/**
 * @deprecated 模板模式概念已废弃，融合后所有模板统一展示
 * 仅返回值用于兼容旧 UI（如 -adv 后缀判断）
 */
export type TemplateMode = 'simple' | 'advanced';

/** @deprecated */
export function getTemplatesByMode(mode: TemplateMode): Template[] {
  return mode === 'advanced' ? ADVANCED_TEMPLATES : SIMPLE_TEMPLATES;
}

/**
 * 判断模板是否带 v3 高级特性（用于 UI 展示"⚡ 增强"徽章）
 * 注意：此函数不再用于模式切换，仅作信息展示
 */
export function getTemplateMode(id: string): TemplateMode {
  return id.endsWith('-adv') ? 'advanced' : 'simple';
}

/**
 * 判断模板是否包含 v3 高级特性（retryPolicy/advisors/edges/switch/params）
 * 用于 UI 展示"⚡ 增强"徽章（替代旧的 -adv 后缀判断）
 */
export function hasAdvancedFeatures(t: Template): boolean {
  if (t.params && t.params.length > 0) return true;
  if (t.edges && t.edges.length > 0) return true;
  if (t.maxIterations) return true;
  for (const task of t.tasks) {
    if (task.retryPolicy || (task.advisors && task.advisors.length > 0) ||
        task.kind === 'switch' || task.kind === 'harness-call' || task.kind === 'sub-workflow') {
      return true;
    }
  }
  return false;
}

/**
 * 根据 id 获取模板
 */
// ── 自定义模板注册（统一编辑器用）──────────────────────
const customTemplates = new Map<string, Template>();

/**
 * 注册自定义模板（统一编辑器创建的自定义模板通过此接口注册）
 * 注册后可通过 getTemplate(id) 查询到
 */
export function registerCustomTemplate(template: Template): void {
  customTemplates.set(template.id, template);
}

/** 获取所有自定义模板 */
export function getCustomTemplates(): Template[] {
  return Array.from(customTemplates.values());
}

/** 移除自定义模板 */
export function removeCustomTemplate(id: string): boolean {
  return customTemplates.delete(id);
}

export function getTemplate(id: string): Template | null {
  // 先查自定义模板（统一编辑器创建的），再查内置模板
  return customTemplates.get(id) ?? TEMPLATES.find((t) => t.id === id) ?? null;
}
