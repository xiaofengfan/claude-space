export interface SkillTemplate {
  id: string
  name: string
  description: string
  version: string
  author: string
  category: string
  icon: string
  tags: string
  content: string
}

export const SKILL_CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: 'code-review', label: '代码审查', icon: '🔍' },
  { id: 'security', label: '安全', icon: '🛡️' },
  { id: 'conventions', label: '规范', icon: '📏' },
  { id: 'documentation', label: '文档', icon: '📝' },
  { id: 'api-design', label: 'API', icon: '🔌' },
  { id: 'git', label: 'Git', icon: '📦' },
  { id: 'testing', label: '测试', icon: '🧪' },
  { id: 'performance', label: '性能', icon: '⚡' },
]

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'code-review',
    name: '代码审查',
    description: '全面的代码审查检查清单，涵盖逻辑、性能、安全等方面',
    version: '1.0.0', author: 'Claude Space', category: 'code-review', icon: '🔍',
    tags: 'code-review,审查,最佳实践',
    content: `---
name: code-review
description: 全面的代码审查检查清单
version: 1.0.0
author: Claude Space
category: code-review
icon: '🔍'
tags: code-review,审查,最佳实践
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# 代码审查技能

## 功能描述
对 Pull Request 或代码变更进行全面审查，检查逻辑正确性、性能、安全性和代码质量。

## 使用方式
\`\`\`
/code-review [文件路径或PR描述]
\`\`\`

## 审查清单

### 正确性
- 边界条件处理（空值、空数组、0、负数）
- 潜在的 null/undefined 引用
- 错误处理是否完备
- 异步操作是否正确 await

### 可读性
- 变量名和函数名是否清晰
- 复杂逻辑是否有注释
- 函数是否遵循单一职责原则
- 代码复杂度是否可控

### 性能
- 是否有不必要的重复计算
- 循环中是否有可提取的重复操作
- 大数据处理是否有分页或流式处理

### 安全性
- 用户输入是否经过验证和清理
- 敏感信息（密钥、密码）是否硬编码
- 是否存在 SQL 注入、XSS 等常见漏洞
`,
  },
  {
    id: 'security-audit',
    name: '安全审计',
    description: '基于 OWASP Top 10 的安全扫描与审计',
    version: '1.0.0', author: 'Claude Space', category: 'security', icon: '🛡️',
    tags: 'security,owasp,审计,漏洞扫描',
    content: `---
name: security-audit
description: 基于 OWASP Top 10 的安全扫描与审计
version: 1.0.0
author: Claude Space
category: security
icon: '🛡️'
tags: security,owasp,审计,漏洞扫描
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# 安全审计技能

## 功能描述
对代码进行全面的安全检查，基于 OWASP Top 10 标准识别潜在的安全漏洞。

## 使用方式
\`\`\`
/security-audit [目标文件或模块]
\`\`\`

## 检查项

1. **访问控制** - 每个 API 端点是否验证了用户权限？是否存在 IDOR 风险？
2. **加密安全** - 敏感数据传输是否使用 HTTPS/TLS？密码是否使用 bcrypt/argon2？
3. **注入防护** - SQL 查询是否使用参数化？OS 命令是否避免拼接用户输入？
4. **配置安全** - CORS 配置是否合理？错误信息是否暴露过多内部细节？
5. **认证安全** - Session/JWT Token 管理是否安全？是否支持多因素认证？
6. **依赖安全** - 依赖是否有已知 CVE 漏洞？是否定期更新？
`,
  },
  {
    id: 'api-design',
    name: 'API 设计',
    description: 'RESTful API 设计与审查标准',
    version: '1.0.0', author: 'Claude Space', category: 'api-design', icon: '🔌',
    tags: 'api,rest,设计规范',
    content: `---
name: api-design
description: RESTful API 设计与审查标准
version: 1.0.0
author: Claude Space
category: api-design
icon: '🔌'
tags: api,rest,设计规范
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# API 设计技能

## 功能描述
帮助设计和审查 RESTful API，确保符合最佳实践和规范。

## 使用方式
\`\`\`
/api-design [接口描述或需求]
\`\`\`

## 设计规范

### URL 设计
- 使用名词复数：\`/users\`, \`/orders\`
- 层级关系：\`/users/:id/orders\`
- 使用 kebab-case：\`/user-profiles\`
- 避免动词，用 HTTP method 表达操作

### HTTP 方法
| 方法 | 用途 | 示例 |
|------|------|------|
| GET | 获取资源 | GET /users |
| POST | 创建资源 | POST /users |
| PUT | 全量更新 | PUT /users/:id |
| PATCH | 部分更新 | PATCH /users/:id |
| DELETE | 删除资源 | DELETE /users/:id |

### 状态码
- \`200\` 成功 · \`201\` 创建成功 · \`204\` 删除成功
- \`400\` 参数错误 · \`401\` 未认证 · \`403\` 无权限
- \`404\` 不存在 · \`422\` 校验失败 · \`500\` 服务器错误

### 分页
GET /users?page=1&page_size=20&sort=-created_at

### 响应格式
{"code":0, "message":"success", "data":{}, "meta":{page,page_size,total}}
`,
  },
  {
    id: 'ts-expert',
    name: 'TypeScript 专家',
    description: 'TypeScript 类型安全和最佳实践审查',
    version: '1.0.0', author: 'Claude Space', category: 'code-review', icon: '🔷',
    tags: 'typescript,类型安全,ts',
    content: `---
name: ts-expert
description: TypeScript 类型安全和最佳实践审查
version: 1.0.0
author: Claude Space
category: code-review
icon: '🔷'
tags: typescript,类型安全,ts
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# TypeScript 专家技能

## 功能描述
审查 TypeScript 代码的类型安全性，提供类型优化建议。

## 使用方式
\`\`\`
/ts-expert [文件路径]
\`\`\`

## 检查项

### 类型安全
- 避免使用 \`any\`，推荐用 \`unknown\` 替代
- 类型断言 \`as\` 是否有更安全的类型守卫方案
- 泛型约束是否合理

### 最佳实践
- 优先使用 \`interface\` 而非 \`type\`（对象类型）
- 使用 \`readonly\` 标记不可变属性
- 启用 strict 模式
- 避免 \`@ts-ignore\`，使用 \`@ts-expect-error\` 并注释原因
- 使用 const 枚举优化运行时性能
`,
  },
  {
    id: 'test-writer',
    name: '测试编写',
    description: '自动生成单元测试和集成测试',
    version: '1.0.0', author: 'Claude Space', category: 'testing', icon: '🧪',
    tags: '测试,单元测试,jest,覆盖率',
    content: `---
name: test-writer
description: 自动生成单元测试和集成测试
version: 1.0.0
author: Claude Space
category: testing
icon: '🧪'
tags: 测试,单元测试,jest,覆盖率
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# 测试编写技能

## 功能描述
为代码自动生成高质量的单元测试和集成测试用例。

## 使用方式
\`\`\`
/test-writer [文件路径] [框架: jest/vitest]
\`\`\`

## 测试规范

### AAA 模式
- Arrange — 准备测试数据
- Act — 执行被测操作
- Assert — 验证结果

### 测试原则
- 每个测试独立，不依赖其他测试的执行顺序
- 测试应快速执行（单个文件 < 1s）
- 描述性测试名称描述行为而非实现

### 覆盖要求
- 核心业务逻辑 > 80%
- 工具函数 > 90%
- 边界条件全覆盖

### Mock 规范
- 只 mock 外部依赖（API、数据库、文件系统）
- 不 mock 被测模块的内部函数
`,
  },
  {
    id: 'git-manager',
    name: 'Git 工作流',
    description: 'Git 操作与工作流管理助手',
    version: '1.0.0', author: 'Claude Space', category: 'git', icon: '📦',
    tags: 'git,版本控制,工作流',
    content: `---
name: git-manager
description: Git 操作与工作流管理助手
version: 1.0.0
author: Claude Space
category: git
icon: '📦'
tags: git,版本控制,工作流
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# Git 工作流技能

## 功能描述
协助完成 Git 操作和代码提交管理，确保提交信息规范和分支管理合理。

## 使用方式
\`\`\`
/git-manager [操作描述]
\`\`\`

## 提交规范
\`\`\`
<type>(<scope>): <subject>

<body>
\`\`\`

### Type 类型
- feat: 新功能
- fix: 修复 Bug
- docs: 文档
- style: 代码格式
- refactor: 重构
- perf: 性能优化
- test: 测试
- chore: 构建/工具
- ci: CI 配置

### 分支规范
- 功能分支: feature/<name>
- 修复分支: fix/<name>
- 热修复: hotfix/<version>
- 发布分支: release/<version>
`,
  },
  {
    id: 'doc-generator',
    name: '文档生成',
    description: '自动生成项目文档和 API 文档',
    version: '1.0.0', author: 'Claude Space', category: 'documentation', icon: '📝',
    tags: '文档,api文档,readme',
    content: `---
name: doc-generator
description: 自动生成项目文档和 API 文档
version: 1.0.0
author: Claude Space
category: documentation
icon: '📝'
tags: 文档,api文档,readme
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# 文档生成技能

## 功能描述
分析代码结构和注释，自动生成项目文档、API 文档和 README 文件。

## 使用方式
\`\`\`
/doc-generator [目标: readme/api/项目]
\`\`\`

## 输出格式

### README 模板
# 项目名称
> 一句话描述

## 功能特性
- 特性 1
- 特性 2

## 快速开始
\`\`\`bash
git clone <repo-url>
npm install
npm run dev
\`\`\`

### API 文档格式
| 方法 | 路径 | 说明 | 参数 |
|------|------|------|------|
| GET | /api/v1/users | 用户列表 | page, page_size |
`,
  },
  {
    id: 'perf-audit',
    name: '性能审计',
    description: '代码性能分析与优化建议',
    version: '1.0.0', author: 'Claude Space', category: 'performance', icon: '⚡',
    tags: '性能,优化,审计',
    content: `---
name: perf-audit
description: 代码性能分析与优化建议
version: 1.0.0
author: Claude Space
category: performance
icon: '⚡'
tags: 性能,优化,审计
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# 性能审计技能

## 功能描述
分析代码性能瓶颈，提供优化建议，检查常见性能问题。

## 使用方式
\`\`\`
/perf-audit [文件或模块路径]
\`\`\`

## 检查项

### 前端性能
- 不必要的重渲染
- 大列表是否虚拟化
- 图片是否懒加载
- Bundle 大小是否可控
- 是否有内存泄漏

### 后端性能
- N+1 查询问题
- 是否有合适的索引
- 缓存策略是否合理
- 大数据量是否分页
- 是否有慢查询

### 通用
- 不必要的对象创建
- 循环中重复计算
- 大对象深拷贝开销
- 事件监听是否正确清理
`,
  },
  {
    id: 'conventions-check',
    name: '规范检查',
    description: '代码风格和项目规范一致性检查',
    version: '1.0.0', author: 'Claude Space', category: 'conventions', icon: '📏',
    tags: '规范,代码风格,eslint',
    content: `---
name: conventions-check
description: 代码风格和项目规范一致性检查
version: 1.0.0
author: Claude Space
category: conventions
icon: '📏'
tags: 规范,代码风格,eslint
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# 规范检查技能

## 功能描述
检查代码是否符合项目编码规范，包括命名、结构、格式等。

## 使用方式
\`\`\`
/conventions-check [文件路径]
\`\`\`

## 检查项

### 命名规范
- 组件文件使用 PascalCase
- 工具函数使用 camelCase
- 常量使用 UPPER_SNAKE_CASE
- 布尔值使用 is/has/can 前缀

### 项目结构
\`\`\`
src/
├── components/   # UI 组件
├── hooks/        # 自定义 Hooks
├── utils/        # 工具函数
├── types/        # 类型定义
└── constants/    # 常量与配置
\`\`\`

### 代码格式
- 缩进 2 空格
- 单引号
- 行尾分号
- 行宽 100 字符
`,
  },
  {
    id: 'db-designer',
    name: '数据库设计',
    description: '数据库表结构设计与优化建议',
    version: '1.0.0', author: 'Claude Space', category: 'api-design', icon: '🗄️',
    tags: '数据库,表设计,sql',
    content: `---
name: db-designer
description: 数据库表结构设计与优化建议
version: 1.0.0
author: Claude Space
category: api-design
icon: '🗄️'
tags: 数据库,表设计,sql
level: global
enabled: true
created: 2026-06-28
updated: 2026-06-28
---

# 数据库设计技能

## 功能描述
帮助设计和优化数据库表结构，检查 SQL 查询性能。

## 使用方式
\`\`\`
/db-designer [需求描述或表结构]
\`\`\`

## 设计规范

### 表设计
- 每表必须有主键（自增 ID 或 UUID）
- 使用 created_at / updated_at 时间戳
- 合理使用索引（覆盖索引 > 复合索引 > 单列索引）
- 避免过度设计（优先满足当前需求）

### 命名规范
- 表名使用复数 snake_case: users, orders
- 字段使用 snake_case: user_id, created_at
- 关联表: user_roles, order_items

### 索引建议
- WHERE 条件字段建索引
- ORDER BY 字段建索引
- JOIN 关联字段建索引
- 避免在索引列上使用函数
- 复合索引遵循最左前缀原则
`,
  },
]
