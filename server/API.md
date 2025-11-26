````markdown
# AIdeamon 接口文档

本文档描述后端认证/登录、任务管理、冲突检测、重复任务、批量创建、Boundary 模式配置以及 WebSocket 实时事件接口。所有任务相关端点均位于前缀 `/api` 下（见 `server/routes/apiRoutes.ts`）。

## 概览

主要目的：
- 提供本地账号注册/登录（email + password），使用 JWT 维护会话。
- 支持 Microsoft OAuth 并将微软 access token 与本地用户配对。
- 任务 CRUD、冲突检测（含可配置端点相接是否冲突）、重复任务（Daily / Weekly + byDay / weeklyByWeekNumber / dailyOnDays）、批量创建与部分成功反馈。
- WebSocket 经 JWT 鉴权实现用户隔离的任务变更与时间到达事件推送。

当前实现已使用 SQLite 持久化用户与任务（见 `dbService.ts`），不再仅依赖内存；内存缓存用于加速访问。生产仍应做好备份与密钥管理。

---

## 配置（环境变量）

- JWT_SECRET：用于签发/验证 JWT 的密钥。默认 `dev-secret-change-in-prod`（务必在生产环境替换）。
- MSAL 配置（在文件顶部硬编码的 config 对象）：
  - clientId, clientSecret, authority（建议改为环境变量）
- redirectUri：当前实现使用 `http://localhost:3000/redirect`。

---

## 依赖（建议安装）

- express
- @azure/msal-node
- jsonwebtoken
- bcryptjs
- uuid

建议同时安装类型声明以消除 TypeScript 提示：
- @types/jsonwebtoken
- @types/uuid
- @types/bcryptjs

---

## 数据结构

User 对象（内存池中）：
- id: string
- email: string
- name: string
- passwordHash?: string
- JWTtoken?: string
- MStoken?: string

全局内存池：Map<string, User>

JWT payload（当前实现简化为）：
- sub: userId
- email: userEmail

JWT 有效期：1 小时（`1h`），由 `JWT_EXPIRES_IN` 配置。

---

## 认证端点说明

### POST /register

- 描述：注册新用户（在内存中创建），并返回 JWT。
- URL：`http://localhost:3000/register`
- 请求头：
  - Content-Type: application/json
- 请求体（JSON）：
  {
    "email": "alice@example.com",
    "password": "Secret123!",
    "name": "Alice"
  }
- 成功响应：201
  {
    "token": "<JWT>"
  }
- 常见错误：
  - 400：缺少必需字段
  - 409：用户已存在

示例（PowerShell）：
```powershell
$body = @{ email='alice@example.com'; password='Secret123!'; name='Alice' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/register -Body $body -ContentType 'application/json'
```

---

### POST /login

- 描述：使用 email/password 登录，返回 JWT（如果凭据正确）。
- URL：`http://localhost:3000/login`
- 请求头：
  - Content-Type: application/json
- 请求体（JSON）：
  {
    "email": "alice@example.com",
    "password": "Secret123!"
  }
- 成功响应：200
  {
    "token": "<JWT>"
  }
- 常见错误：
  - 400：缺少字段
  - 401：凭据无效

---

### GET /auth

- 描述：生成 Microsoft OAuth 授权 URL 并重定向到微软登录页面。支持将本应用的 JWT 透传给微软（放入 OAuth 的 `state` 字段，base64 编码）。回调时微软会带回该 `state`，我们将它用于把微软 access token 和本地用户配对。
- URL：`http://localhost:3000/auth`
- 支持传入 JWT 的方式：
  1. Query 参数：`/auth?jwt=<JWT>`
  2. Authorization header：`Authorization: Bearer <JWT>`
- 行为：如果收到 JWT，会把其 base64 编码放到 OAuth 请求的 `state` 字段；随后服务会重定向浏览器到微软的登录页面。

示例（在浏览器直接打开）：
- http://localhost:3000/auth?jwt=<your-jwt>

示例（用 curl 发起重定向请求；浏览器可接着完成登录）:
```bash
curl -v "http://localhost:3000/auth?jwt=<your-jwt>"
```

---

### GET /redirect

- 描述：微软在用户完成授权后重定向到此端点，带回 `code`（用于换取 access token），并可能带回 `state`（如果在 /auth 时设置）。
- URL：`http://localhost:3000/redirect?code=<code>&state=<base64-jwt>`
- 处理流程：
  1. 使用 `code` 调用 MSAL 的 `acquireTokenByCode` 获取 access token。
  2. 尝试恢复 `state` 中的应用 JWT（优先使用 `state`），或检查 `query.jwt` 或 `Authorization` header。
  3. 验证 JWT，取出 `sub`（userId），把微软 `access_token` 存入到该用户的 `MStoken` 字段（内存池）。
  4. 返回成功消息；若没有提供应用 JWT 则只返回一个未配对的成功消息。

