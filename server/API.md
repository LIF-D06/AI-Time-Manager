# AIdeamon 接口文档

本文档描述 `AIdeamon/index.ts` 中实现的认证/登录相关 HTTP 接口、数据格式、示例、以及如何把应用端的 JWT 与微软 OAuth 返回的 access token 配对。

## 概览

主要目的：
- 提供本地账号注册/登录（使用 email + password），并使用 JWT 维护会话。
- 在发起 Microsoft OAuth 授权时把本端 JWT 传给微软（放在 OAuth `state` 中），在微软回调 `/redirect` 时解码并将微软 access token 与全局内存用户池中的用户配对。

注意：当前实现是演示用，用户和令牌均保存在内存（进程重启后丢失）。生产需持久化并保护密钥。

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

## 端点说明

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

## 常见问题与排查

- Q：为什么 `/redirect` 没有配对成功？
  - A：请确认在发起 `/auth` 请求时确实把 JWT 通过 `jwt` query 或 Authorization header 传给后端。检查回调 URL 是否包含 `state` 参数，以及 `state` 是否是 base64 编码的 JWT。

- Q：JWT 无效或过期怎么办？
  - A：JWT 有限期（1 小时）。若 JWT 过期，前端需要先刷新（重新登录）获取新的 JWT 再发起 `/auth`。

- Q：如何在服务器端检查当前用户的 MStoken？
  - A：当前没有暴露专门的 /me 或 /user/{id} 接口。可以直接在内存池中查看（仅限开发）。建议新增受保护的 `/me` 端点返回当前用户信息（基于 Authorization: Bearer <JWT> 验证）。

---

## 安全和生产建议

- 不要把 `clientSecret` 和其他秘密写在源代码里，使用环境变量或 secret manager。
- 将用户、passwordHash、refresh token、access token 等持久化到安全数据库，不要用内存存储。
- 当保存 tokens 时，敏感字段应加密储存。
- 实现 refresh token 的存储与定期刷新逻辑，以保持长期访问微软 API 的能力。
- 为所有受保护端点添加 JWT 验证中间件，并处理 token 过期、撤销等情形。

---

## 下一步建议

- 为 `/me` 添加受保护接口以便客户端查询当前用户和 MStoken 是否已配对。
- 将内存用户池替换为数据库实现（sqlite/pg/mongo）。
- 保存并使用 Microsoft refresh_token（如果 MSAL 返回）。

如果需要，我可以继续为你：
- 在同目录下添加 `AIdeamon/ME.md` 或实现受保护的 `/me` 端点；
- 把内存池替换为本地文件持久化（快速实现），或迁移到 sqlite；
- 安装并配置缺失的依赖以及类型声明，并再次运行 `tsc`。

---

文档结束。