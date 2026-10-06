-- Check-out reminders (Web Push).
-- push_subscriptions holds each device an employee enabled reminders on; it is read
-- and written only by the server (service role), so no client policies are granted.
-- attendance.checkout_reminder_sent_at makes sure a shift is reminded at most once.

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz null
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

alter table public.attendance
  add column if not exists checkout_reminder_sent_at timestamptz null;

-- Open shifts are what the reminder job scans every 30 minutes.
create index if not exists attendance_open_shifts_idx
  on public.attendance (attendance_date)
  where check_in_time is not null and check_out_time is null;