- 成功响应（配对成功）：200
  - 文本：Authentication successful and MS token paired to your account.
- 成功响应（无 JWT）：200
  - 文本：Authentication successful! You can now use the Microsoft To Do API. (No application JWT provided to pair)
- 错误：500（获取 token 失败）

示例：
- 用户在浏览器完成 Microsoft 登录后会被自动重定向到此端点。若你通过 `/auth?jwt=<JWT>` 发起授权，回调将自动把微软令牌配对到该 JWT 指向的用户。

---

## JWT 与微软 access token 的配对逻辑

1. 用户在前端登录（/login）或注册（/register），得到一个 JWT（payload 中包含 sub=userId）。
2. 用户点击“连接微软账号”或类似操作：前端向后端的 `/auth?jwt=<JWT>` 发起请求（或通过 Authorization header）。
3. 后端把 JWT base64 编码放到 OAuth 请求的 `state` 参数并重定向到微软授权页面。
4. 用户在微软完成授权后，微软把用户重定向回 `/redirect?code=...&state=<base64-jwt>`。
5. 后端在 `/redirect` 解码 state，验证 JWT，取出 userId，并把 MS access token 保存在该用户的 `MStoken` 字段。

注意：当前实现不会保存 refresh token；access token 存在内存，且生产环境需要更安全的存储与 token 刷新逻辑。

---

## 示例完整流程（演示用）

1. 注册并取得 JWT：
```powershell
$body = @{ email='alice@example.com'; password='Secret123!'; name='Alice' } | ConvertTo-Json
$res = Invoke-RestMethod -Method Post -Uri http://localhost:3000/register -Body $body -ContentType 'application/json'
$jwt = $res.token
```
2. 在浏览器访问：
```
http://localhost:3000/auth?jwt=<paste-jwt-here>
```
3. 完成 Microsoft 登录与授权。回调 `/redirect` 并配对成功。

---

## 常见问题与排查（认证部分）

- Q：为什么 `/redirect` 没有配对成功？
  - A：请确认在发起 `/auth` 请求时确实把 JWT 通过 `jwt` query 或 Authorization header 传给后端。检查回调 URL 是否包含 `state` 参数，以及 `state` 是否是 base64 编码的 JWT。

- Q：JWT 无效或过期怎么办？
  - A：JWT 有限期（1 小时）。若 JWT 过期，前端需要先刷新（重新登录）获取新的 JWT 再发起 `/auth`。

- Q：如何在服务器端检查当前用户的 MStoken？
  - A：当前没有暴露专门的 /me 或 /user/{id} 接口。可以直接在内存池中查看（仅限开发）。建议新增受保护的 `/me` 端点返回当前用户信息（基于 Authorization: Bearer <JWT> 验证）。

---

## 安全和生产建议（认证部分）

- 不要把 `clientSecret` 和其他秘密写在源代码里，使用环境变量或 secret manager。
- 将用户、passwordHash、refresh token、access token 等持久化到安全数据库，不要用内存存储。
- 当保存 tokens 时，敏感字段应加密储存。
- 实现 refresh token 的存储与定期刷新逻辑，以保持长期访问微软 API 的能力。
- 为所有受保护端点添加 JWT 验证中间件，并处理 token 过期、撤销等情形。


---

## 任务管理 API（需 Authorization: Bearer <JWT>）

所有以下端点路径均以 `/api` 为前缀。例如创建任务：`POST /api/tasks`。

### 日程队列 API

#### GET /api/schedule/queue
- 描述：获取当前用户待审批的日程队列（即所有需要用户同意后才会正式创建的日程申请）。
- 请求头：`Authorization: Bearer <JWT>`
- 响应：200
```
{
  "queue": [
    {
      "id": "queue_123",
      "requester": "user@example.com",
      "task": { "name": "...", "description": "...", "startTime": "...", "endTime": "..." },
      "requestedAt": "2025-11-26T09:00:00Z",
      "status": "pending" // 或 "approved" / "rejected"
    },
    ...
  ]
}
```

#### POST /api/schedule/queue/:id/approve
- 描述：同意并正式创建指定队列中的日程。
- 请求头：`Authorization: Bearer <JWT>`
- 响应：200
```
{
  "message": "Schedule request approved",
  "task": { ...已创建的任务对象... }
}
```

#### POST /api/schedule/queue/:id/reject
- 描述：拒绝指定队列中的日程申请。
- 请求头：`Authorization: Bearer <JWT>`
- 响应：200
```
{
  "message": "Schedule request rejected"
}
```

