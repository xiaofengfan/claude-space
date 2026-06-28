import type { RuleTemplate } from '../types/rules'

export const RULE_CATEGORIES: { id: RuleTemplate['category']; label: string; icon: string }[] = [
  { id: 'code-review',    label: '代码审查', icon: '🔍' },
  { id: 'security',       label: '安全扫描', icon: '🛡️' },
  { id: 'conventions',    label: '项目规范', icon: '📏' },
  { id: 'documentation',  label: '文档标准', icon: '📝' },
  { id: 'api-design',     label: 'API设计', icon: '🔌' },
  { id: 'git',            label: 'Git提交', icon: '📦' },
  { id: 'testing',        label: '测试规范', icon: '🧪' },
]

export const RULE_TEMPLATES: RuleTemplate[] = [
  // ── 代码审查 ──────────────────────────────────────
  {
    id: 'code-review-standard',
    name: '标准代码审查规则',
    category: 'code-review',
    description: '通用代码审查检查清单，涵盖逻辑、性能、安全等方面',
    content: `# 代码审查规则

## 审查原则
- 每次 PR 至少需要 1 位审查人
- 审查重点优先级：正确性 > 可读性 > 性能 > 风格

## 必检项

### 正确性
- [ ] 逻辑是否正确处理了边界条件（空值、空数组、0、负数等）
- [ ] 是否有潜在的 null/undefined 引用
- [ ] 错误处理是否完备（try-catch、错误返回值）
- [ ] 异步操作是否正确 await，Promise 是否正确链式调用

### 可读性
- [ ] 变量名和函数名是否清晰表达意图
- [ ] 复杂逻辑是否有注释说明
- [ ] 函数是否遵循单一职责原则

### 性能
- [ ] 是否有不必要的重复计算或重复请求
- [ ] 循环中是否有可提取的重复操作
- [ ] 大数据处理是否有分页或流式处理

### 安全性
- [ ] 用户输入是否经过验证和清理
- [ ] 敏感信息（密钥、密码）是否硬编码
- [ ] 是否存在 SQL 注入、XSS 等常见漏洞

## 审查流程
1. 查看 PR 描述，理解改动意图
2. 逐文件审查，关注逻辑变更
3. 拉取代码本地运行验证
4. 提交审查意见，标注严重程度
`,
  },
  {
    id: 'code-review-typescript',
    name: 'TypeScript 审查规则',
    category: 'code-review',
    description: 'TypeScript 专项审查规则，关注类型安全和最佳实践',
    content: `# TypeScript 代码审查规则

## 类型安全
- [ ] 避免使用 \`any\`，必要时使用 \`unknown\` 替代
- [ ] 类型断言 \`as\` 是否合理，是否有更安全的类型守卫
- [ ] 泛型使用是否恰当，是否有不必要的类型约束

## 最佳实践
- [ ] 优先使用 \`interface\` 而非 \`type\`（对象类型）
- [ ] 使用 \`readonly\` 标记不可变属性
- [ ] 使用 \`const\` 断言和 \`as const\` 优化字面量类型推断
- [ ] 启用 strict 模式并处理所有严格检查
- [ ] 避免 \`@ts-ignore\`，使用 \`@ts-expect-error\` 并注释原因
`,
  },

  // ── 安全扫描 ──────────────────────────────────────
  {
    id: 'security-owasp',
    name: 'OWASP Top 10 安全检查',
    category: 'security',
    description: '基于 OWASP Top 10 的安全扫描检查清单',
    content: `# OWASP Top 10 安全检查规则

## 1. 访问控制失效
- [ ] 每个 API 端点是否验证了用户权限
- [ ] 是否存在越权访问（IDOR）风险

## 2. 加密失效
- [ ] 敏感数据传输是否使用 HTTPS/TLS
- [ ] 密码是否使用 bcrypt/argon2 等安全哈希
- [ ] 密钥是否妥善管理，不硬编码

## 3. 注入攻击
- [ ] SQL 查询是否使用参数化查询或 ORM
- [ ] OS 命令是否避免拼接用户输入
- [ ] NoSQL 查询是否防范注入

## 4. 不安全设计
- [ ] 是否有速率限制防止暴力破解
- [ ] 是否有输入验证层

## 5. 安全配置错误
- [ ] 默认账号密码是否已修改
- [ ] 错误信息是否暴露过多内部细节
- [ ] CORS 配置是否合理

## 6. 易受攻击的组件
- [ ] 依赖是否有已知 CVE 漏洞
- [ ] 是否定期更新依赖版本

## 7. 认证失效
- [ ] Session/JWT Token 管理是否安全
- [ ] 是否支持多因素认证

## 8. 软件与数据完整性
- [ ] CI/CD 流水线是否安全
- [ ] 第三方库是否经过审查

## 9. 日志与监控
- [ ] 安全事件是否记录日志
- [ ] 异常访问是否触发告警

## 10. SSRF
- [ ] 用户提供的 URL 是否经过验证
- [ ] 是否限制内部网络的访问
`,
  },
  {
    id: 'security-dependencies',
    name: '依赖安全扫描规则',
    category: 'security',
    description: 'NPM/PIP 等依赖包的漏洞扫描与审计规则',
    content: `# 依赖安全扫描规则

## 定期审计
- [ ] 每次发布前运行 \`npm audit\` / \`pip audit\`
- [ ] 每周自动扫描依赖漏洞（CI 定时任务）
- [ ] Critical/High 漏洞必须在 24 小时内修复

## 依赖管理
- [ ] 锁定依赖版本（package-lock.json / yarn.lock）
- [ ] 限制直接依赖数量，减少攻击面
- [ ] 禁止使用已废弃（deprecated）的包

## 供应链安全
- [ ] 验证包来源（npm registry、GitHub 仓库）
- [ ] 检查包的维护频率和社区活跃度
- [ ] 使用 \`--ignore-scripts\` 安装不受信任的包
`,
  },

  // ── 项目规范 ──────────────────────────────────────
  {
    id: 'conventions-coding',
    name: '项目编码规范',
    category: 'conventions',
    description: '统一的编码风格和项目结构约定',
    content: `# 项目编码规范

## 文件命名
- 组件文件使用 PascalCase：\`UserProfile.tsx\`
- 工具函数使用 camelCase：\`formatDate.ts\`
- 常量文件使用 camelCase：\`appConfig.ts\`
- 样式文件与组件同名：\`UserProfile.css\`

## 目录结构
\`\`\`
src/
├── components/   # UI 组件
├── hooks/        # 自定义 Hooks
├── utils/        # 工具函数
├── types/        # TypeScript 类型定义
├── constants/    # 常量与配置
└── assets/       # 静态资源
\`\`\`

## 代码格式
- 使用 Prettier 统一格式化
- 缩进：2 空格
- 引号：单引号
- 行尾分号：必须
- 行宽：100 字符

## 注释规范
- 公共 API 使用 JSDoc 注释
- 复杂逻辑使用行注释解释意图
- TODO/FIXME 需要关联 Issue 编号
`,
  },
  {
    id: 'conventions-naming',
    name: '命名约定',
    category: 'conventions',
    description: '变量、函数、类的命名规范',
    content: `# 命名约定

## 通用规则
- 使用有意义的英文单词，避免缩写（除非是通用缩写如 id、url、api）
- 布尔值使用 is/has/can/should 前缀：\`isLoading\`, \`hasError\`, \`canEdit\`
- 数组使用名词复数：\`users\`, \`items\`

## 函数命名
- 获取数据：\`get*\`, \`fetch*\`, \`load*\`
- 设置数据：\`set*\`, \`update*\`
- 事件处理：\`handle*\`, \`on*\`
- 创建对象：\`create*\`, \`build*\`, \`make*\`
- 转换数据：\`to*\`, \`from*\`, \`parse*\`, \`format*\`
- 验证检查：\`is*\`, \`validate*\`, \`check*\`, \`has*\`

## 组件命名
- React 组件使用 PascalCase，名称描述 UI 功能
- 页面组件加 Page 后缀：\`LoginPage\`
- 高阶组件加 With 前缀：\`withAuth\`
`,
  },

  // ── 文档标准 ──────────────────────────────────────
  {
    id: 'docs-api',
    name: 'API 文档规范',
    category: 'documentation',
    description: 'RESTful/GraphQL API 文档编写标准',
    content: `# API 文档规范

## 接口描述格式

### 基本信息
- **接口名称**：简短描述功能
- **请求路径**：\`GET /api/v1/users/:id\`
- **权限要求**：需要什么角色/权限

### 请求参数
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | string | 是 | 用户ID |

### 响应示例
\`\`\`json
{
  "code": 0,
  "message": "success",
  "data": { "id": "1", "name": "test" }
}
\`\`\`

### 错误码
| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 1001 | 参数错误 |
| 1002 | 未授权 |

## 文档更新要求
- 接口变更必须同步更新文档
- 废弃接口标注 @deprecated 和替代方案
- 文档版本与 API 版本保持一致
`,
  },
  {
    id: 'docs-readme',
    name: 'README 模板',
    category: 'documentation',
    description: '标准 README.md 结构模板',
    content: `# 项目名称

> 一句话描述项目

## 功能特性
- 特性 1
- 特性 2

## 快速开始

### 环境要求
- Node.js >= 18
- npm >= 9

### 安装
\`\`\`bash
git clone <repo-url>
cd project
npm install
\`\`\`

### 运行
\`\`\`bash
npm run dev      # 开发模式
npm run build    # 构建
npm run test     # 测试
\`\`\`

## 项目结构
\`\`\`
src/
├── components/
├── pages/
└── utils/
\`\`\`

## 技术栈
- React 18
- TypeScript
- Vite

## 贡献指南
1. Fork 项目
2. 创建功能分支
3. 提交 PR
`,
  },

  // ── API设计 ───────────────────────────────────────
  {
    id: 'api-restful',
    name: 'RESTful API 设计规范',
    category: 'api-design',
    description: 'RESTful 接口设计标准与最佳实践',
    content: `# RESTful API 设计规范

## URL 设计
- 使用名词复数：\`/users\`, \`/orders\`
- 层级关系：\`/users/:id/orders\`
- 使用 kebab-case：\`/user-profiles\`
- 避免动词：用 HTTP method 表达操作

## HTTP 方法
| 方法 | 用途 | 示例 |
|------|------|------|
| GET | 获取资源 | \`GET /users\`, \`GET /users/:id\` |
| POST | 创建资源 | \`POST /users\` |
| PUT | 全量更新 | \`PUT /users/:id\` |
| PATCH | 部分更新 | \`PATCH /users/:id\` |
| DELETE | 删除资源 | \`DELETE /users/:id\` |

## 状态码
- \`200\` 成功
- \`201\` 创建成功
- \`204\` 删除成功（无内容返回）
- \`400\` 请求参数错误
- \`401\` 未认证
- \`403\` 无权限
- \`404\` 资源不存在
- \`422\` 参数校验失败
- \`500\` 服务器错误

## 分页
\`\`\`
GET /users?page=1&page_size=20&sort=-created_at
\`\`\`

## 响应格式
\`\`\`json
{
  "code": 0,
  "message": "success",
  "data": {},
  "meta": { "page": 1, "page_size": 20, "total": 100 }
}
\`\`\`
`,
  },
  {
    id: 'api-error-handling',
    name: 'API 错误处理规范',
    category: 'api-design',
    description: '统一错误码和异常处理标准',
    content: `# API 错误处理规范

## 错误响应格式
\`\`\`json
{
  "code": 1001,
  "message": "参数校验失败",
  "details": [
    { "field": "email", "message": "邮箱格式不正确" }
  ],
  "requestId": "req_abc123"
}
\`\`\`

## 错误码分类
| 范围 | 类别 | 示例 |
|------|------|------|
| 0 | 成功 | 正常返回 |
| 1000-1999 | 参数错误 | 缺少必填项、格式错误 |
| 2000-2999 | 认证授权 | 未登录、无权限 |
| 3000-3999 | 业务错误 | 资源不存在、状态不允许 |
| 5000-5999 | 服务端错误 | 数据库异常、第三方超时 |

## 异常处理
- 统一异常处理中间件
- 生产环境不暴露堆栈信息
- 记录 \`requestId\` 便于日志追踪
`,
  },

  // ── Git提交 ───────────────────────────────────────
  {
    id: 'git-conventional-commits',
    name: 'Conventional Commits 规范',
    category: 'git',
    description: '约定式提交信息格式规范',
    content: `# Conventional Commits 规范

## 提交格式
\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`

## Type 类型
| Type | 说明 |
|------|------|
| \`feat\` | 新功能 |
| \`fix\` | 修复 Bug |
| \`docs\` | 文档更新 |
| \`style\` | 代码格式（不影响功能） |
| \`refactor\` | 重构（非新功能非修复） |
| \`perf\` | 性能优化 |
| \`test\` | 测试相关 |
| \`chore\` | 构建/工具/依赖 |
| \`ci\` | CI 配置 |

## 示例
\`\`\`
feat(auth): 添加 OAuth2 登录支持

实现了 GitHub 和 Google OAuth2 登录流程，
包括 token 刷新和 session 管理。

Closes #123
\`\`\`

## 规则
- subject 使用中文或英文，不超过 50 字符
- body 每行不超过 72 字符
- 破坏性变更在 footer 标注 \`BREAKING CHANGE:\`
`,
  },
  {
    id: 'git-branch',
    name: 'Git 分支管理规范',
    category: 'git',
    description: 'Git Flow 分支策略和命名约定',
    content: `# Git 分支管理规范

## 分支模型（简化 Git Flow）

### 主要分支
- \`master\` / \`main\`：生产环境，只接受 merge
- \`develop\`：开发主线，功能分支从这里拉取

### 临时分支
| 分支类型 | 命名格式 | 用途 |
|----------|----------|------|
| 功能分支 | \`feature/<name>\` | 新功能开发 |
| 修复分支 | \`fix/<name>\` | Bug 修复 |
| 热修复 | \`hotfix/<version>\` | 紧急线上修复 |
| 发布分支 | \`release/<version>\` | 发布准备 |

## 分支生命周期
1. 从 \`develop\` 创建 \`feature/xxx\`
2. 开发完成后提 PR 到 \`develop\`
3. 代码审查通过后合并
4. 删除功能分支

## 合并策略
- 功能分支：Squash Merge
- 发布分支：Merge Commit
- 禁止直接 push 到 master/develop
`,
  },

  // ── 测试规范 ──────────────────────────────────────
  {
    id: 'testing-unit',
    name: '单元测试规范',
    category: 'testing',
    description: '单元测试编写标准和覆盖率要求',
    content: `# 单元测试规范

## 测试原则
- 每个测试用例应该独立，不依赖其他测试的执行顺序
- 测试应该快速执行（单个文件 < 1 秒）
- 使用描述性的测试名称，描述被测行为而非实现

## 测试结构（AAA 模式）
\`\`\`
// Arrange — 准备测试数据
// Act — 执行被测操作
// Assert — 验证结果
\`\`\`

## 测试命名
\`\`\`
describe('UserService', () => {
  it('should return user when valid id provided', () => {})
  it('should throw error when user not found', () => {})
  it('should create user with valid input', () => {})
})
\`\`\`

## 覆盖要求
- 核心业务逻辑：> 80%
- 工具函数：> 90%
- UI 组件：> 60%

## Mock 规范
- 只 mock 外部依赖（API、数据库、文件系统）
- 不 mock 被测模块的内部函数
`,
  },
  {
    id: 'testing-e2e',
    name: 'E2E 测试规范',
    category: 'testing',
    description: '端到端测试场景设计和实施指南',
    content: `# E2E 测试规范

## 测试范围
- 核心用户流程（Critical Path）
- 登录/注册流程
- 主要 CRUD 操作
- 权限验证

## 测试设计
- 每个 E2E 测试对应一个用户故事
- 使用 Page Object 模式封装页面操作
- 测试数据独立，每次运行前重置

## 稳定性要求
- E2E 测试失败率 < 5%
- 失败时提供截图和日志
- 超时设置合理（默认 30s，长操作适当延长）

## 执行策略
- PR 提交时运行核心流程（< 10 分钟）
- 每日定时运行全量测试
- 发布前必须全部通过
`,
  },
]
