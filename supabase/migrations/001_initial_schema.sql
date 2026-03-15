set check_function_bodies = off;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'employee')),
  is_active boolean not null default true,
  employee_code text unique,
  phone text,
  department text,
  position text,
  status text not null default 'active' check (status in ('active', 'inactive', 'on_leave')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.attendance (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null,
  check_in_time timestamptz null,
  check_out_time timestamptz null,
  attendance_status text not null default 'present' check (attendance_status in ('present', 'absent', 'late', 'checked_out')),
  ip_address text null,
  device_info text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint attendance_daily_unique unique (user_id, attendance_date),
  constraint attendance_requires_check_in_before_checkout check (check_out_time is null or check_in_time is not null),
  constraint attendance_checkout_after_checkin check (check_out_time is null or check_out_time >= check_in_time)
);

create table if not exists public.logs (
  id bigint generated always as identity primary key,
  user_id uuid null references public.profiles(id) on delete set null,
  action text not null,
  details text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_status on public.profiles(status);
create index if not exists idx_profiles_department on public.profiles(department);
create index if not exists idx_attendance_user_date on public.attendance(user_id, attendance_date desc);
create index if not exists idx_attendance_date on public.attendance(attendance_date desc);
create index if not exists idx_logs_user_id on public.logs(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_attendance_updated_at on public.attendance;
create trigger set_attendance_updated_at
before update on public.attendance
for each row
execute function public.set_updated_at();

create or replace function public.handle_auth_user_upsert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  derived_full_name text := coalesce(nullif(trim(metadata->>'full_name'), ''), split_part(new.email, '@', 1));
  derived_role text := case when metadata->>'role' in ('admin', 'employee') then metadata->>'role' else 'employee' end;
  derived_status text := case when metadata->>'status' in ('active', 'inactive', 'on_leave') then metadata->>'status' else 'active' end;
  derived_is_active boolean := case
    when metadata ? 'is_active' and metadata->>'is_active' in ('true', 'false') then (metadata->>'is_active')::boolean
    else derived_status <> 'inactive'
  end;
begin
  insert into public.profiles (
    id,
    full_name,
    email,
    role,
    is_active,
    employee_code,
    phone,
    department,
    position,
    status
  )
  values (
    new.id,
    derived_full_name,
    new.email,
    derived_role,
    derived_is_active,
    nullif(trim(metadata->>'employee_code'), ''),
    nullif(trim(metadata->>'phone'), ''),
    nullif(trim(metadata->>'department'), ''),
    nullif(trim(metadata->>'position'), ''),
    derived_status
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active,
    employee_code = excluded.employee_code,
    phone = excluded.phone,
    department = excluded.department,
    position = excluded.position,
    status = excluded.status,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_auth_user_upsert();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row
execute function public.handle_auth_user_upsert();

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_current_user_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

revoke all on function public.get_my_role() from public;
revoke all on function public.is_current_user_active() from public;
grant execute on function public.get_my_role() to authenticated;
grant execute on function public.is_current_user_active() to authenticated;

alter table public.profiles enable row level security;
alter table public.attendance enable row level security;
alter table public.logs enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
on public.profiles
for select
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active())
with check (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists attendance_select_self on public.attendance;
create policy attendance_select_self
on public.attendance
for select
to authenticated
using (user_id = auth.uid() and public.is_current_user_active());

drop policy if exists attendance_select_admin on public.attendance;
create policy attendance_select_admin
on public.attendance
for select
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists attendance_admin_insert on public.attendance;
create policy attendance_admin_insert
on public.attendance
for insert
to authenticated
with check (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists attendance_admin_update on public.attendance;
create policy attendance_admin_update
on public.attendance
for update
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active())
with check (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists attendance_admin_delete on public.attendance;
create policy attendance_admin_delete
on public.attendance
for delete
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists logs_admin_select on public.logs;
create policy logs_admin_select
on public.logs
for select
to authenticated
using (public.get_my_role() = 'admin' and public.is_current_user_active());

drop policy if exists logs_admin_insert on public.logs;
create policy logs_admin_insert
on public.logs
for insert
to authenticated
with check (public.get_my_role() = 'admin' and public.is_current_user_active());

create or replace function public.check_in(p_ip_address text default null, p_device_info text default null)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_row public.attendance;
  current_timestamp_utc timestamptz := timezone('utc', now());
  business_date date := timezone('Africa/Cairo', now())::date;
  computed_status text := case
    when timezone('Africa/Cairo', now())::time > time '09:15' then 'late'
    else 'present'
  end;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_current_user_active() then
    raise exception 'Inactive accounts cannot submit attendance';
  end if;

  select *
    into current_row
    from public.attendance
   where user_id = current_user_id
     and attendance_date = business_date
   for update;

  if found and current_row.check_in_time is not null then
    raise exception 'You have already checked in today';
  end if;

  if found then
    update public.attendance
       set check_in_time = current_timestamp_utc,
           attendance_status = computed_status,
           ip_address = coalesce(p_ip_address, ip_address),
           device_info = coalesce(p_device_info, device_info),
           updated_at = timezone('utc', now())
     where id = current_row.id
     returning * into current_row;
  else
    insert into public.attendance (
      user_id,
      attendance_date,
      check_in_time,
      attendance_status,
      ip_address,
      device_info
    )
    values (
      current_user_id,
      business_date,
      current_timestamp_utc,
      computed_status,
      p_ip_address,
      p_device_info
    )
    returning * into current_row;
  end if;

  return current_row;
end;
$$;

create or replace function public.check_out(p_ip_address text default null, p_device_info text default null)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_row public.attendance;
  current_timestamp_utc timestamptz := timezone('utc', now());
  business_date date := timezone('Africa/Cairo', now())::date;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_current_user_active() then
    raise exception 'Inactive accounts cannot submit attendance';
  end if;

  select *
    into current_row
    from public.attendance
   where user_id = current_user_id
     and attendance_date = business_date
   for update;

  if not found or current_row.check_in_time is null then
    raise exception 'You must check in before checking out';
  end if;

  if current_row.check_out_time is not null then
    raise exception 'You have already checked out today';
  end if;

  update public.attendance
     set check_out_time = current_timestamp_utc,
         attendance_status = 'checked_out',
         ip_address = coalesce(p_ip_address, ip_address),
         device_info = coalesce(p_device_info, device_info),
         updated_at = timezone('utc', now())
   where id = current_row.id
   returning * into current_row;

  return current_row;
end;
$$;

revoke all on function public.check_in(text, text) from public;
revoke all on function public.check_out(text, text) from public;
grant execute on function public.check_in(text, text) to authenticated;
grant execute on function public.check_out(text, text) to authenticated;
