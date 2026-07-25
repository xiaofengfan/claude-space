/**
 * 知识图谱 AI 分析 Prompt 模板
 * 通过 Chat/Terminal 发送给 Claude，让 AI 分析项目并产出结构化图谱数据
 *
 * 模板分两类：
 * - 内置（builtin: true）：只读，定义于此文件，作为出厂默认
 * - 自定义（builtin: false）：用户可在统一模板管理对话框中编辑，按项目持久化
 */

export interface GraphPrompt {
  id: string
  label: string
  icon: string
  description: string
  /** 发送给 Claude 的系统级分析指令 */
  systemPrompt: string
  /** 是否内置模板（内置不可删除/改 id，可"另存为自定义"） */
  builtin?: boolean
}

export const GRAPH_PROMPTS: GraphPrompt[] = [
  {
    id: 'overview',
    label: '项目全景分析',
    icon: '🔭',
    description: '分析项目整体架构、技术栈、核心业务模块和分层架构',
    builtin: true,
    systemPrompt: `你是项目架构分析师。请分析当前项目的整体架构，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "模块名（有意义的业务概念名）",
      "type": "module",
      "description": "该模块的职责和核心能力说明（50字以内）",
      "tags": ["business"],
      "filePath": "对应的顶层源码目录路径（不要文件名，只到目录层）",
      "metadata": {
        "archLayer": "entry|router|controller|view|service|domain|manager|workflow",
        "dataLayer": "entity|repository|dao|schema|datasource",
        "moduleType": "core|business|infra|integration|common",
        "features": ["子功能1", "子功能2"]
      }
    }
  ],
  "relations": [
    { "source": "实体名", "target": "实体名", "type": "depends_on|contains|calls|references", "label": "关系说明（10字内）" }
  ]
}

重要要求：
1. 只输出业务功能模块（业务概念层），不要输出单个类、文件、函数或目录
2. 模块命名必须是业务含义，如：用户管理、权限管理、报表服务，而非 UserController、UserService 这样的类名
3. 每个模块必须有 filePath 指向对应源码目录（如 src/main/java/com/xx/modules/system）
4. 正确标注分层信息：
   - archLayer：entry(入口) / router(路由) / controller(控制器) / view(视图) / service(服务层) / domain(领域层) / manager(管理) / workflow(流程)
   - dataLayer：entity(实体) / repository(仓储) / dao(数据访问) / schema(表结构) / datasource(数据源)
   - moduleType：core(核心) / business(业务) / infra(基础设施) / integration(集成) / common(通用)
5. 同一模块不要拆分到多个实体中（避免重复）
6. 关系用具体类型标注：calls(调用) / depends_on(依赖) / contains(包含) / references(引用)
7. 如果项目规模很大，只输出最重要的 15-30 个核心模块
仅输出 JSON。`,
  },
  {
    id: 'modules',
    label: '业务模块分析',
    icon: '🧩',
    description: '识别系统功能模块（系统管理、报表管理、流程管理等）及对应代码包',
    builtin: true,
    systemPrompt: `你是业务架构分析师。请分析当前项目的业务功能模块，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "业务功能模块名（如：系统管理）",
      "type": "module",
      "description": "该模块的业务职责说明（30字内）",
      "tags": ["business"],
      "filePath": "对应的顶层包/目录路径（只到目录层，不含文件名）",
      "metadata": {
        "packageName": "对应的 Java 包名或 npm 包名",
        "moduleType": "core|business|infra|integration|common",
        "features": ["子功能1", "子功能2", "子功能3"]
      }
    }
  ],
  "relations": [
    { "source": "业务模块名", "target": "业务模块名", "type": "depends_on|calls|contains", "label": "关系说明" }
  ]
}

分析要求：
1. 聚焦业务功能视角，按以下分类识别：
   - 核心业务模块：系统管理、用户管理、权限管理、角色管理、组织架构、字典管理、系统配置等
   - 业务操作模块：订单管理、客户管理、产品管理、报表管理、流程管理、审批管理、任务管理等
   - 集成模块：消息通知、邮件服务、短信服务、文件管理、支付集成、第三方对接等
   - 基础设施模块：日志服务、缓存管理、配置中心、数据源管理、连接池管理、监控告警等
2. 每个业务模块必须标注对应的代码包/目录（filePath）和包名（metadata.packageName）
3. 对每个模块列出其子功能（metadata.features），如"用户管理"包含：用户创建、用户查询、用户授权
4. 描述模块间的业务依赖和调用关系
5. 模块类型标注：core=核心业务 / business=业务功能 / infra=基础设施 / integration=集成 / common=通用
6. 不要列出单个类/文件/函数，聚焦业务功能粒度
7. 如果项目有多个子模块，按子模块分组输出
仅输出 JSON。`,
  },
  {
    id: 'app-arch',
    label: '应用架构分析',
    icon: '🖥️',
    description: '分析应用入口、路由、控制器、视图层结构',
    builtin: true,
    systemPrompt: `请分析当前项目的应用架构，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "入口名/路由名/控制器名/视图名",
      "type": "module",
      "description": "职责说明（20字内）",
      "tags": ["application"],
      "filePath": "对应文件/目录路径",
      "metadata": {
        "archLayer": "entry|router|controller|view",
        "framework": "Spring MVC|Express|Vue|React 等",
        "endpoints": ["暴露的端点列表（如 /api/users）"],
        "routeCount": 0
      }
    }
  ],
  "relations": [
    { "source": "入口名", "target": "路由名", "type": "registers", "label": "注册" },
    { "source": "路由名", "target": "控制器名", "type": "maps_to", "label": "映射" },
    { "source": "控制器名", "target": "视图名", "type": "renders", "label": "渲染" }
  ]
}

分析要求：
1. 识别应用入口（Application.java / main.ts / index.js / app.js）
2. 识别路由层（Router/Route 配置、@RequestMapping 等）
3. 识别控制器层（Controller 类及其端点）
4. 识别视图层（View/Page/Component 模板）
5. 标注每个节点所属的应用子层（entry/router/controller/view）
6. 描述从入口→路由→控制器→视图的调用链
7. 标注使用的框架（Spring MVC/Express/Vue/React 等）
8. 聚焦应用层结构，不要分析数据库/业务逻辑细节
仅输出 JSON。`,
  },
  {
    id: 'data-arch',
    label: '数据架构分析',
    icon: '🗄️',
    description: '分析数据模型、实体关系、DAO/Repository 结构',
    builtin: true,
    systemPrompt: `请分析当前项目的数据架构，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "实体名/表名/DAO名",
      "type": "module",
      "description": "数据职责说明（20字内）",
      "tags": ["data"],
      "filePath": "对应文件路径",
      "metadata": {
        "dataLayer": "entity|repository|dao|schema|datasource",
        "tableName": "数据库表名（如有）",
        "fields": [
          { "name": "字段名", "type": "字段类型", "nullable": false, "comment": "字段说明" }
        ],
        "ormFramework": "MyBatis|JPA|Hibernate|TypeORM|Prisma 等",
        "relations": ["与其他实体的关系说明"]
      }
    }
  ],
  "relations": [
    { "source": "EntityA", "target": "EntityB", "type": "references|composes|extends", "label": "关系说明（如：用户 belongs_to 角色）" },
    { "source": "ServiceName", "target": "RepositoryName", "type": "uses", "label": "使用" },
    { "source": "RepositoryName", "target": "EntityName", "type": "manages", "label": "管理" }
  ]
}

分析要求：
1. 识别所有数据实体（Entity/Model/POJO/Schema）
2. 标注每个实体的字段（名称、类型、是否可空、说明）
3. 识别数据访问层（DAO/Repository/Mapper）
4. 标注 ORM 框架（MyBatis/JPA/Hibernate/TypeORM/Prisma 等）
5. 分析实体间关系（一对多/多对多/外键引用等）
6. 识别数据库表结构和命名
7. 标注数据源配置（DataSource/连接池）
8. 聚焦数据层结构，不要分析控制器/视图细节
仅输出 JSON。`,
  },
  {
    id: 'functional-modules',
    label: '功能模块识别（推荐）',
    icon: '🏗️',
    description: '⚡ 推荐：全面识别项目的功能模块（非目录/文件粒度），只输出业务概念级模块',
    builtin: true,
    systemPrompt: `你是业务架构分析师。请全面识别当前项目的功能模块。**只输出业务功能概念**，不要输出任何类名、文件名、函数名或目录结构。

按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "功能模块名（业务概念名，如：用户管理、报表引擎、消息推送等）",
      "type": "module",
      "description": "该模块的业务职责和核心能力说明（30字内）",
      "tags": ["business", "feature"],
      "filePath": "该功能模块对应的顶层源码目录（只到目录，不含文件名）",
      "metadata": {
        "moduleType": "core|business|infra|integration|common",
        "archLayer": "service|domain|manager|workflow",
        "features": ["子功能1", "子功能2"]
      }
    }
  ],
  "relations": [
    { "source": "模块A", "target": "模块B", "type": "depends_on|calls|contains|references", "label": "关系说明" }
  ]
}

分析要求：
1. 识别项目的功能模块（业务功能视角），不要输出任何类/文件/函数：
   - 核心业务模块：用户管理、权限管理、角色管理、组织架构、字典管理、系统配置等
   - 业务操作模块：订单管理、客户管理、产品管理、报表管理、流程管理、审批管理、任务管理等
   - 集成模块：消息通知、邮件服务、短信服务、文件管理、支付集成、第三方对接等
   - 基础设施模块：日志服务、缓存管理、配置中心、数据源管理、连接池管理、监控告警等
2. 每个功能模块必须有清晰的业务含义描述（description），而非代码结构描述
3. 列出每个模块包含的子功能（features）
4. 标注每个模块的类型（moduleType）：core=核心基础 / business=业务功能 / infra=基础设施 / integration=外部集成
5. 标注每个模块的应用层（archLayer）：service=服务层 / domain=领域层 / manager=管理层 / workflow=流程层
6. 标注模块对应的顶层源码目录（filePath），方便后续关联代码
7. 描述模块间的业务依赖和调用关系
8. 每个功能模块的输出应该是一个有意义的业务概念，而非技术组件名
9. 不要输出任何单个类、文件、函数或目录结构信息
10. 总实体数控制在 10-30 个
仅输出 JSON。`,
  },
  {
    id: 'project-change',
    label: '项目变更分析 & 图谱更新',
    icon: '🔄',
    description: '分析项目最近变更内容，对比现有图谱，标记新增/修改/废弃的模块和关系',
    builtin: true,
    systemPrompt: `请分析当前项目的内容和结构，与图谱中已有数据进行对比，识别新增、变更和废弃的功能模块。按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "新增或需要更新的功能模块名",
      "type": "module",
      "description": "模块的业务职责说明（30字内）",
      "tags": ["business", "feature", "updated"],
      "filePath": "对应的顶层源码路径（只到目录层）",
      "metadata": {
        "moduleType": "core|business|infra|integration|common",
        "archLayer": "service|domain|manager|workflow",
        "features": ["子功能列表"],
        "changeType": "new|updated|deprecated|unchanged",
        "changeSummary": "变更摘要说明（新增了什么功能、修改了什么结构等）"
      }
    }
  ],
  "relations": [
    { "source": "模块A", "target": "模块B", "type": "depends_on|calls|references|contains", "label": "关系说明" }
  ]
}

分析要求：
1. 按功能模块（非目录/文件粒度）分析当前项目源码，识别出所有有意义的业务功能模块
2. 与图谱中已有 entities 进行对比（同一个功能模块名视为同一个模块）：
   - 如果功能模块是新增的（图谱中没有），mark metadata.changeType 为 "new"，tags 包含 "new"
   - 如果功能模块在图谱中已存在但内容/结构有变化，mark changeType 为 "updated"，tags 包含 "updated"
   - 如果功能模块在图谱中已存在且没有变化，mark changeType 为 "unchanged"（这些可不输出，节省 token）
   - 如果功能模块在图谱中但源码中已不存在或废弃，mark changeType 为 "deprecated"，tags 包含 "deprecated"
3. changeSummary 字段必须说明具体的变化内容（新增了什么子功能、修改了什么、删除了什么）
4. 每个模块必须标注对应的 filePath（源码目录），方便后续关联
5. 只输出有变化的实体（new/updated/deprecated），不变的可省略
6. 更新模块间的依赖关系，识别新增或变更的依赖
7. 聚焦功能业务维度，不要输出目录结构或单个文件/类
仅输出 JSON。`,
  },
  {
    id: 'db-doc',
    label: '数据库设计文档生成',
    icon: '📄',
    description: '生成数据库设计文档：表结构、字段、关系、索引',
    builtin: true,
    systemPrompt: `请分析当前项目并生成数据库设计文档，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "表名/实体名",
      "type": "module",
      "description": "表的业务含义说明",
      "tags": ["database", "table"],
      "filePath": "实体类文件路径",
      "metadata": {
        "tableName": "实际数据库表名",
        "engine": "InnoDB|MyISAM 等",
        "charset": "utf8mb4 等",
        "comment": "表注释",
        "fields": [
          {
            "name": "字段名",
            "type": "varchar(255)|int|datetime|text 等",
            "nullable": false,
            "default": "默认值",
            "primaryKey": false,
            "unique": false,
            "index": false,
            "comment": "字段注释说明"
          }
        ],
        "indexes": [
          { "name": "索引名", "fields": ["字段名"], "type": "unique|normal|primary", "comment": "索引说明" }
        ],
        "relations": [
          { "target": "关联表名", "type": "one_to_many|many_to_one|many_to_many|one_to_one", "foreignKey": "外键字段", "comment": "关系说明" }
        ]
      }
    }
  ],
  "relations": [
    { "source": "表A", "target": "表B", "type": "references|composes", "label": "外键关系：表A.字段 → 表B.字段" }
  ]
}

分析要求：
1. 识别所有数据库表（通过 Entity/Model/SQL 脚本/Migration）
2. 为每张表生成完整字段清单（名称、类型、长度、是否可空、默认值、注释）
3. 标注主键、唯一键、索引
4. 识别表间外键关系（一对多/多对多等）
5. 标注表的字符集和引擎（如能识别）
6. 为每张表和字段添加业务含义注释
7. 生成可直接用于文档的关系图数据
8. 如有 SQL 脚本/Migration 文件，优先从中提取精确信息
仅输出 JSON。`,
  },
  {
    id: 'dataflow',
    label: '数据流分析',
    icon: '🌊',
    description: '追踪数据流向：API → Service → DB，标注数据模型',
    builtin: true,
    systemPrompt: `请分析当前项目的数据流，按以下 JSON 格式输出：

{
  "entities": [
    { "name": "数据模型/API/服务名", "type": "module", "description": "数据职责", "tags": ["data"] }
  ],
  "relations": [
    { "source": "EntityA", "target": "EntityB", "type": "depends_on|calls|references|composes|uses", "label": "数据流动说明" }
  ]
}

要求：
1. 识别数据模型（Models/Entities/Schema）
2. 追踪 API 请求 → Service 层 → 数据库的完整链路
3. 标注数据转换点（DTO/DAO）
4. 识别 ORM 关系和外键依赖
仅输出 JSON。`,
  },
  {
    id: 'api-routes',
    label: 'API 路由分析',
    icon: '🔗',
    description: '提取所有 API 路由、请求方式、参数和响应',
    builtin: true,
    systemPrompt: `请分析当前项目的所有 API 路由，按以下 JSON 格式输出：

{
  "entities": [
    { "name": "/api/xxx", "type": "module", "description": "GET 获取用户列表", "tags": ["GET","user"], "metadata": { "method": "GET", "path": "/api/xxx" } }
  ],
  "relations": [
    { "source": "/api/xxx", "target": "ControllerName", "type": "defines", "label": "定义" },
    { "source": "ControllerName", "target": "ServiceName", "type": "calls", "label": "调用" }
  ]
}

要求：
1. 提取所有路由定义
2. 标注 HTTP 方法、路径、参数
3. 描述路由→Controller→Service 的调用链
仅输出 JSON。`,
  },
  {
    id: 'app-arch',
    label: '应用架构分析',
    icon: '🖥️',
    description: '分析应用入口、路由、控制器、视图层结构',
    builtin: true,
    systemPrompt: `请分析当前项目的应用架构，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "应用入口/路由/控制器/视图名",
      "type": "api|module|class",
      "description": "职责说明",
      "tags": ["application"],
      "filePath": "对应文件/目录路径",
      "metadata": {
        "archLayer": "entry|router|controller|view",
        "framework": "Spring MVC|Express|Vue|React 等",
        "endpoints": ["暴露的端点列表（如 /api/users）"],
        "routeCount": 0
      }
    }
  ],
  "relations": [
    { "source": "入口名", "target": "路由名", "type": "registers", "label": "注册" },
    { "source": "路由名", "target": "控制器名", "type": "maps_to", "label": "映射" },
    { "source": "控制器名", "target": "视图名", "type": "renders", "label": "渲染" }
  ]
}

分析要求：
1. 识别应用入口（Application.java / main.ts / index.js / app.js）
2. 识别路由层（Router/Route 配置、@RequestMapping 等）
3. 识别控制器层（Controller 类及其端点）
4. 识别视图层（View/Page/Component 模板）
5. 标注每个节点所属的应用子层（entry/router/controller/view）
6. 描述从入口→路由→控制器→视图的调用链
7. 标注使用的框架（Spring MVC/Express/Vue/React 等）
8. 聚焦应用层结构，不要分析数据库/业务逻辑细节
仅输出 JSON。`,
  },
  {
    id: 'data-arch',
    label: '数据架构分析',
    icon: '🗄️',
    description: '分析数据模型、实体关系、DAO/Repository 结构',
    builtin: true,
    systemPrompt: `请分析当前项目的数据架构，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "实体/表/DAO名",
      "type": "database|class|module",
      "description": "数据职责说明",
      "tags": ["data"],
      "filePath": "对应文件路径",
      "metadata": {
        "dataLayer": "entity|repository|dao|schema|datasource",
        "tableName": "数据库表名（如有）",
        "fields": [
          { "name": "字段名", "type": "字段类型", "nullable": false, "comment": "字段说明" }
        ],
        "ormFramework": "MyBatis|JPA|Hibernate|TypeORM|Prisma 等",
        "relations": ["与其他实体的关系说明"]
      }
    }
  ],
  "relations": [
    { "source": "EntityA", "target": "EntityB", "type": "references|composes|extends|many_to_one|one_to_many|many_to_many", "label": "关系说明（如：用户 belongs_to 角色）" },
    { "source": "ServiceName", "target": "RepositoryName", "type": "uses", "label": "使用" },
    { "source": "RepositoryName", "target": "EntityName", "type": "manages", "label": "管理" }
  ]
}

分析要求：
1. 识别所有数据实体（Entity/Model/POJO/Schema）
2. 标注每个实体的字段（名称、类型、是否可空、说明）
3. 识别数据访问层（DAO/Repository/Mapper）
4. 标注 ORM 框架（MyBatis/JPA/Hibernate/TypeORM/Prisma 等）
5. 分析实体间关系（一对多/多对多/外键引用等）
6. 识别数据库表结构和命名
7. 标注数据源配置（DataSource/连接池）
8. 聚焦数据层结构，不要分析控制器/视图细节
仅输出 JSON。`,
  },
  {
    id: 'db-doc',
    label: '数据库设计文档生成',
    icon: '📄',
    description: '生成数据库设计文档：表结构、字段、关系、索引',
    builtin: true,
    systemPrompt: `请分析当前项目并生成数据库设计文档，按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "表名/实体名",
      "type": "database",
      "description": "表的业务含义说明",
      "tags": ["database", "table"],
      "filePath": "实体类文件路径",
      "metadata": {
        "tableName": "实际数据库表名",
        "engine": "InnoDB|MyISAM 等",
        "charset": "utf8mb4 等",
        "comment": "表注释",
        "fields": [
          {
            "name": "字段名",
            "type": "varchar(255)|int|datetime|text 等",
            "nullable": false,
            "default": "默认值",
            "primaryKey": false,
            "unique": false,
            "index": false,
            "comment": "字段注释说明"
          }
        ],
        "indexes": [
          { "name": "索引名", "fields": ["字段名"], "type": "unique|normal|primary", "comment": "索引说明" }
        ],
        "relations": [
          { "target": "关联表名", "type": "one_to_many|many_to_one|many_to_many|one_to_one", "foreignKey": "外键字段", "comment": "关系说明" }
        ]
      }
    }
  ],
  "relations": [
    { "source": "表A", "target": "表B", "type": "references|composes", "label": "外键关系：表A.字段 → 表B.字段" }
  ]
}

分析要求：
1. 识别所有数据库表（通过 Entity/Model/SQL 脚本/Migration）
2. 为每张表生成完整字段清单（名称、类型、长度、是否可空、默认值、注释）
3. 标注主键、唯一键、索引
4. 识别表间外键关系（一对多/多对多等）
5. 标注表的字符集和引擎（如能识别）
6. 为每张表和字段添加业务含义注释
7. 生成可直接用于文档的关系图数据
8. 如有 SQL 脚本/Migration 文件，优先从中提取精确信息
仅输出 JSON。`,
  },
  {
    id: 'functional-modules',
    label: '功能模块识别',
    icon: '🏗️',
    description: '全面识别项目的功能模块（非目录/文件粒度），包括业务模块、集成模块、基础设施模块',
    builtin: true,
    systemPrompt: `请全面分析当前项目的功能模块。注意：不要输出目录名、文件名或类名，聚焦业务功能维度。按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "功能模块名（如：用户管理、订单处理、报表引擎、消息推送等）",
      "type": "module",
      "description": "该模块的业务职责和提供的核心能力说明",
      "tags": ["business", "core", "feature"],
      "filePath": "该功能模块对应的顶层源码目录",
      "metadata": {
        "moduleType": "core|business|infra|integration|common",
        "archLayer": "service|domain|manager|workflow",
        "features": ["子功能1", "子功能2", "子功能3"]
      }
    },
    {
      "name": "功能模块名",
      "type": "module",
      "description": "...",
      "tags": ["business", "infra"],
      "filePath": "...",
      "metadata": {
        "moduleType": "infra",
        "archLayer": "service",
        "features": []
      }
    }
  ],
  "relations": [
    { "source": "功能模块A", "target": "功能模块B", "type": "depends_on", "label": "依赖关系说明" },
    { "source": "功能模块A", "target": "功能模块B", "type": "calls", "label": "调用关系说明" }
  ]
}

分析要求：
1. 识别项目的功能模块（业务功能视角），例如：
   - 核心业务模块：用户管理、权限管理、角色管理、组织架构、字典管理、系统配置等
   - 业务操作模块：订单管理、客户管理、产品管理、报表管理、流程管理、审批管理、任务管理等
   - 集成模块：消息通知、邮件服务、短信服务、文件管理、支付集成、第三方对接等
   - 基础设施模块：日志服务、缓存管理、配置中心、数据源管理、连接池管理、监控告警等
2. 每个功能模块必须有清晰的业务含义描述（description），而非代码结构描述
3. 列出每个模块包含的子功能（features），如"用户管理"包含：用户创建、用户查询、用户授权、密码重置等
4. 标注每个模块的类型（moduleType）：core=核心基础 / business=业务功能 / infra=基础设施 / integration=外部集成
5. 标注每个模块的应用层（archLayer）：service=服务层 / domain=领域层 / manager=管理层 / workflow=流程层
6. 标注模块对应的顶层源码目录（filePath），方便后续关联代码
7. 描述模块间的业务依赖和调用关系
8. 每个功能模块的输出应该是一个有意义的业务概念，而非技术组件名
9. 不要输出任何单个类、文件、函数或目录结构信息
仅输出 JSON。`,
  },
  {
    id: 'project-change',
    label: '项目变更分析 & 图谱更新',
    icon: '🔄',
    description: '分析项目最近变更内容，对比现有图谱，标记新增/修改/废弃的模块和关系',
    builtin: true,
    systemPrompt: `请分析当前项目的内容和结构，与图谱中已有数据进行对比，识别新增、变更和废弃的功能模块。按以下 JSON 格式输出（仅输出 JSON，不要额外文字）：

{
  "entities": [
    {
      "name": "新增或需要更新的功能模块名",
      "type": "module",
      "description": "模块的业务职责说明",
      "tags": ["business", "core", "feature", "updated"],
      "filePath": "对应的顶层源码路径",
      "metadata": {
        "moduleType": "core|business|infra|integration|common",
        "archLayer": "service|domain|manager|workflow",
        "features": ["子功能列表"],
        "changeType": "new|updated|deprecated|unchanged",
        "changeSummary": "变更摘要说明（新增了什么功能、修改了什么结构等）"
      }
    }
  ],
  "relations": [
    { "source": "模块A", "target": "模块B", "type": "depends_on|calls|references|contains", "label": "关系说明" }
  ]
}

分析要求：
1. 按功能模块（非目录/文件粒度）分析当前项目源码，识别出所有有意义的业务功能模块
2. 与图谱中已有 entities 进行对比（同一个功能模块名视为同一个模块）：
   - 如果功能模块是新增的（图谱中没有），mark metadata.changeType 为 "new"，tags 包含 "new"
   - 如果功能模块在图谱中已存在但内容/结构有变化，mark changeType 为 "updated"，tags 包含 "updated"
   - 如果功能模块在图谱中已存在且没有变化，mark changeType 为 "unchanged"（这些可不输出，节省 token）
   - 如果功能模块在图谱中但源码中已不存在或废弃，mark changeType 为 "deprecated"，tags 包含 "deprecated"
3. changeSummary 字段必须说明具体的变化内容（新增了什么子功能、修改了什么、删除了什么）
4. 每个模块必须标注对应的 filePath（源码目录），方便后续关联
5. 只输出有变化的实体（new/updated/deprecated），不变的可省略
6. 更新模块间的依赖关系，识别新增或变更的依赖
7. 聚焦功能业务维度，不要输出目录结构或单个文件/类
仅输出 JSON。`,
  },
]

/** 合并内置模板与项目级自定义模板（自定义排在内置之后） */
export function mergePrompts(builtin: GraphPrompt[], custom: GraphPrompt[] = []): GraphPrompt[] {
  return [...builtin, ...custom]
}

/** 生成唯一 id（用于新建自定义模板） */
export function genPromptId(): string {
  return 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)
}
