# GhostBot

GhostBot is a Next.js 14 Telegram operations app for an internal MM team. The current app is focused on project tracking, launch calendars, reminders, payroll, documents/sheets, Telegram bot workflows, and admin controls.

The codebase uses Supabase as the data store. Application data is saved through a Mongo-style adapter in `lib/db.ts`, while the actual Supabase schema is defined in `supabase/schema.sql`.

## Active features

- Public landing page
- Telegram mini-app login
- User dashboard:
  - overview
  - projects
  - calendar
  - reminders
  - payroll
  - data/sheets
- Admin dashboard:
  - overview
  - projects
  - calendar
  - reminders
  - payroll
  - guard team invite codes
  - bot alerts/broadcasts
  - trader channels
  - settings
  - cron jobs
  - backup/reset tools
  - app version/cache release
- Telegram bot webhook for ops commands
- Supabase-backed documents, projects, payroll, reminders, sheets, settings, users, admin accounts, and logs

## Project structure

```text
app/                  Next.js pages, layouts, and API routes
app/admin/            Admin login and admin dashboard routes
app/dashboard/        Telegram mini-app dashboard routes
app/api/              Backend API routes used by the active UI and Telegram bot
components/           Active shared UI and admin components
contexts/             React providers for admin settings and dashboard navbar state
hooks/                Active React hooks
lib/                  Database adapter, auth, ops bot, payroll, Supabase, Telegram helpers
public/Sources/       Text source docs used by the ops AI helper
public/logos/         Current app logo
scripts/              Database setup script
supabase/schema.sql   Supabase schema
```

## Requirements

- Node.js 18 or newer
- pnpm
- Supabase project
- Telegram bot token

## Local setup

Install dependencies:

```bash
pnpm install
```

Create your local environment file:

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` with the development Supabase project, development Telegram bot, admin, and cron values. Do not use production Supabase or Telegram credentials locally.

Required Supabase values:

```env
SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_POOLER_DATABASE_URL=postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
```

For Railway, use the Supabase Session pooler URI for `SUPABASE_POOLER_DATABASE_URL`.

Important pooler details:

- username should be `postgres.PROJECT_REF`
- host should end with `.pooler.supabase.com`
- port should be `5432`
- password should be the Supabase database password

Create/update the Supabase schema:

```bash
pnpm db:init
```

This runs `scripts/init-db.mjs`, applies `supabase/schema.sql`, and creates the default admin account from:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
```

Start the app:

```bash
pnpm dev
```

Open:

```text
http://localhost:3000
```

## Local Telegram bot testing

Telegram requires an HTTPS webhook, so local bot testing uses ngrok in front of the Next.js server. The automated runner handles the full flow:

1. Starts ngrok for port 3000.
2. Reads the current public HTTPS URL from ngrok.
3. Updates `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`, and `APP_BASE_URL` in `.env.local`.
4. Starts Next.js after the URL has been updated.
5. Registers `/api/telegram/webhook` with the development Telegram bot.
6. Starts the local ops cron pinger so scheduled reminders are delivered.

Prerequisites:

- Install ngrok and connect it to your account with an auth token.
- Configure `.env.local` with the development bot token and username.
- Keep port 3000 free before starting the runner.

Run everything with one command:

```bash
npm run dev:bot
```

Wait for `GhostBot is ready`, then message the development bot. In a group, use a slash command or mention the bot, for example:

```text
@your_dev_bot_username remind us in 2 minutes to test group delivery
```

Press `Ctrl+C` once to stop Next.js, ngrok, and the cron pinger together.

On the free ngrok flow, the public URL can change each time. The runner updates the local environment and Telegram webhook automatically, so no manual copying is required. If the ngrok account has a reserved hostname, set it in `.env.local` without a protocol:

```env
NGROK_URL=your-reserved-domain.ngrok.app
```

The same `npm run dev:bot` command will request that hostname instead of a temporary one.

If startup says port 3000 is already in use, stop the older Next.js process before running the command again.

## Telegram Bot Lab

Bot Lab runs realistic Telegram updates through the same webhook, routing, database, and AI code while capturing outgoing Telegram API calls locally. It does not register a webhook, need ngrok, or send messages to Telegram.

Start an interactive conversation:

```bash
pnpm bot:lab
```

