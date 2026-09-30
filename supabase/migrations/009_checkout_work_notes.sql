begin;

alter table public.attendance
  add column if not exists work_notes text,
  add column if not exists work_place text,
  add column if not exists training_minutes integer;

alter table public.attendance
  add constraint attendance_work_notes_length check (work_notes is null or char_length(work_notes) <= 4000),
  add constraint attendance_work_place_length check (work_place is null or char_length(work_place) <= 120),
  add constraint attendance_training_minutes_range check (training_minutes is null or training_minutes between 0 and 1440);

-- Prevent a second shift from starting while yesterday's shift is still open.
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
  checked_in_at timestamptz := now();
  business_date date := (now() at time zone 'Africa/Cairo')::date;
begin
  if p_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and is_active and status <> 'inactive') then
    raise exception 'Inactive accounts cannot submit attendance';
  end if;
  if exists (select 1 from public.attendance where user_id = p_user_id
    and check_in_time is not null and check_out_time is null
    and check_in_time between checked_in_at - interval '24 hours' and checked_in_at
    and attendance_date <> business_date) then
    raise exception 'You must check out of your previous shift first';
  end if;

  select * into current_row from public.attendance
  where user_id = p_user_id and attendance_date = business_date for update;
  if found and current_row.check_in_time is not null then raise exception 'You have already checked in today'; end if;
  if found then
    update public.attendance
    set check_in_time = checked_in_at, attendance_status = 'present',
        ip_address = coalesce(p_ip_address, ip_address),
        device_info = coalesce(p_device_info, device_info)
    where id = current_row.id returning * into current_row;
  else
    insert into public.attendance (user_id, attendance_date, check_in_time, attendance_status, ip_address, device_info)
    values (p_user_id, business_date, checked_in_at, 'present', p_ip_address, p_device_info)
    returning * into current_row;
  end if;
  return current_row;
end;
$$;

-- Remove the old overload so an outdated API cannot check out without notes.
drop function if exists public.check_out_server(uuid, text, text);

create or replace function public.check_out_server(
  p_user_id uuid,
  p_work_notes text,
  p_ip_address text default null,
  p_device_info text default null,
  p_work_place text default null,
  p_training_minutes integer default null
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.attendance;
  checkout_at timestamptz := now();
begin
  if p_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and is_active and status <> 'inactive') then
    raise exception 'Inactive accounts cannot submit attendance';
  end if;
  if p_work_notes is null or p_work_notes !~ '[^[:space:]]' or char_length(p_work_notes) > 4000 then
    raise exception 'Daily work notes must contain 1 to 4000 characters';
  end if;
  if char_length(p_work_place) > 120 then raise exception 'Workplace must be at most 120 characters'; end if;
  if p_training_minutes < 0 or p_training_minutes > 1440 then raise exception 'Invalid training minutes'; end if;

  -- Keep an overnight shift on its original attendance date.
  select * into current_row from public.attendance
  where user_id = p_user_id
    and check_in_time is not null
    and check_out_time is null
    and check_in_time between checkout_at - interval '24 hours' and checkout_at
  order by check_in_time desc
  limit 1
  for update;
  if not found or current_row.check_in_time is null then
    raise exception 'You must check in before checking out';
  end if;
  if current_row.check_out_time is not null then raise exception 'You have already checked out today'; end if;
  if p_training_minutes > floor(extract(epoch from (checkout_at - current_row.check_in_time)) / 60) then
    raise exception 'Training time cannot exceed the shift duration';
  end if;

  -- Notes and the server-generated checkout timestamp are committed together.
  update public.attendance
  set check_out_time = checkout_at,
      attendance_status = 'checked_out',
      work_notes = btrim(p_work_notes),
      work_place = nullif(btrim(p_work_place), ''),
      training_minutes = p_training_minutes,
      ip_address = coalesce(p_ip_address, ip_address),
      device_info = coalesce(p_device_info, device_info)
  where id = current_row.id returning * into current_row;
  return current_row;
end;
$$;

revoke all on function public.check_in_server(uuid, text, text) from public, anon, authenticated;
grant execute on function public.check_in_server(uuid, text, text) to service_role;
revoke all on function public.check_out_server(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.check_out_server(uuid, text, text, text, text, integer) to service_role;

commit;