### 数据结构（核心）
Task:
```
{
  id: string,
  name: string,
  description: string,
  startTime: ISOString,
  endTime: ISOString,
  dueDate: ISOString,
  location?: string,
  completed: boolean,
  pushedToMSTodo: boolean,
  recurrenceRule?: string (JSON 序列化),
  parentTaskId?: string
}
```

RecurrenceRule（反序列化后结构）:
```
{
  freq: 'daily' | 'weekly' | 'weeklyByWeekNumber' | 'dailyOnDays',
  interval?: number,
  count?: number,
  until?: ISOString,
  // 当 freq='weekly' 时：
  byDay?: string[] // 如 ['Mon','Wed','Fri']
  // 当 freq='weeklyByWeekNumber' 时：
  weeks?: number[] // ISO 周号列表，例如 [1,3,5] 表示在这些 ISO 周内按任务的星期生成实例
  // 当 freq='dailyOnDays' 时：
  days?: number[] // 星期索引数组，0=Sun,1=Mon,...6=Sat，例如 [1,3,5]
}
```

RecurrenceSummary（创建/批量创建响应中）:
```
{
  createdInstances: number,        // 成功持久化的子实例数量
  conflictInstances: number,       // 因时间冲突被跳过的实例数量
  errorInstances: number,          // 其它错误导致未创建的实例数量
  requestedRule: RecurrenceRule
}
```

### POST /api/tasks
创建单个任务（支持冲突检测与重复规则）。
请求体示例：
```
{
  "name": "Study",
  "description": "Read chapters",
  "startTime": "2025-11-16T09:00:00Z",
  "endTime": "2025-11-16T10:00:00Z",
  "boundaryConflict": true, // 可选，覆盖用户级配置
  "recurrenceRule": {
    "freq": "weekly",
    "interval": 1,
    "byDay": ["Mon","Wed"],
    "count": 6
  }
}
```
成功响应：201
```
{
  "task": { ...根任务... },
  "recurrenceSummary": { createdInstances: 4, conflictInstances: 0, errorInstances: 0, requestedRule: {...} },
  "conflictWarning": { // 可选，仅当存在冲突时返回
     "message": "Task created with time conflicts",
     "conflicts": [ { id, name, startTime, endTime }, ... ],
     "instanceConflicts": [ ... ]
  }
}
```
注：不再返回 409 错误，而是允许创建并返回警告。

### POST /api/tasks/conflicts
预检查冲突不创建：
```
{
  "name":"Tmp",
  "startTime":"...",
  "endTime":"...",
  "boundaryConflict": false
}
```
响应：200 `{ conflicts: Task[] }`（可为空数组）。

### POST /api/tasks/batch
批量创建，部分成功：
```
{
  "tasks": [ { name, startTime, endTime, recurrenceRule? }, ... ],
  "boundaryConflict": false // 批次默认，可被单条覆盖
}
```
响应：200
```
{
  "results": [
    { input: {...}, status: "created", task: {...}, recurrenceSummary?, conflictWarning? },
    { input: {...}, status: "error", errorMessage: "..." }
  ],
  "summary": { total, created, conflicts, errors }
}
```

### PUT /api/tasks/:id
更新任务（含冲突检测）。若设置 `completed: true` 且先前为 false，将广播 `completed` 事件。
成功响应：200
```
{
  "task": { ... },
  "conflictWarning": { ... } // 可选，若有冲突
}
```

### PATCH /api/tasks/:id
部分更新任务。与 PUT 类似，但只更新提供的字段。
请求体示例：
```
{
  "completed": true,
  "description": "Finished reading all chapters."
}
```
成功响应：200
```
{
  ...更新后的完整任务对象...,
  "conflictWarning": { ... } // 可选，若有冲突
}
```

### DELETE /api/tasks/:id
删除任务并广播 `deleted`。

- 可选查询参数：`cascade=true`
  - 当 `cascade=true` 时，如果删除的任务是一个父级（根）任务，服务端会同时删除由该父任务生成的所有子实例（即 cascade 删除）。
  - 示例：`DELETE /api/tasks/abcd-1234?cascade=true` 将删除 id 为 `abcd-1234` 的父任务及其所有实例。
  - 如果删除的是子实例（其 `parentTaskId` 非空），默认行为是不影响父任务；要删除父任务及其所有实例，应针对父任务 id 使用 `cascade=true`。

### POST /api/sync/timetable
手动触发课表同步（从 Ebridge 抓取）。
响应：200
```
{
  "message": "Timetable sync completed",
  "added": 5,
  "errors": 0
}
```