Enter normal Telegram messages at the `you>` prompt. Bot Lab also supports:

```text
:click 1   click the first inline button in the latest response
:reset     clear the lab identity's conversation logs and pending state
:events    show the captured Telegram API methods
:help      show lab help
:exit      stop
```

Send one message non-interactively, which is useful when testing from Codex or a terminal script:

```bash
pnpm bot:lab -- "/projects"
```

Use `--group` or `--supergroup` to simulate a group chat. Override the stable test identity with `--telegram-id` and `--chat-id` when testing multiple independent conversations.

Run the reusable conversation smoke tests:

```bash
pnpm bot:test
```

Scenarios live in `tests/telegram-bot.scenarios.json`. Bot Lab only runs through a localhost request in Next.js development mode. It bypasses Guard access for the synthetic user, but all normal bot behavior—including confirmed mutations—uses the configured development database. `:reset` clears conversation state; it does not undo confirmed data changes.

The real Telegram development flow remains available through `pnpm dev:bot` for final end-to-end checks.

### Reminder timezones

GhostBot stores each Guard member's preferred IANA timezone. Members can set it in Telegram with `/timezone`, `/timezone Europe/London`, or the inline timezone buttons. The Mini App detects the device timezone and asks the member to confirm it on first use.

An explicit timezone in reminder text always overrides the saved preference:

```text
@your_bot remind the team tomorrow at 9am PT to review launches
@your_bot remind the team Friday at 3pm Europe/London to join the call
```

Times are converted to UTC for scheduling while the original IANA timezone is retained for confirmations, delivery labels, and DST-safe daily or weekly recurrence. Relative durations such as `in 20 minutes` do not require a timezone.

## Useful scripts

```bash
pnpm dev       # run locally
pnpm dev:bot   # run local app + ngrok + Telegram webhook + reminder cron
pnpm bot:lab   # interactive local Telegram simulator
pnpm bot:test  # scripted local conversation checks
pnpm dev:cron  # run only the local reminder cron pinger
pnpm build     # production build
pnpm start     # start production build
pnpm db:init   # create/update Supabase schema and seed default admin/settings
```

## Deployment

### Railway

Railway uses `railway.json`:

```json
{
  "deploy": {
    "preDeployCommand": "pnpm db:init"
  }
}
```

Add the same variables from `.env.example` to Railway service variables.

After deploy, check:

- `/api/health` returns `status: "ok"`
- the pre-deploy logs show `[init-db] Ensured Supabase schema`
- `/admin/login` works with the configured admin account

### Vercel

Vercel uses `vercel.json` for the Next.js build and cron routes. Add the same environment variables in Vercel project settings.

## Telegram setup

Set these values:

```env
TELEGRAM_BOT_TOKEN=your-bot-token
NEXT_PUBLIC_BOT_USERNAME=your_bot_username
NEXT_PUBLIC_BASE_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com
APP_BASE_URL=https://your-domain.com
```

The main Telegram routes are:

- `/api/telegram/auth`
- `/api/telegram/webhook`
- `/api/telegram/set-webhook`

You can connect the webhook from the admin settings page.

## Active API groups

- `/api/admin/*` for admin auth, settings, channels, broadcasts, backup, cron, guard team, profile, and search
- `/api/ops/*` for projects, reminders, payroll, sheets, documents, notes, and summary data
- `/api/telegram/*` for Telegram auth and bot webhook setup
- `/api/cron/*` for scheduled jobs
- `/api/public-settings` for landing/admin login branding
- `/api/user/invite-member` for guard team invite codes from the Telegram dashboard
- `/api/health` for deployment health checks

## Data model

The app stores documents in one Supabase table:

- table: `documents`
- columns: `collection`, `id`, `data`, `created_at`, `updated_at`

Collections such as `users`, `admins`, `settings`, `opsProjects`, `opsReminders`, `opsPayroll`, `opsSheets`, and `opsDocs` are stored inside that table through `lib/db.ts`.

## Cleanup notes

This repository has been trimmed to the current ops app. Old mini-game, gift, payment, TON wallet, NFT/proxy, prediction, coupon, rank, withdrawal, and old scratch/test files were removed because they are not reachable from the current frontend and are not called by active backend flows.

Do not commit `.env.local` or real keys. Use `.env.example` as the template.
