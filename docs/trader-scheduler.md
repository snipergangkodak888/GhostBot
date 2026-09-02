# Trader Scheduler

GhostBot's trader scheduler is a management-scoped Telegram Mini App backed by revisioned weekly schedule snapshots.

## Access model

- `/shift`, `/shift today`, `/shift tomorrow`, `/shift week`, and `/myshift` are read-only.
- `/schedule` works for every current member inside a chat configured with `/setchat management`; separate Guard enrollment is not required for scheduler access.
- The shared group callback verifies live Telegram membership, creates a one-time grant tied to that person and Management Chat, then sends the Mini App launcher by DM. Telegram only permits Bot API `web_app` buttons in private chats, so the group post is the shared entry point while authentication remains per-person.
- The one-time launcher remains valid for 24 hours. Once opened, the `schedule_editor` session lasts seven days; authorization is still rechecked against the current Management Chat and GhostBot admin state on every API request.
- GhostBot admins can run `/schedule` directly in the bot DM. Management Chat members use the shared group entry point.
- Schedule APIs independently verify the signed session, current Telegram membership, and source Management Chat profile on every request. Removing someone from Management Chat removes planner access immediately. This exception applies only to the trader scheduler; other management and finance actions remain Guard/admin-scoped.

## Data and publishing

Run `pnpm db:init` after deployment to apply the scheduler tables in `supabase/schema.sql`.

Each `trader_schedule_weeks` row contains an editable draft and the last published snapshot. Dragging and saving never changes bot output. Publishing recompiles coverage, blocks any admin gap, checks the expected draft revision, and atomically replaces the published snapshot.

The compiled snapshot contains coverage slices: compact time ranges during which the active admin/trader/support composition is unchanged. Bot status commands use those slices rather than reconstructing overlap on every request.

Set `SCHEDULE_SESSION_SECRET` to a dedicated long random value in local and production environments.

## Initial roster and schedule

The first read seeds Litwick, Cazam, Ray, Bands, Moo, and Memo. Litwick, Cazam, and Bands are operational-admin eligible. The weekday pattern mirrors the supplied schedule. Saturday and Sunday give Bands and Moo twelve-hour trading shifts, with Cazam and Litwick covering the weekend evening admin windows.

Trader Telegram IDs can be linked from the planner's Roster editor; this enables `/myshift`.

## Verification

```bash
pnpm bot:test:schedule
pnpm exec tsc --noEmit
pnpm build
```