### DELETE /api/sync/timetable
一键删除所有由课程表导入的日程（ID 以 `timetable_` 开头）。
响应：200
```
{
  "message": "Successfully deleted 10 timetable tasks",
  "count": 10
}
```

### GET /api/tasks
查询与过滤：支持 `q`（名称/描述模糊），`completed`（true|false），时间窗口与分页排序：
`start`、`end`、`limit`、`offset` 或 `page`、`sortBy`（startTime|dueDate|name）、`order`（asc|desc）。

### GET /api/tasks/parents
- 描述：返回当前用户的所有父级日程（即在数据库中包含 `recurrenceRule` 的根任务），以及每个父任务的子实例（occurrences）列表，便于前端显示或批量管理父任务。
- 请求头：`Authorization: Bearer <JWT>`
- 可选查询参数：`limit`（可用于限制每个父任务返回的 occurrences 数量，服务当前实现默认返回最多 1000 个子实例）
- 成功响应：200
```
{
  "parents": [
    {
      "parentTask": { id, name, startTime, endTime, recurrenceRule, ... },
      "occurrences": [ { id, parentTaskId, startTime, endTime, ... }, ... ],
      "total": 12
    },
    ...
  ]
}
```
注：若某个父任务的子实例查询失败，该父任务仍会包含在返回列表中，但其 `occurrences` 可能为空并带有 `error` 字段说明原因。

### POST /api/settings/conflict-mode
设置端点相接是否视为冲突：
```
{ "inclusive": true }
```
影响后续创建/更新的判定逻辑（闭区间 vs 半开区间）。

---

## LLM 聊天 API（需 Authorization: Bearer <JWT>）

### POST /api/llm/chat
使用服务端配置的 LLM 进行流式聊天。客户端无需提供 API Key。

请求体（JSON）：
```
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ]
}
```

响应：Server-Sent Events (SSE) 流
- 每个数据块格式：`data: {"content": "..."}`
- 结束标志：`data: [DONE]`
- 错误：`data: {"error": "..."}`

---

## 用户日志 API（需 Authorization: Bearer <JWT>）

### GET /api/logs
查询当前用户的操作日志（分页、按时间与类型过滤）。

Query 参数：
- `limit`：每页数量（默认 50，最大 500）
- `offset`：偏移量（默认 0）
- `since`：起始时间（ISO 字符串，含边界）
- `until`：截止时间（ISO 字符串，含边界）
- `type`：日志类型（如 `taskCreated`、`taskUpdated`、`taskDeleted`、`taskConflict`、`taskError`、`emailProcessed`、`msTodoPushed`、`timetableFetched` 等）

响应：200
```
{
  "logs": [
    { "id": "...", "time": "ISO", "type": "taskCreated", "message": "...", "payload": { /* 可选上下文 */ }},
    ...
  ],
  "total": 123,
  "limit": 50,
  "offset": 0
}
```

说明：日志用于帮助用户了解系统自动化行为（如抓取到的邮件、添加的日程、推送到 MS To Do 的状态等）。

---

## 冲突检测逻辑简介
使用 `scheduleConflict.ts`：两个时间段是否冲突取决于配置：
- 半开区间（默认）：`A.end <= B.start` 不冲突。
- 闭区间（inclusive=true）：`A.end == B.start` 视为冲突。
添加/更新在 DB 层调用 `assertNoConflict` 保证一致性。

---

## 重复任务逻辑
根任务保存 `recurrenceRule`（JSON 字符串）。生成实例：
- daily: 每 interval 天一次。
- weekly: 若提供 byDay 数组按星期生成（Sun,Mon,Tue,Wed,Thu,Fri,Sat 简写），否则沿用根任务星期。
- weeklyByWeekNumber: 按指定的 ISO 周号在对应周生成（结合任务的星期字段使用）。
- dailyOnDays: 每天按指定的星期索引（0=Sun..6=Sat）生成，例如工作日集合 [1,2,3,4,5]。
- 限制：未指定 count/until 时最多生成 30 个实例。
- 子实例保存 `parentTaskId` 指向根任务，不再包含 recurrenceRule。
 - 冲突与其它错误分别计入 `conflictInstances` 与 `errorInstances`。
### GET /api/tasks/:id/occurrences
返回指定任务（根任务）及其所有重复子实例（按开始时间升序）。若任务不存在返回 404。
响应示例：
```
{
  "rootTask": { id, name, startTime, ... },
  "occurrences": [ { id, parentTaskId, startTime, endTime, ... }, ... ]
}
```

---

## 周信息与用户偏移设置

应用支持全局（.env）与用户级的周偏移，前端可通过以下接口读取与设置：

