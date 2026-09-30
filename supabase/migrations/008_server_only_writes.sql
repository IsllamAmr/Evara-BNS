-- Attendance and request mutations must pass through the Node API.
-- Apply this after 007_atomic_request_quota_enforcement.sql, then deploy the matching server code.

revoke all on function public.check_in(text, text) from public, anon, authenticated;
revoke all on function public.check_out(text, text) from public, anon, authenticated;

drop policy if exists attendance_admin_insert on public.attendance;
drop policy if exists attendance_admin_update on public.attendance;
drop policy if exists attendance_admin_delete on public.attendance;
drop policy if exists employee_requests_insert_self on public.employee_requests;
drop policy if exists employee_requests_admin_manage on public.employee_requests;

create or replace function public.check_in_server(
  p_user_id uuid,
  p_ip_address text default null,
  p_device_info text default null
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.attendance;
  current_timestamp_utc timestamptz := now();
  business_date date := (now() at time zone 'Africa/Cairo')::date;
begin
  if p_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id and is_active and status <> 'inactive'
  ) then
    raise exception 'Inactive accounts cannot submit attendance';
  end if;

  select * into current_row
  from public.attendance
  where user_id = p_user_id and attendance_date = business_date
  for update;

  if found and current_row.check_in_time is not null then
    raise exception 'You have already checked in today';
  end if;

  if found then
    update public.attendance
    set check_in_time = current_timestamp_utc,
        attendance_status = 'present',
        ip_address = coalesce(p_ip_address, ip_address),
        device_info = coalesce(p_device_info, device_info)
    where id = current_row.id
    returning * into current_row;
  else
    insert into public.attendance (
      user_id, attendance_date, check_in_time, attendance_status, ip_address, device_info
    ) values (
      p_user_id, business_date, current_timestamp_utc, 'present', p_ip_address, p_device_info
    ) returning * into current_row;
  end if;

  return current_row;
end;
$$;

create or replace function public.check_out_server(
  p_user_id uuid,
  p_ip_address text default null,
  p_device_info text default null
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.attendance;
  current_timestamp_utc timestamptz := now();
  business_date date := (now() at time zone 'Africa/Cairo')::date;
begin
  if p_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id and is_active and status <> 'inactive'
  ) then
    raise exception 'Inactive accounts cannot submit attendance';
  end if;

  select * into current_row
  from public.attendance
  where user_id = p_user_id and attendance_date = business_date
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
      device_info = coalesce(p_device_info, device_info)
  where id = current_row.id
  returning * into current_row;

  return current_row;
end;
$$;

revoke all on function public.check_in_server(uuid, text, text) from public, anon, authenticated;
revoke all on function public.check_out_server(uuid, text, text) from public, anon, authenticated;
grant execute on function public.check_in_server(uuid, text, text) to service_role;
grant execute on function public.check_out_server(uuid, text, text) to service_role;
