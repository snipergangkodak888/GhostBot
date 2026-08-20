# GhostBot Backlog

Items to add or fix, roughly in priority order.

---

## Production launch & environments (do first)

Goal: **real data on Railway/prod**, **fake/safe data locally**, without cross-contamination.

### Local vs prod workflow

| | Local dev | Production (Railway) |
|---|-----------|----------------------|
| Env file | `.env.local` (never commit) | Railway service variables |
| Template | `.env.local.example` | `.env.example` |
| Supabase | **Dev project** (second free project) | **Prod project** |
| Telegram bot | **Dev bot** via @BotFather | **Prod bot** (different token) |
| App URL | `http://localhost:3000` | Railway public URL |
| DB init | `pnpm db:init` (against dev) | Railway `preDeployCommand` runs `pnpm db:init` |
| Safety check | `pnpm env:check` | Set `APP_ENV=production` on Railway |

**Why two Telegram bots?** One bot token = one webhook URL. If local dev registers a webhook, production stops receiving updates (and vice versa).

**Why two Supabase projects?** The app has no built-in dev/prod switch — whatever `SUPABASE_*` keys you use *is* the database you read/write.

**Day-to-day process:**

1. Copy `.env.local.example` → `.env.local`, fill dev Supabase + dev bot values.
2. Set `PRODUCTION_SUPABASE_PROJECT_REF` to your prod Supabase ref (safety guard only).
3. Run `pnpm env:check` — must pass before `pnpm dev`.
4. Run `pnpm db:init` once against dev Supabase.
5. Code locally against dev data only.
6. Push to Railway — prod uses Railway env vars, prod Supabase, prod bot.
7. After prod deploy: set webhook from admin settings (prod bot → prod URL).
8. Download backup from `/admin/backup` after prod is seeded.

**Optional later:** seed script for fake dev data (example project, test users) so local never starts empty.

---

### P1. Wire production Supabase on Railway

**Problem:** App needs prod Supabase credentials in Railway, not in `.env.local`.

**Checklist:**