### GET /api/settings/week
- 描述：返回当前原始周数（由服务端计算），全局偏移（来自环境变量），以及当前用户的周偏移量和最终生效周数。
- 请求头：`Authorization: Bearer <JWT>`
- 成功响应：200
```
{
  "rawWeekNumber": 42,            // 服务器计算的当前 ISO 周或学期周（视实现而定）
  "globalWeekOffset": 0,         // 来自全局配置（.env）的偏移
  "userWeekOffset": 1,           // 当前用户在数据库中保存的偏移量
  "effectiveWeek": 43            // rawWeekNumber + globalWeekOffset + userWeekOffset
}
```

### POST /api/settings/week
- 描述：允许用户设置其个人 `userWeekOffset`，或通过提供 `currentWeek` 来告诉服务当前周数（服务端会根据该值计算并保存 userWeekOffset）。
- 请求头：`Authorization: Bearer <JWT>`
- 请求体（JSON，可选两种用法）：
```
{ "userWeekOffset": 2 }
```
或
```
{ "currentWeek": 45 }
```
- 成功响应：200，同 GET 返回格式，返回更新后的偏移与生效周信息。

---

## WebSocket 说明
URL: `ws://<host>/ws?token=<JWT>` 必须携带有效 JWT（`sub` 为用户 ID）。
服务器按用户隔离广播。

事件：
1. `taskChange`: `{ type:'taskChange', action:'created'|'updated'|'deleted'|'completed', task:{ id,name,startTime,endTime,completed,parentTaskId,recurrenceRule? } }`
2. `taskOccurrence`: 任务首次到达开始时间广播一次。
   `{ type:'taskOccurrence', taskId, name, startTime, endTime }`
3. `taskOccurrenceCanceled`: 任务在开始前被标记完成后广播一次。
   `{ type:'taskOccurrenceCanceled', taskId, startTime }`
4. `userLog`: 针对当前连接用户的日志事件。
  `{ type:'userLog', log: { id, time, type, message, payload? } }`
4. `error`: 认证失败等 `{ type:'error', error:'AUTH_REQUIRED'|'INVALID_TOKEN' }`
5. `welcome`: 连接成功 `{ type:'welcome', time, userId }`

客户端策略建议：
- 收到 `taskChange.completed` 更新本地完成状态并移除未来提醒。
- 使用 `taskOccurrence` 触发桌面提醒或计时器。
- 收到 `taskOccurrenceCanceled` 清理预设提醒。

````
# AIdeamon 接口文档

本文档描述后端认证/登录、任务管理、冲突检测、重复任务、批量创建、Boundary 模式配置以及 WebSocket 实时事件接口。所有任务相关端点均位于前缀 `/api` 下（见 `server/routes/apiRoutes.ts`）。

## 概览

主要目的：
- 提供本地账号注册/登录（email + password），使用 JWT 维护会话。
- 支持 Microsoft OAuth 并将微软 access token 与本地用户配对。
- 任务 CRUD、冲突检测（含可配置端点相接是否冲突）、重复任务（Daily / Weekly + byDay）、批量创建与部分成功反馈。
- WebSocket 经 JWT 鉴权实现用户隔离的任务变更与时间到达事件推送。

当前实现已使用 SQLite 持久化用户与任务（见 `dbService.ts`），不再仅依赖内存；内存缓存用于加速访问。生产仍应做好备份与密钥管理。

---

## 配置（环境变量）

- JWT_SECRET：用于签发/验证 JWT 的密钥。默认 `dev-secret-change-in-prod`（务必在生产环境替换）。
- MSAL 配置（在文件顶部硬编码的 config 对象）：
  - clientId, clientSecret, authority（建议改为环境变量）
- redirectUri：当前实现使用 `http://localhost:3000/redirect`。

---

## 依赖（建议安装）

- express
- @azure/msal-node
- jsonwebtoken
- bcryptjs
- uuid

建议同时安装类型声明以消除 TypeScript 提示：
- @types/jsonwebtoken
- @types/uuid
- @types/bcryptjs

---

## 数据结构

User 对象（内存池中）：
- id: string
- email: string
- name: string
- passwordHash?: string
- JWTtoken?: string
- MStoken?: string

全局内存池：Map<string, User>

JWT payload（当前实现简化为）：
- sub: userId
- email: userEmail

JWT 有效期：1 小时（`1h`），由 `JWT_EXPIRES_IN` 配置。

---

## 认证端点说明

### POST /register

- 描述：注册新用户（在内存中创建），并返回 JWT。
- URL：`http://localhost:3000/register`
- 请求头：
  - Content-Type: application/json
- 请求体（JSON）：
  {
    "email": "alice@example.com",
    "password": "Secret123!",
    "name": "Alice"
  }
- 成功响应：201
  {
    "token": "<JWT>"
  }
