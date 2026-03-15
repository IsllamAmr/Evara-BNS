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
