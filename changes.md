# Changes — 2025-11-16

简要概述：
- 将重复任务生成逻辑抽取为可复用服务：`server/Services/recurrence.ts`。
- 写入路径改为“DB 写入 → 增量刷新缓存（added/updated/deleted IDs）”，替代全量 `refreshUserTasks`。
- 为冲突检测与重复生成新增单元测试；配置 Jest（TS/ESM）。
- 更新 `package.json` 增加 `test` 脚本与 dev 依赖。

主要改动：
- Files Added:
  - `server/Services/recurrence.ts`（`generateRecurrenceInstances`、`buildRecurrenceSummary`）
  - `jest.config.cjs`
  - `server/__tests__/scheduleConflict.test.ts`
  - `server/__tests__/recurrence.test.ts`
- Files Modified（节选）:
  - `server/routes/apiRoutes.ts`：改用 recurrence 服务；写入后调用 `refreshUserTasksIncremental`；保留 WebSocket 广播。
  - `server/index.ts`：Exchange/课表同步与 `createTaskToUser` 改为增量刷新。
  - `server/Services/dbService.ts`：沿用 `refreshUserTasksIncremental`；保留全量刷新以备需要。
  - `package.json`：新增测试脚本与 jest/ts-jest/@types/jest。

验证：
```pwsh
npm install --save-dev jest ts-jest @types/jest
npm test
```
结果：2 个测试套件、7 个测试，全部通过。
# Changes — 2025-11-19
 
# Changes — 2025-11-19

This section records the changes made on 2025-11-19.

## Summary
- Added per-user logging pipeline (persist + WebSocket broadcast) and public logs API.
- Instrumented user-related flows to emit logs (emails, calendar events, tasks, timetable, MS To Do pushes).
- Updated API documentation and README to cover logs and `userLog` WS event.

## Detailed Changes (2025-11-19)

1. WebSocket
   - `server/Services/websocket.ts`: added `broadcastUserLog(userId, log)` to emit `{ type:'userLog', log }`.

2. Database & Service
   - `server/Services/dbService.ts`:
     - Created `user_logs` table (id, userId, time, type, message, payload).
     - Added `addUserLog(...)` and `getUserLogsPage(...)` for writing/querying logs.
   - `server/Services/userLog.ts`:
     - Added `logUserEvent(userId, type, message, payload?)` to persist and broadcast a log.

3. API Routes
   - `server/routes/apiRoutes.ts`:
     - Added `GET /api/logs` with pagination and filters (`limit`, `offset`, `since`, `until`, `type`).
     - Instrumented create/batch create/update/complete/delete/cascade with `taskCreated`, `taskUpdated`, `taskCompleted`, `taskDeleted`, `taskConflict`, `taskError` logs.

4. Server background flows
   - `server/index.ts`:
     - Added logs for calendar events fetch (`eventsFetched`, `eventsError`), email processing (`emailProcessed`, `emailError`), MS To Do push (`msTodoPushed`, `msTodoPushError`), timetable (`timetableFetched`, `timetableError`, `timetableParseError`), and created tasks.

5. Documentation
   - `server/API.md`: documented logs API (`GET /api/logs`) and `userLog` WS event; clarified task listing params.
   - `README.md`: mentioned logs API and `userLog` event in API Documentation section.

## Examples
- WebSocket user log:
```
{ "type": "userLog", "log": { "id": "...", "time": "ISO", "type": "taskCreated", "message": "Created task ...", "payload": { /* context */ } } }
```
- HTTP logs query:
```
GET /api/logs?limit=50&offset=0&since=2025-11-19T00:00:00Z&until=2025-11-19T23:59:59Z&type=taskCreated
```