- 常见错误：
  - 400：缺少必需字段
  - 409：用户已存在

示例（PowerShell）：
```powershell
$body = @{ email='alice@example.com'; password='Secret123!'; name='Alice' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/register -Body $body -ContentType 'application/json'
```

---

### POST /login

- 描述：使用 email/password 登录，返回 JWT（如果凭据正确）。
- URL：`http://localhost:3000/login`
- 请求头：
  - Content-Type: application/json
- 请求体（JSON）：
  {
    "email": "alice@example.com",
    "password": "Secret123!"
  }
- 成功响应：200
  {
    "token": "<JWT>"
  }
- 常见错误：
  - 400：缺少字段
  - 401：凭据无效

---

### GET /auth

- 描述：生成 Microsoft OAuth 授权 URL 并重定向到微软登录页面。支持将本应用的 JWT 透传给微软（放入 OAuth 的 `state` 字段，base64 编码）。回调时微软会带回该 `state`，我们将它用于把微软 access token 和本地用户配对。
- URL：`http://localhost:3000/auth`
- 支持传入 JWT 的方式：
  1. Query 参数：`/auth?jwt=<JWT>`
  2. Authorization header：`Authorization: Bearer <JWT>`
- 行为：如果收到 JWT，会把其 base64 编码放到 OAuth 请求的 `state` 字段；随后服务会重定向浏览器到微软的登录页面。

示例（在浏览器直接打开）：
- http://localhost:3000/auth?jwt=<your-jwt>

示例（用 curl 发起重定向请求；浏览器可接着完成登录）:
```bash
curl -v "http://localhost:3000/auth?jwt=<your-jwt>"
```

---

### GET /redirect

- 描述：微软在用户完成授权后重定向到此端点，带回 `code`（用于换取 access token），并可能带回 `state`（如果在 /auth 时设置）。
- URL：`http://localhost:3000/redirect?code=<code>&state=<base64-jwt>`
- 处理流程：
  1. 使用 `code` 调用 MSAL 的 `acquireTokenByCode` 获取 access token。
  2. 尝试恢复 `state` 中的应用 JWT（优先使用 `state`），或检查 `query.jwt` 或 `Authorization` header。
  3. 验证 JWT，取出 `sub`（userId），把微软 `access_token` 存入到该用户的 `MStoken` 字段（内存池）。
  4. 返回成功消息；若没有提供应用 JWT 则只返回一个未配对的成功消息。

- 成功响应（配对成功）：200
  - 文本：Authentication successful and MS token paired to your account.
- 成功响应（无 JWT）：200
  - 文本：Authentication successful! You can now use the Microsoft To Do API. (No application JWT provided to pair)
- 错误：500（获取 token 失败）

示例：
- 用户在浏览器完成 Microsoft 登录后会被自动重定向到此端点。若你通过 `/auth?jwt=<JWT>` 发起授权，回调将自动把微软令牌配对到该 JWT 指向的用户。

---

## JWT 与微软 access token 的配对逻辑

1. 用户在前端登录（/login）或注册（/register），得到一个 JWT（payload 中包含 sub=userId）。
2. 用户点击“连接微软账号”或类似操作：前端向后端的 `/auth?jwt=<JWT>` 发起请求（或通过 Authorization header）。
3. 后端把 JWT base64 编码放到 OAuth 请求的 `state` 参数并重定向到微软授权页面。
4. 用户在微软完成授权后，微软把用户重定向回 `/redirect?code=...&state=<base64-jwt>`。
5. 后端在 `/redirect` 解码 state，验证 JWT，取出 userId，并把 MS access token 保存在该用户的 `MStoken` 字段。

注意：当前实现不会保存 refresh token；access token 存在内存，且生产环境需要更安全的存储与 token 刷新逻辑。

---

## 示例完整流程（演示用）

1. 注册并取得 JWT：
```powershell
$body = @{ email='alice@example.com'; password='Secret123!'; name='Alice' } | ConvertTo-Json
$res = Invoke-RestMethod -Method Post -Uri http://localhost:3000/register -Body $body -ContentType 'application/json'
$jwt = $res.token
```
2. 在浏览器访问：
```
http://localhost:3000/auth?jwt=<paste-jwt-here>
```
3. 完成 Microsoft 登录与授权。回调 `/redirect` 并配对成功。

---

## 常见问题与排查（认证部分）

- Q：为什么 `/redirect` 没有配对成功？
  - A：请确认在发起 `/auth` 请求时确实把 JWT 通过 `jwt` query 或 Authorization header 传给后端。检查回调 URL 是否包含 `state` 参数，以及 `state` 是否是 base64 编码的 JWT。