- [ ] Create **production** Supabase project
- [ ] Add all vars from `.env.example` to Railway service
- [ ] Set `APP_ENV=production`
- [ ] Set `SUPABASE_POOLER_DATABASE_URL` (Session pooler URI from Supabase Connect)
- [ ] Deploy — confirm logs show `[init-db] Ensured Supabase schema`
- [ ] Hit `/api/health` — `backend.configured: true`
- [ ] Log in at `/admin/login` with configured `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- [ ] Change default admin password immediately

---

### P2. Create dev Supabase + local env

**Problem:** Local dev must not touch production data.

**Checklist:**

- [ ] Create **development** Supabase project (separate from prod)
- [ ] Copy `.env.local.example` → `.env.local`
- [ ] Fill dev Supabase keys + `PRODUCTION_SUPABASE_PROJECT_REF` (prod ref for guard)
- [ ] Create **dev Telegram bot** (separate from prod)
- [ ] Run `pnpm env:check` then `pnpm db:init`
- [ ] Run `pnpm dev` — confirm admin login works against dev DB

---

### P3. Connect production Telegram bot

**Problem:** Bot won't respond until webhook points at the live Railway URL.

**Checklist:**

- [ ] Set prod `TELEGRAM_BOT_TOKEN` and `NEXT_PUBLIC_BOT_USERNAME` on Railway
- [ ] Set prod `NEXT_PUBLIC_BASE_URL` / `APP_BASE_URL` to Railway URL
- [ ] Deploy, then connect webhook from **admin → settings** (or `/api/telegram/set-webhook`)
- [ ] DM the prod bot — confirm `/menu` responds
- [ ] Create guard invite code in admin — test mini-app login
- [ ] Do **not** point prod bot webhook at localhost

---

### P4. Initial production backup + cron

**Problem:** No recovery path or scheduled ops jobs after go-live.

**Checklist:**

- [ ] After seeding prod data, download backup from `/admin/backup`
- [ ] Schedule `/api/cron/ops?secret=<CRON_SECRET>` every 10 min on Railway (see item 2 below)
- [ ] Weekly backup habit before payroll runs

---

### P5. Protect `/api/ops/*` routes (before public exposure)

**Problem:** Ops API routes have no server-side auth — UI gating only. Fine for obscurity; risky if URL is public.

**Fix:** Require admin cookie or active `guardMembers` session on mutating routes; read-only GET can stay team-gated.

---

## High priority

### 1. Group chat: require @mention or slash commands

**Problem:** In groups/supergroups, any message from an authorized member triggers the bot (`routeText` runs on every text message). Normal team chatter causes unwanted replies and AI calls.

**Desired behavior:**

| Context | Should respond? |
|---------|-----------------|
| DM with bot | Yes — all messages (current behavior) |
| Group + `/command` or `/command@BotName` | Yes |
| Group + `@BotName natural language question` | Yes |
| Group + plain text with no @mention | **No — ignore silently** |
| Group + reply keyboard buttons (🏠 Home, etc.) | Optional: ignore in groups, or require @mention prefix |

**Implementation notes:**

- Gate in `app/api/telegram/webhook/route.ts` before `routeText()`.
- Check `message.chat.type` (`group` / `supergroup` vs `private`).
- For slash commands: accept if text starts with `/` (Telegram already routes `/cmd@botname` correctly).
- For @mentions: inspect `message.entities` for `type: "mention"` matching `@${NEXT_PUBLIC_BOT_USERNAME}` (case-insensitive), or text prefix `@BotName`.
- Still call `hostGroupIfAllowed()` on first authorized message so cron notifications keep working — but only register the group, don't route casual chat.
- Callback queries (inline Confirm/Refuse buttons) should still work in groups without re-mentioning.

---

### 2. Schedule ops cron reliably

**Problem:** Reminders, launch alerts, and the daily performance report depend on `/api/cron/ops`, which is **not** in `vercel.json`. If nothing hits that endpoint every ~5–15 minutes, notifications never fire.

**Fix:** Add to `vercel.json` or Railway cron, e.g. every 10 minutes:

```
GET /api/cron/ops?secret=<CRON_SECRET>
```

Document in README / admin cron page.

---

### 3. Daily report at a fixed time

**Problem:** Daily performance digest sends on the **first cron run of each EST day**, not at a predictable hour (e.g. 8:00 AM EST).

**Fix:** In `lib/ops-cron.ts` → `processDailyPerformance`, only send when current EST time is within a window (e.g. 08:00–08:15) instead of any first run.

---

## Medium priority

### 4. Fix `/setreminder` recurrence value

**Problem:** Bot sets `recurrence: "once"`, but `nextDueAt()` only handles `hourly` / `daily` / `weekly`. Works as one-shot today (status → `done`), but the value is inconsistent with the schema.

**Fix:** Use `recurrence: "none"` everywhere for one-shot reminders.

---

### 5. Reminder confirmation should show due time in EST

**Problem:** After adding a reminder via bot form, user only sees "✅ Reminder added." — no echo of parsed due time/timezone.

**Fix:** Reply with the scheduled EST time so mis-parsed dates are obvious.

---

### 6. Remove or isolate legacy game cron

**Problem:** `app/api/cron/notifications/route.ts` + `vercel.json` entries (`daily-energy`, `inactivity`, etc.) reference removed mini-game features.

**Fix:** Delete dead cron types or remove from `vercel.json` to avoid confusion and wasted invocations.

---

### 7. AI action: parse relative dates for reminders

**Problem:** `create_reminder` via AI depends on the model outputting a valid ISO `dueAt`. "tomorrow at 3pm" often fails or defaults to +1 hour.

**Fix:** Post-process `dueAt` with a small date parser (chrono-node or explicit rules) before showing the confirm preview.

---

### 8. Rate-limit / dedupe AI calls in groups

**Problem:** Even with @mention, multiple people @'ing the bot in quick succession burns API credits.

**Fix:** Per-chat cooldown (e.g. 3s) or queue; log cost in admin.

---

### 9. Chat-targeted reminders (management + trade floor)

**Problem:** Reminders are **team-wide** today. Cron sends every due reminder to **all active members (DM) + all hosted groups**. We only need delivery to **two internal groups** — not per-project chats:

- **Management** (internal ops chat)
- **Trade floor**

No project-linked default chats. No bot in project-specific groups.

**Desired behavior:**

| Created from | Delivery |
|--------------|----------|
| **Admin / dashboard app** | User picks target chat in form (required) |
| **Bot in a group** (optional) | That group only |
| **Bot in DM** | Creator's DM only |

**Hosted groups setup:**

- Bot lives only in Management + Trade Floor (plus DMs).
- Handle `my_chat_member` in webhook → auto-register groups in `opsHostedGroups` when bot is added.
- Admin can rename groups in UI for clarity (e.g. "Management", "Trade Floor").
- On bot removed → `status: "inactive"`.

**Reminder form (admin + dashboard):**

Add **Deliver to** dropdown — required when creating from app:

```
Deliver to:  [ Management          ▼ ]
             ├─ Management
             ├─ Trade Floor
             └─ Team broadcast (all chats + DMs)   ← optional, use sparingly
```

- Populate from active `opsHostedGroups` (friendly title, not raw chat ID).
- Store `telegramChatId` + `deliveryScope: "chat" | "team"`.
- Show selected chat on reminder list cards (e.g. "→ Trade Floor").

**Schema (`opsReminders`):**

```ts
deliveryScope: "chat" | "team"       // app default: "chat"
telegramChatId: string              // required when scope is "chat"
targetChatTitle?: string             // display label
```

**Cron (`lib/ops-cron.ts` → `processDueReminders`):**

- `deliveryScope === "chat"` → send **only** to `telegramChatId` (no DMs, no other groups)
- `deliveryScope === "team"` → current broadcast (all members + all hosted groups)

**Out of scope for v1:**

- Per-project default chat
- Bot in project launch groups
- Individual DM delivery from app (unless added later)

**Acceptance criteria:**

- Reminder created in app with "Trade Floor" selected fires only in Trade Floor.
- Reminder created with "Management" fires only in Management.
- Daily/calendar cron broadcasts can stay team-wide separately (unchanged) or get same picker later.
- Only two hosted groups appear after bot is added to both chats.

---

### 10. Treasury expense ledger and live USDC balance

**Problem:** Treasury allocations are already recorded through payroll. What is missing is a simple ledger of USDC spent from treasury and a way to see the treasury wallet's current on-chain USDC balance.

Treasury inflows must not be duplicated in this feature. Payroll remains the source of truth for treasury allocations, the treasury expense ledger records labeled USDC expenses, and Solana RPC is the source of truth for the current USDC balance and transaction verification.

The current balance must not be calculated as payroll allocations minus expenses because starting funds, deposits, and unrecorded transfers can make that calculation inaccurate.

**Data model (new standalone collection `treasuryExpenses`):**

```ts
{
  treasuryAccountId: string,          // FK to payrollAccounts SYSTEM_TREASURY
  wallet: string,                     // treasury wallet when the expense was recorded
  date: "YYYY-MM-DD",
  label: string,                      // e.g. "Volume bot" or "Server renewal"
  amountUsdc: number,
  transactionSignature?: string | null,
  transactionUrl?: string | null,
  verificationStatus: "verified" | "manual",
  createdFrom: "bot" | "admin" | "app",
  createdByTelegramId?: number,
  createdAt: Date,
  updatedAt: Date
}
```

Store USDC values with six-decimal precision and use integer base units internally where calculations require exact arithmetic. Enforce transaction-signature uniqueness so a transaction cannot be imported twice.

**Treasury service:**

- Find the configured `SYSTEM_TREASURY` account and owner wallet.
- Fetch and sum that wallet's token-account balances for the configured USDC mint through `SOLANA_RPC_URL`.
- Accept a Solscan transaction URL or raw Solana transaction signature.
- Verify through RPC that the configured treasury wallet sent the configured USDC mint.
- Extract the transaction date, net USDC outflow, signature, and Solscan URL.
- Reject SOL transfers, other tokens, duplicate signatures, swaps, and transactions that cannot be confidently interpreted as a straightforward outbound USDC transfer.
- Create and list expenses, grouped by day with daily USDC totals.
- Keep expense history available if RPC is unavailable; show the live balance as temporarily unavailable rather than zero.

**Expense entry:**

- **Verified import:** User submits a Solscan transaction URL or signature. RPC prefills the date and USDC amount; the user supplies only a short label.
- **Manual entry:** User supplies a date, USDC amount, and label. A signature may be attached for reference, but the record remains `manual` unless RPC verification succeeds.
- USDC is fixed for this feature. There is no asset or currency selector, and SOL network fees are not treasury expenses.

**Bot commands:**

| Command | Behavior |
|---------|----------|
| `/treasury` | Show live USDC balance, today's logged expense total, and recent expenses |
| `/treasury expenses` | Show recent expenses grouped by day |
| `/treasury expenses today` | Show today's expenses and total |
| `/treasury expenses YYYY-MM-DD` | Show expenses for a specific day |
| `/treasury expense` | Start a guided manual-entry or transaction-import flow |

The guided import flow accepts either a Solscan URL or raw signature, previews the verified USDC transfer, asks for a label, and requires confirmation before saving.

**Chat gating:**

- Gate every treasury command, callback, and in-progress expense flow to an explicit allowlist of Telegram chat IDs.
- Use the existing `opsHostedGroups` records to identify active group chat IDs.
- Keep the treasury allowlist separate from general bot/team access so other bot commands continue to work normally in other chats.
- Return a short "Treasury commands are not enabled in this chat" response when `/treasury` is used elsewhere; do not reveal the balance or expense data.
- Decide separately whether authorized direct-message chat IDs are permitted. Do not assume that general bot access grants treasury access.

**Dashboard and admin:**

Add a Treasury panel with:

- Live USDC balance, clearly labeled as on-chain.
- Today's and this month's logged USDC expense totals.
- Expense history grouped by date.
- Manual-entry and transaction-import actions.
- Date, label, USDC amount, verification status, and Solscan link on each row.
- Label editing and authorized deletion. Verified on-chain facts must not be editable.

**API:**

- Fetch the live USDC balance and expense summary.
- List expenses by date.
- Create a manual expense.
- Preview and verify a submitted transaction.
- Confirm and save a verified import.
- Edit an expense label.
- Delete an expense with appropriate authorization.

Do not store treasury expenses in `ledgerTransactions`. Resaving a payroll day currently rebuilds that date's payroll transactions, so the expense ledger must remain isolated and payroll behavior must remain unchanged.

**Configuration:**

```text
SOLANA_RPC_URL=
USDC_MINT_ADDRESS=
TREASURY_ALLOWED_TELEGRAM_CHAT_IDS=
```

The treasury owner wallet continues to come from the existing `SYSTEM_TREASURY` payroll account. If the account, wallet, RPC endpoint, USDC mint, or allowed chat configuration is missing, return a clear setup message rather than a zero balance or unrestricted access.

**Authorization and audit rules:**

- Only authorized team members in an allowed chat can create or import expenses.
- Bot-created records store the Telegram user ID.
- Imported transaction facts cannot be changed after verification; only the label may be edited.
- Duplicate transaction signatures are rejected.
- Deleting an expense removes only the internal ledger record and never affects the on-chain transaction.

**Out of scope for v1:**

- Duplicating treasury inflows from payroll.
- Calculating wallet balance from internal records.
- Automatically syncing complete wallet history.
- Tracking SOL or tokens other than the configured USDC mint.
- Parsing swaps, routed transfers, or complex DeFi transactions.
- Payroll-to-wallet reconciliation.
- Vendor, category, notes, project, or currency fields.
- Counting generic project expense-sheet rows as treasury expenses.

**Acceptance criteria:**

- `/treasury` shows the live USDC balance for the configured treasury wallet only in allowed chats.
- Treasury data is not disclosed and treasury actions cannot continue through commands or callbacks in other chats.
- An authorized user can record a manual expense using a USDC amount and label.
- A straightforward outbound USDC transfer can be imported from a Solscan URL or signature and verified through RPC.
- Other token mints and duplicate signatures are rejected.
- Expenses are displayed by day with daily USDC totals in the bot and Treasury panel.
- Payroll calculations and storage remain unchanged, and resaving payroll cannot delete treasury expenses.
- RPC failures do not prevent access to previously recorded expense history.

---

## Lower priority / nice to have

### 11. Conversation memory (optional, scoped)

**Problem:** Each AI call is stateless — no follow-up ("what about last week?" after asking about profit).

**Fix:** Store last N turns per `telegramId` in `opsBotStates` or a new collection; inject into `answerWithAi` context. Keep short TTL (e.g. 30 min).

---

### 12. Admin UI for `opsBotLogs` and `opsAiActions`

**Problem:** Q&A and pending AI actions are logged to DB but not visible in admin.

**Fix:** Read-only admin pages to audit bot behavior and debug bad AI proposals.

---

### 13. Webhook: ignore `edited_message` for routing (or handle explicitly)

**Problem:** Edited messages re-enter `routeText` and can double-fire actions.

**Fix:** Only process `message`, or dedupe by `message_id` + edit date.

---

### 14. Group privacy mode docs

**Problem:** If bot is added with privacy mode on, it only sees commands and @mentions anyway — but behavior differs from privacy off.

**Fix:** Document recommended BotFather settings (`/setprivacy`) to match desired group behavior.

---

## AI architecture (decision item)

### Should we add OpenAI native tool calling?

**Current approach (keep unless you hit limits):**

1. User message → keyword gate (`isActionRequest`)
2. One LLM call → returns JSON `{ actionType, payload }`
3. Server validates, previews, stores in `opsAiActions`
4. User taps Confirm → **TypeScript** runs `executeOpsAiAction()` (never the LLM)

This is intentionally **human-in-the-loop**. The model proposes; code executes. Good for ops mutations where mistakes are costly.

**OpenAI tool calling would help if you need:**

- Multi-step flows in one turn ("create project X, add income row, schedule reminder")
- Model choosing between many tools dynamically without maintaining JSON schema prompts
- Follow-up tool rounds (query DB → summarize → act)

**OpenAI tool calling is NOT needed if:**

- Single-action confirms are enough (current)
- You want strict control over what can be mutated (current allowlist in `executeOpsAiAction`)
- Cost/latency should stay minimal (one call vs. agent loop)

**Recommendation:** Stay on current JSON + confirm for mutations. Consider tool calling only if you add a true multi-step agent (e.g. "reconcile this week's payroll across all projects") — and still keep confirm for destructive ops.

**Smaller win before tool calling:** Improve `resolveActionPreview` + date parsing + @mention gating (items 1, 7 above).

---

## Quick reference: current AI decision flow

```
Message
  → isActionRequest? (add/create/delete/schedule…)
      → YES → proposeOpsAiAction (1× LLM → JSON)
              → preview + Confirm/Refuse
              → executeOpsAiAction (hardcoded TS, no LLM)
      → NO  → answerOpsBot
              → rule match? → instant answer
              → else → answerWithAi (1× LLM → text)
```

The LLM never invokes tools itself — it only outputs structured text (JSON or prose) that your server interprets.
