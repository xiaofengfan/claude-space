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