- Q：JWT 无效或过期怎么办？
  - A：JWT 有限期（1 小时）。若 JWT 过期，前端需要先刷新（重新登录）获取新的 JWT 再发起 `/auth`。

- Q：如何在服务器端检查当前用户的 MStoken？
  - A：当前没有暴露专门的 /me 或 /user/{id} 接口。可以直接在内存池中查看（仅限开发）。建议新增受保护的 `/me` 端点返回当前用户信息（基于 Authorization: Bearer <JWT> 验证）。

---

## 安全和生产建议（认证部分）

- 不要把 `clientSecret` 和其他秘密写在源代码里，使用环境变量或 secret manager。
- 将用户、passwordHash、refresh token、access token 等持久化到安全数据库，不要用内存存储。
- 当保存 tokens 时，敏感字段应加密储存。
- 实现 refresh token 的存储与定期刷新逻辑，以保持长期访问微软 API 的能力。
- 为所有受保护端点添加 JWT 验证中间件，并处理 token 过期、撤销等情形。


---

## 任务管理 API（需 Authorization: Bearer <JWT>）

所有以下端点路径均以 `/api` 为前缀。例如创建任务：`POST /api/tasks`。

### 数据结构（核心）
Task:
```
{
  id: string,
  name: string,
  description: string,
  startTime: ISOString,
  endTime: ISOString,
  dueDate: ISOString,
  location?: string,
  completed: boolean,
  pushedToMSTodo: boolean,
  recurrenceRule?: string (JSON 序列化),
  parentTaskId?: string
}
```

RecurrenceRule（反序列化后结构）:
```
{
  freq: 'daily' | 'weekly',
  interval?: number,
  count?: number,
  until?: ISOString,
  byDay?: string[] // 仅当 freq=weekly 时可用，如 ['Mon','Wed','Fri']
}
```

RecurrenceSummary（创建/批量创建响应中）:
```
{
  createdInstances: number,        // 成功持久化的子实例数量
  conflictInstances: number,       // 因时间冲突被跳过的实例数量
  errorInstances: number,          // 其它错误导致未创建的实例数量
  requestedRule: RecurrenceRule
}
```

### POST /api/tasks
创建单个任务（支持冲突检测与重复规则）。
请求体示例：
```
{
  "name": "Study",
  "description": "Read chapters",
  "startTime": "2025-11-16T09:00:00Z",
  "endTime": "2025-11-16T10:00:00Z",
  "boundaryConflict": true, // 可选，覆盖用户级配置
  "recurrenceRule": {
    "freq": "weekly",
    "interval": 1,
    "byDay": ["Mon","Wed"],
    "count": 6
  }
}
```
成功响应：201
```
{
  "task": { ...根任务... },
  "recurrenceSummary": { createdInstances: 4, conflictInstances: 0, errorInstances: 0, requestedRule: {...} },
  "conflictWarning": { // 可选，仅当存在冲突时返回
     "message": "Task created with time conflicts",
     "conflicts": [ { id, name, startTime, endTime }, ... ],
     "instanceConflicts": [ ... ]
  }
}
```
注：不再返回 409 错误，而是允许创建并返回警告。

### POST /api/tasks/conflicts
预检查冲突不创建：
```
{
  "name":"Tmp",
  "startTime":"...",
  "endTime":"...",
  "boundaryConflict": false
}
```
响应：200 `{ conflicts: Task[] }`（可为空数组）。

### POST /api/tasks/batch
批量创建，部分成功：
```
{
  "tasks": [ { name, startTime, endTime, recurrenceRule? }, ... ],
  "boundaryConflict": false // 批次默认，可被单条覆盖
}
```
响应：200
```
{
  "results": [
    { input: {...}, status: "created", task: {...}, recurrenceSummary?, conflictWarning? },
    { input: {...}, status: "error", errorMessage: "..." }
  ],
  "summary": { total, created, conflicts, errors }
}
```

### PUT /api/tasks/:id
更新任务（含冲突检测）。若设置 `completed: true` 且先前为 false，将广播 `completed` 事件。
成功响应：200
```
{
  "task": { ... },
  "conflictWarning": { ... } // 可选，若有冲突
}
```

### PATCH /api/tasks/:id
部分更新任务。与 PUT 类似，但只更新提供的字段。
请求体示例：
```
{
  "completed": true,
  "description": "Finished reading all chapters."
}
```
成功响应：200
```
{
  ...更新后的完整任务对象...,
  "conflictWarning": { ... } // 可选，若有冲突
}
```

### DELETE /api/tasks/:id
删除任务并广播 `deleted`。

### POST /api/sync/timetable
手动触发课表同步（从 Ebridge 抓取）。
响应：200
```
{
  "message": "Timetable sync completed",
  "added": 5,
  "errors": 0
}
```

