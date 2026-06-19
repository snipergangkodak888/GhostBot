create table if not exists public.documents (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists documents_collection_idx
  on public.documents (collection);

create index if not exists documents_data_gin_idx
  on public.documents
  using gin (data);

create or replace function public.set_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_updated_at on public.documents;

create trigger documents_updated_at
before update on public.documents
for each row
execute function public.set_documents_updated_at();

alter table public.documents enable row level security;

drop policy if exists "service role manages documents" on public.documents;

create policy "service role manages documents"
on public.documents
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payroll_account_type') then
    create type public.payroll_account_type as enum (
      'EMPLOYEE',
      'CLIENT',
      'REFERRER',
      'SYSTEM_TREASURY'
    );
  end if;
end
$$;

alter type public.payroll_account_type add value if not exists 'REFERRER';

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.payroll_account_type not null,
  referral_id uuid null references public.accounts(id) on delete set null,
  profit_share_percentage numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounts_type_idx
  on public.accounts (type);

create index if not exists accounts_referral_id_idx
  on public.accounts (referral_id);

create table if not exists public.daily_payroll_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null unique,
  total_income numeric(14,2) not null default 0,
  total_dev_allo numeric(14,2) not null default 0,
  total_team_payroll numeric(14,2) not null default 0,
  total_referrals numeric(14,2) not null default 0,
  net_profit numeric(14,2) not null default 0,
  total_distributed numeric(14,2) not null default 0,
  inputs jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_payroll_entries_date_idx
  on public.daily_payroll_entries (entry_date);

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  daily_payroll_entry_id uuid not null references public.daily_payroll_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  transaction_date date not null,
  source text not null,
  amount numeric(14,2) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ledger_transactions_entry_idx
  on public.ledger_transactions (daily_payroll_entry_id);

create index if not exists ledger_transactions_account_date_idx
  on public.ledger_transactions (account_id, transaction_date);

alter table public.accounts enable row level security;
alter table public.daily_payroll_entries enable row level security;
alter table public.ledger_transactions enable row level security;

drop policy if exists "service role manages accounts" on public.accounts;
drop policy if exists "service role manages daily payroll entries" on public.daily_payroll_entries;
drop policy if exists "service role manages ledger transactions" on public.ledger_transactions;

create policy "service role manages accounts"
on public.accounts
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages daily payroll entries"
on public.daily_payroll_entries
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages ledger transactions"
on public.ledger_transactions
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';
