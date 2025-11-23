
---

### `server/index.ts`

**Purpose:** 这是 Node.js 服务器的主入口点。它负责设置 Express 应用程序、配置中间件（如 CORS 和 JSON 解析）、定义全局错误处理程序、管理用户身份验证（JWT）、处理用户注册和登录，并初始化 API 路由、MCP 路由、WebSocket 服务器和后台定时任务。它还定义了核心数据结构 `User` 和 `Task`。

**Key Exports:**
- `interface Task`: 定义任务对象的结构。
- `interface User`: 定义用户对象的结构。
- `function createTaskToUser()`: 一个辅助函数，用于为特定用户创建新任务。

---

### `server/intervals.ts`

**Purpose:** 此文件负责管理用户的周期性后台任务。这些任务包括检查 JWT 令牌是否过期、从 Exchange 获取日历事件和电子邮件、将任务推送到 Microsoft To Do，以及从外部源（e-bridge）获取课程表信息。

**Key Exports:**
- `function startIntervals()`: 启动所有已定义的基于间隔的后台作业。它接受一个函数作为参数以获取所有活动用户。
- `interface IntervalController`: 定义由 `startIntervals` 返回的控制器对象，该对象包含一个 `stop()` 方法用于清除定时器。

---

### `server/routes/apiRoutes.ts`

**Purpose:** 此文件集中定义了主要的 REST API 路由。它创建了一个 Express 路由器，并为其附加了用于管理任务（CRUD 操作、批量创建、冲突检查）、用户设置（冲突模式）以及检查外部服务状态（Microsoft To Do、E-bridge）的端点。它使用身份验证中间件来保护路由。

**Key Exports:**
- `function initializeApiRoutes()`: 一个工厂函数，它接受一个身份验证中间件并返回一个配置了所有 API 路由的 Express 路由器实例。
- `interface AuthMiddleware`: 定义了身份验证中间件函数的类型签名。

---

### `server/Services/dbService.ts`

**Purpose:** 此服务封装了与 SQLite 数据库的所有交互。它负责数据库的初始化、创建表结构，并为用户、任务和日志提供所有 CRUD（创建、读取、更新、删除）操作。它还包括了任务冲突检测逻辑。

**Key Exports:**
- `class DatabaseService`: 管理数据库连接和操作的核心类。
- `const dbService`: `DatabaseService` 类的一个单例实例，供整个应用程序使用。

---

### `server/Services/exchangeClient.ts`

**Purpose:** 此文件实现了一个客户端，用于与 Microsoft Exchange 服务器进行交互。它可以使用 EWS (Exchange Web Services) API 来读取用户的电子邮件和日历事件。它还集成了 `LLMApi` 来智能处理新邮件，并能够启动流式通知以实时接收事件。

**Key Exports:**
- `class ExchangeClient`: 用于连接和与 Exchange 服务器通信的客户端。

---

### `server/Services/LLMApi.ts`

**Purpose:** 此文件提供了一个客户端，用于与大型语言模型（LLM）API（如 OpenAI 或 DeepSeek）进行交互。它被 `exchangeClient` 用来分析电子邮件内容，将其分类（如会议、待办事项、信息），并提取关键信息。

**Key Exports:**
- `class LLMApi`: 用于向 LLM 发送请求并解析响应的客户端。
- `interface EmailProcessResponse`: 定义了邮件处理后从 LLM 返回的结构化数据格式。

---

### `server/Services/mcp.ts`

**Purpose:** 此文件实现了模型-上下文协议（Model-Context-Protocol, MCP）服务器。它定义了一组工具，允许外部 AI 模型（如聊天机器人）通过一个安全的、结构化的方式与应用程序的后端功能进行交互，例如读取邮件、添加或获取日程。

**Key Exports:**
- `function initializeMcpRoutes()`: 在 Express 应用中设置和初始化 MCP 端点的函数。

---

### `server/Services/MStodo.ts`

**Purpose:** 此服务封装了与 Microsoft To Do API 的交互。它提供了一个函数，可以将应用程序中的任务推送到用户的 Microsoft To Do 列表中。

**Key Exports:**
- `function createTodoItem()`: 将一个任务项创建并推送到用户的 Microsoft To Do 账户。

---

### `server/Services/userLog.ts`

**Purpose:** 这是一个简单的服务，用于记录特定于用户的事件。它将日志条目保存到数据库，并通过 WebSocket 将其广播给相应的客户端，以便在用户界面中实时显示。

**Key Exports:**
- `function logUserEvent()`: 记录一个用户事件并将其广播出去。
- `interface UserLogEvent`: 定义了用户日志事件对象的结构。

---

### `server/Services/websocket.ts`

**Purpose:** 此文件负责管理与客户端的 WebSocket 连接，以实现服务器和客户端之间的实时双向通信。它处理连接的身份验证（通过 JWT），并提供广播函数，以便在任务状态更改或记录新日志时通知客户端。

**Key Exports:**
- `function initWebSocket()`: 初始化 WebSocket 服务器并将其附加到 HTTP 服务器。
- `function broadcastTaskChange()`: 向特定用户广播任务的创建、更新或删除事件。
- `function broadcastUserLog()`: 向特定用户广播新的日志条目。

---

### `server/Utils/logger.ts`

**Purpose:** 此文件提供了一个可配置的单例日志记录器。它支持多种日志级别（DEBUG, INFO, WARN, ERROR），可以从环境变量中加载配置。日志可以输出到控制台，也可以选择性地写入文件，并支持日志文件的自动轮换。

**Key Exports:**
- `class Logger`: 实现日志功能的类。
- `const logger`: `Logger` 类的一个单例实例，供整个应用程序使用。
- `enum LogLevel`: 定义了可用的日志级别。
