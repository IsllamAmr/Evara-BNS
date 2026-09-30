-- QR-only attendance settings and Excel timesheet export log.
-- Apply after 009_checkout_work_notes.sql and before deploying the matching server code.
-- Both tables are read and written only by the Node API (service role); browsers have no access.

begin;

create table if not exists public.attendance_settings (
  id smallint primary key default 1 check (id = 1),
  -- Secret embedded in the printed office QR. Rotating it invalidates every old printout.
  qr_token text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  -- When true, check-in/check-out is accepted only from allowed_networks.
  require_office_network boolean not null default true,
  -- Exact IPs (41.33.10.5), prefixes (192.168.1.*) or IPv4 CIDR ranges (10.0.0.0/24).
  allowed_networks text[] not null default '{}',
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint attendance_settings_token_length check (char_length(qr_token) between 16 and 128)
);

insert into public.attendance_settings (id) values (1) on conflict (id) do nothing;

alter table public.attendance_settings enable row level security;
revoke all on table public.attendance_settings from anon, authenticated;

create table if not exists public.timesheet_exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  exported_by uuid null references public.profiles(id) on delete set null,
  exported_at timestamptz not null default now(),
  constraint timesheet_exports_period check (period_to >= period_from)
);

create index if not exists idx_timesheet_exports_user_exported_at
  on public.timesheet_exports(user_id, exported_at desc);

alter table public.timesheet_exports enable row level security;
revoke all on table public.timesheet_exports from anon, authenticated;

commit;
