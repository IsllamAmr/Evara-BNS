set check_function_bodies = off;

create or replace function public.create_employee_request_atomic(
  p_target_user_id uuid,
  p_request_type text,
  p_reason text default null,
  p_late_date date default null,
  p_leave_start_date date default null,
  p_leave_end_date date default null
)
returns public.employee_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.employee_requests;
  v_leave_days integer;
  v_month_start date;
  v_month_end date;
  v_year integer;
  v_year_start date;
  v_year_end date;
  v_late_count integer;
  v_leave_used integer;
begin
  if p_target_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_request_type not in ('late_2_hours', 'annual_leave') then
    raise exception 'request_type is invalid';
  end if;

  perform 1
    from public.profiles
   where id = p_target_user_id
     and role = 'employee'
     and is_active = true
   for update;

  if not found then
    raise exception 'Employee not found';
  end if;

  if p_request_type = 'late_2_hours' then
    if p_late_date is null then
      raise exception 'late_date is required';
    end if;

    v_month_start := date_trunc('month', p_late_date)::date;
    v_month_end := (date_trunc('month', p_late_date) + interval '1 month - 1 day')::date;

    perform 1
      from public.employee_requests
     where user_id = p_target_user_id
       and request_type = 'late_2_hours'
       and late_date between v_month_start and v_month_end
       and status in ('pending', 'approved')
     for update;

    select count(*)
      into v_late_count
      from public.employee_requests
     where user_id = p_target_user_id
       and request_type = 'late_2_hours'
       and late_date between v_month_start and v_month_end
       and status in ('pending', 'approved');

    if coalesce(v_late_count, 0) >= 2 then
      raise exception 'Monthly limit reached: each employee can submit only 2 two-hour delay requests per month';
    end if;

    insert into public.employee_requests (
      user_id,
      request_type,
      status,
      late_date,
      leave_start_date,
      leave_end_date,
      leave_days,
      reason,
      admin_note,
      reviewed_by,
      reviewed_at
    )
    values (
      p_target_user_id,
      p_request_type,
      'pending',
      p_late_date,
      null,
      null,
      null,
      nullif(trim(p_reason), ''),
      null,
      null,
      null
    )
    returning * into v_result;

    return v_result;
  end if;

  if p_leave_start_date is null or p_leave_end_date is null then
    raise exception 'leave_start_date and leave_end_date are required';
  end if;

  if p_leave_end_date < p_leave_start_date then
    raise exception 'leave_end_date must be on or after leave_start_date';
  end if;

  if extract(year from p_leave_start_date)::int <> extract(year from p_leave_end_date)::int then
    raise exception 'Annual leave request cannot span multiple calendar years';
  end if;

  v_leave_days := p_leave_end_date - p_leave_start_date + 1;
  if v_leave_days <= 0 then
    raise exception 'leave_days must be greater than zero';
  end if;

  v_year := extract(year from p_leave_start_date)::int;
  v_year_start := make_date(v_year, 1, 1);
  v_year_end := make_date(v_year, 12, 31);

  perform 1
    from public.employee_requests
   where user_id = p_target_user_id
     and request_type = 'annual_leave'
     and leave_start_date between v_year_start and v_year_end
     and status in ('pending', 'approved')
   for update;

  select coalesce(sum(leave_days), 0)
    into v_leave_used
    from public.employee_requests
   where user_id = p_target_user_id
     and request_type = 'annual_leave'
     and leave_start_date between v_year_start and v_year_end
     and status in ('pending', 'approved');

  if coalesce(v_leave_used, 0) + v_leave_days > 21 then
    raise exception 'Annual leave limit exceeded: each employee can request up to 21 days per year';
  end if;

  insert into public.employee_requests (
    user_id,
    request_type,
    status,
    late_date,
    leave_start_date,
    leave_end_date,
    leave_days,
    reason,
    admin_note,
    reviewed_by,
    reviewed_at
  )
  values (
    p_target_user_id,
    p_request_type,
    'pending',
    null,
    p_leave_start_date,
    p_leave_end_date,
    v_leave_days,
    nullif(trim(p_reason), ''),
    null,
    null,
    null
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.update_employee_request_status_atomic(
  p_request_id bigint,
  p_next_status text,
  p_admin_note text default null,
  p_reviewed_by uuid default null
)
returns public.employee_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.employee_requests;
  v_result public.employee_requests;
  v_month_start date;
  v_month_end date;
  v_year integer;
  v_year_start date;
  v_year_end date;
  v_late_count integer;
  v_leave_used integer;
begin
  if p_request_id is null or p_request_id <= 0 then
    raise exception 'request id must be a positive integer';
  end if;

  if p_next_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'status must be approved, rejected, or cancelled';
  end if;

  if p_reviewed_by is null then
    raise exception 'reviewed_by is required';
  end if;

  select *
    into v_existing
    from public.employee_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if p_next_status = 'approved' and v_existing.request_type = 'late_2_hours' then
    v_month_start := date_trunc('month', v_existing.late_date)::date;
    v_month_end := (date_trunc('month', v_existing.late_date) + interval '1 month - 1 day')::date;

    perform 1
      from public.employee_requests
     where user_id = v_existing.user_id
       and request_type = 'late_2_hours'
       and late_date between v_month_start and v_month_end
       and status in ('pending', 'approved')
       and id <> v_existing.id
     for update;

    select count(*)
      into v_late_count
      from public.employee_requests
     where user_id = v_existing.user_id
       and request_type = 'late_2_hours'
       and late_date between v_month_start and v_month_end
       and status in ('pending', 'approved')
       and id <> v_existing.id;

    if coalesce(v_late_count, 0) >= 2 then
      raise exception 'Cannot approve: monthly two-hour delay limit (2) has already been reached';
    end if;
  end if;

  if p_next_status = 'approved' and v_existing.request_type = 'annual_leave' then
    v_year := extract(year from v_existing.leave_start_date)::int;
    v_year_start := make_date(v_year, 1, 1);
    v_year_end := make_date(v_year, 12, 31);

    perform 1
      from public.employee_requests
     where user_id = v_existing.user_id
       and request_type = 'annual_leave'
       and leave_start_date between v_year_start and v_year_end
       and status in ('pending', 'approved')
       and id <> v_existing.id
     for update;

    select coalesce(sum(leave_days), 0)
      into v_leave_used
      from public.employee_requests
     where user_id = v_existing.user_id
       and request_type = 'annual_leave'
       and leave_start_date between v_year_start and v_year_end
       and status in ('pending', 'approved')
       and id <> v_existing.id;

    if coalesce(v_leave_used, 0) + coalesce(v_existing.leave_days, 0) > 21 then
      raise exception 'Cannot approve: annual leave limit (21 days) would be exceeded';
    end if;
  end if;

  update public.employee_requests
     set status = p_next_status,
         admin_note = nullif(trim(p_admin_note), ''),
         reviewed_by = p_reviewed_by,
         reviewed_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
   where id = p_request_id
   returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.create_employee_request_atomic(uuid, text, text, date, date, date) from public;
revoke all on function public.update_employee_request_status_atomic(bigint, text, text, uuid) from public;
revoke all on function public.create_employee_request_atomic(uuid, text, text, date, date, date) from authenticated;
revoke all on function public.update_employee_request_status_atomic(bigint, text, text, uuid) from authenticated;
grant execute on function public.create_employee_request_atomic(uuid, text, text, date, date, date) to service_role;
grant execute on function public.update_employee_request_status_atomic(bigint, text, text, uuid) to service_role;
