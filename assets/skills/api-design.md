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
