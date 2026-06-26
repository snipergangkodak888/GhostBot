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
cp .env.example .env.local
```

Fill in `.env.local`.

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

## Useful scripts

```bash
pnpm dev       # run locally
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