### DELETE /api/sync/timetable
一键删除所有由课程表导入的日程（ID 以 `timetable_` 开头）。
响应：200
```
{
  "message": "Successfully deleted 10 timetable tasks",
  "count": 10
}
```

### GET /api/tasks
查询与过滤：支持 `q`（名称/描述模糊），`completed`（true|false），时间窗口与分页排序：
`start`、`end`、`limit`、`offset` 或 `page`、`sortBy`（startTime|dueDate|name）、`order`（asc|desc）。

### POST /api/settings/conflict-mode
设置端点相接是否视为冲突：
```
{ "inclusive": true }
```
影响后续创建/更新的判定逻辑（闭区间 vs 半开区间）。

---

## LLM 聊天 API（需 Authorization: Bearer <JWT>）

### POST /api/llm/chat
使用服务端配置的 LLM 进行流式聊天。客户端无需提供 API Key。

请求体（JSON）：
```
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ]
}
```

响应：Server-Sent Events (SSE) 流
- 每个数据块格式：`data: {"content": "..."}`
- 结束标志：`data: [DONE]`
- 错误：`data: {"error": "..."}`

---

## 用户日志 API（需 Authorization: Bearer <JWT>）

### GET /api/logs
查询当前用户的操作日志（分页、按时间与类型过滤）。

Query 参数：
- `limit`：每页数量（默认 50，最大 500）
- `offset`：偏移量（默认 0）
- `since`：起始时间（ISO 字符串，含边界）
- `until`：截止时间（ISO 字符串，含边界）
- `type`：日志类型（如 `taskCreated`、`taskUpdated`、`taskDeleted`、`taskConflict`、`taskError`、`emailProcessed`、`msTodoPushed`、`timetableFetched` 等）

响应：200
```
{
  "logs": [
    { "id": "...", "time": "ISO", "type": "taskCreated", "message": "...", "payload": { /* 可选上下文 */ }},
    ...
  ],
  "total": 123,
  "limit": 50,
  "offset": 0
}
```

说明：日志用于帮助用户了解系统自动化行为（如抓取到的邮件、添加的日程、推送到 MS To Do 的状态等）。

---

## 冲突检测逻辑简介
使用 `scheduleConflict.ts`：两个时间段是否冲突取决于配置：
- 半开区间（默认）：`A.end <= B.start` 不冲突。
- 闭区间（inclusive=true）：`A.end == B.start` 视为冲突。
添加/更新在 DB 层调用 `assertNoConflict` 保证一致性。

---

## 重复任务逻辑
根任务保存 `recurrenceRule`（JSON 字符串）。生成实例：
- daily: 每 interval 天一次。
- weekly: 若提供 byDay 数组按星期生成（Sun,Mon,Tue,Wed,Thu,Fri,Sat 简写），否则沿用根任务星期。
- 限制：未指定 count/until 时最多生成 30 个实例。
- 子实例保存 `parentTaskId` 指向根任务，不再包含 recurrenceRule。
 - 冲突与其它错误分别计入 `conflictInstances` 与 `errorInstances`。
### GET /api/tasks/:id/occurrences
返回指定任务（根任务）及其所有重复子实例（按开始时间升序）。若任务不存在返回 404。
响应示例：
```
{
  "rootTask": { id, name, startTime, ... },
  "occurrences": [ { id, parentTaskId, startTime, endTime, ... }, ... ]
}
```

---

## WebSocket 说明
URL: `ws://<host>/ws?token=<JWT>` 必须携带有效 JWT（`sub` 为用户 ID）。
服务器按用户隔离广播。

事件：
1. `taskChange`: `{ type:'taskChange', action:'created'|'updated'|'deleted'|'completed', task:{ id,name,startTime,endTime,completed,parentTaskId,recurrenceRule? } }`
2. `taskOccurrence`: 任务首次到达开始时间广播一次。
   `{ type:'taskOccurrence', taskId, name, startTime, endTime }`
3. `taskOccurrenceCanceled`: 任务在开始前被标记完成后广播一次。
   `{ type:'taskOccurrenceCanceled', taskId, startTime }`
4. `userLog`: 针对当前连接用户的日志事件。
  `{ type:'userLog', log: { id, time, type, message, payload? } }`
4. `error`: 认证失败等 `{ type:'error', error:'AUTH_REQUIRED'|'INVALID_TOKEN' }`
5. `welcome`: 连接成功 `{ type:'welcome', time, userId }`

客户端策略建议：
- 收到 `taskChange.completed` 更新本地完成状态并移除未来提醒。
- 使用 `taskOccurrence` 触发桌面提醒或计时器。
- 收到 `taskOccurrenceCanceled` 清理预设提醒。
