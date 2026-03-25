set check_function_bodies = off;

create table if not exists public.employee_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('late_2_hours', 'annual_leave')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  late_date date null,
  leave_start_date date null,
  leave_end_date date null,
  leave_days integer null,
  reason text null,
  admin_note text null,
  reviewed_by uuid null references public.profiles(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_requests_payload_shape check (
    (
      request_type = 'late_2_hours'
      and late_date is not null
      and leave_start_date is null
      and leave_end_date is null
      and leave_days is null
    )
    or
    (
      request_type = 'annual_leave'
      and late_date is null
      and leave_start_date is not null
      and leave_end_date is not null
      and leave_end_date >= leave_start_date
      and leave_days is not null
      and leave_days > 0
      and leave_days = (leave_end_date - leave_start_date + 1)
    )
  ),
  constraint employee_requests_reviewer_timestamp check (
    reviewed_by is null or reviewed_at is not null
  )
);

create index if not exists idx_employee_requests_user_created_at
  on public.employee_requests(user_id, created_at desc);

create index if not exists idx_employee_requests_status
  on public.employee_requests(status);

create index if not exists idx_employee_requests_type_created_at
  on public.employee_requests(request_type, created_at desc);

create unique index if not exists idx_employee_requests_unique_late_day
  on public.employee_requests(user_id, late_date)
  where request_type = 'late_2_hours';

alter table public.employee_requests enable row level security;

drop policy if exists employee_requests_select_self on public.employee_requests;
create policy employee_requests_select_self
on public.employee_requests
for select
to authenticated
using (user_id = auth.uid() and public.is_current_user_active());

drop policy if exists employee_requests_select_admin on public.employee_requests;
create policy employee_requests_select_admin
on public.employee_requests
for select
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists employee_requests_insert_self on public.employee_requests;
create policy employee_requests_insert_self
on public.employee_requests
for insert
to authenticated
with check (user_id = auth.uid() and public.is_current_user_active());

drop policy if exists employee_requests_admin_manage on public.employee_requests;
create policy employee_requests_admin_manage
on public.employee_requests
for all
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active())
with check (public.get_my_role() = 'admin' and public.is_current_user_active());

drop trigger if exists set_employee_requests_updated_at on public.employee_requests;
create trigger set_employee_requests_updated_at
before update on public.employee_requests
for each row
execute function public.set_updated_at();
