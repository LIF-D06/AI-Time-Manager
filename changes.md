# Changes — 2025-11-16

This file records the changes made on 2025-11-16 during development iterations.

## Summary
- Added recurrence and test utilities, moved recurrence logic into a reusable service.
- Replaced full user cache refreshes with incremental cache merging after DB writes.
- Added unit tests for schedule conflict detection and recurrence generation; configured Jest + ts-jest.
- Updated API routes and server code to use the new recurrence service and incremental cache refreshes.

## Detailed Changes (2025-11-16)

1. Added `server/Services/recurrence.ts`
   - Extracted the recurrence instance generation logic from API routes into a dedicated service.
   - Exports `generateRecurrenceInstances` and `buildRecurrenceSummary`.

2. Added unit tests and test configuration
   - `jest.config.cjs` — test config for `ts-jest` with ESM support.
   - `server/__tests__/scheduleConflict.test.ts` — tests for `server/Services/scheduleConflict.ts`.
   - `server/__tests__/recurrence.test.ts` — tests for recurrence generation.
   - Installed dev dependencies: `jest`, `ts-jest`, `@types/jest` and verified all tests pass locally.

3. Updated `server/routes/apiRoutes.ts`
   - Replaced inline recurrence generation with imports from `server/Services/recurrence`.
   - After DB writes (create/batch/update/delete/cascade), switched from `refreshUserTasks(user)` (full reload) to `refreshUserTasksIncremental(user, { addedIds?, updatedIds?, deletedIds? })` to merge only affected tasks into the in-memory cache.
   - Kept WebSocket broadcasts in place (broadcast after DB write, then incremental cache merge).

4. Updated `server/index.ts`
   - In the Exchange/timetable sync paths and `createTaskToUser`, replaced full cache refresh with `refreshUserTasksIncremental` after adding tasks.

5. `server/Services/dbService.ts`
   - The codebase already included `refreshUserTasksIncremental`; main edits used this API. `refreshUserTasks` (full reload) remains available but is no longer used in primary write paths.

6. `package.json`
   - Added `test` script (`jest`) and added `jest`, `ts-jest`, `@types/jest` to devDependencies.

7. Misc
   - Installed test dev dependencies (`npm install --save-dev jest ts-jest @types/jest`).
   - Ran `npm test` locally; both test suites passed.

## Notes & Next Steps
- `refreshUserTasks` (full reload) is still present for emergency/full reconciliation; prefer `refreshUserTasksIncremental` in normal write paths.
- Consider adding unit tests for `dbService.refreshUserTasksIncremental` to validate merge/delete/update correctness and edge cases.
- Consider adding a CI workflow to run tests on PRs.

If you need this change broken into a formal release note or added to a changelog with versioning, tell me the version string and I will format accordingly.
# Changes — 2025-11-16

This file summarizes all changes made on 2025-11-16 during the current development session.

## Summary
- Added incremental cache refresh usage across API and background sync to reduce full reloads.
- Extracted recurrence generation logic into a reusable, testable service.
- Added unit tests for schedule conflict detection and recurrence generation, and configured Jest for TS/ESM.
- Updated `package.json` to add test script and dev dependencies for Jest/ts-jest.

## Files Added
- `server/Services/recurrence.ts` — New service implementing `generateRecurrenceInstances` and `buildRecurrenceSummary` (daily/weekly, byDay support, safety limits).
- `jest.config.cjs` — Jest configuration for TypeScript + ESM (`ts-jest` preset).
- `server/__tests__/scheduleConflict.test.ts` — Unit tests for `scheduleConflict` behavior (boundary-inclusive vs exclusive, invalid dates, error throwing).
- `server/__tests__/recurrence.test.ts` — Unit tests for recurrence generation (daily, weekly+byDay, safety limits).

## Files Modified
- `server/routes/apiRoutes.ts`
  - Replaced inline recurrence generation with import from `server/Services/recurrence.ts`.
  - After DB write operations (create, batch create, update, delete/cascade), replaced full `refreshUserTasks(user)` with `refreshUserTasksIncremental(user, { addedIds?, updatedIds?, deletedIds? })` to merge only affected tasks into the in-memory cache.
  - Kept WebSocket broadcasts in place; broadcasts happen after DB writes and before incremental cache merges.

- `server/index.ts`
  - Background sync (Exchange events and timetable import) now uses incremental cache refresh after creating tasks.
  - `createTaskToUser` updated to use incremental refresh.

- `server/Services/dbService.ts`
  - Already contains `refreshUserTasksIncremental`; used by the updated call sites.
  - `refreshUserTasks` (full reload) retained for one-off full refresh needs.

- `package.json`
  - Added `test` script (`jest`) and devDependencies: `jest`, `ts-jest`, `@types/jest`.

## Commands Run (local)
```pwsh
npm install --save-dev jest ts-jest @types/jest
npm test
```

Test results: both test suites passed locally (2 test suites, 7 tests total).

## Rationale & Notes
- Incremental cache refresh reduces IO and latency for users with large task sets; DB remains the source of truth.
- Broadcasting immediately after DB commit keeps real-time behavior; incremental merge ensures eventual cache consistency.
- `refreshUserTasks` (full) is still available for recovery but is no longer used on main write paths.
- `recurrence` logic was extracted to make it unit-testable and avoid duplication in routes.
