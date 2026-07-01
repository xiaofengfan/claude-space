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
