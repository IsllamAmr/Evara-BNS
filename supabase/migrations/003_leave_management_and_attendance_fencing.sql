create table if not exists public.leave_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('annual_leave', 'sick_leave', 'unpaid_leave', 'permission')),
  request_scope text not null default 'full_day' check (request_scope in ('full_day', 'partial_day')),
  start_date date not null,
  end_date date not null,
  start_time time null,
  end_time time null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note text null,
  reviewed_by uuid null references public.profiles(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint leave_requests_date_order check (end_date >= start_date),
  constraint leave_requests_partial_window check (
    (request_scope = 'full_day' and start_time is null and end_time is null)
    or
    (request_scope = 'partial_day' and start_date = end_date and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index if not exists idx_leave_requests_user on public.leave_requests(user_id, start_date desc);
create index if not exists idx_leave_requests_status on public.leave_requests(status, start_date desc);
create index if not exists idx_leave_requests_reviewed_by on public.leave_requests(reviewed_by);

drop trigger if exists set_leave_requests_updated_at on public.leave_requests;
create trigger set_leave_requests_updated_at
before update on public.leave_requests
for each row
execute function public.set_updated_at();

alter table public.leave_requests enable row level security;

drop policy if exists leave_requests_select_self on public.leave_requests;
create policy leave_requests_select_self
on public.leave_requests
for select
to authenticated
using (user_id = auth.uid() and public.is_current_user_active());

drop policy if exists leave_requests_select_admin on public.leave_requests;
create policy leave_requests_select_admin
on public.leave_requests
for select
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists leave_requests_insert_self on public.leave_requests;
create policy leave_requests_insert_self
on public.leave_requests
for insert
to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and public.is_current_user_active()
);

drop policy if exists leave_requests_cancel_self on public.leave_requests;
create policy leave_requests_cancel_self
on public.leave_requests
for update
to authenticated
using (
  user_id = auth.uid()
  and status = 'pending'
  and public.is_current_user_active()
)
with check (
  user_id = auth.uid()
  and status in ('pending', 'cancelled')
  and public.is_current_user_active()
);

drop policy if exists leave_requests_update_admin on public.leave_requests;
create policy leave_requests_update_admin
on public.leave_requests
for update
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active())
with check (public.get_my_role() = 'admin' and public.is_current_user_active());
