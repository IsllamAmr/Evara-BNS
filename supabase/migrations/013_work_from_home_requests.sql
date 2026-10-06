-- "Work from home" requests: an employee notes the hours they worked from home on a
-- day. It is a note only (no hours are added to attendance or payroll); it is saved
-- as approved right away and shows in that day's notes in the employee's timesheet
-- Excel. An admin can set it to rejected to remove it.

alter table public.employee_requests
  add column if not exists work_date date null,
  add column if not exists work_start time null,
  add column if not exists work_end time null;

-- The type list and the payload shape are CHECK constraints; replace both. The type
-- check was declared inline, so its generated name is looked up instead of guessed.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
      from pg_constraint
     where conrelid = 'public.employee_requests'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%request_type%'
  loop
    execute format('alter table public.employee_requests drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.employee_requests
  add constraint employee_requests_request_type_check
  check (request_type in ('late_2_hours', 'annual_leave', 'work_from_home'));

alter table public.employee_requests
  add constraint employee_requests_payload_shape check (
    (
      request_type = 'late_2_hours'
      and late_date is not null
      and leave_start_date is null
      and leave_end_date is null
      and leave_days is null
      and work_date is null
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
      and work_date is null
    )
    or
    (
      request_type = 'work_from_home'
      and work_date is not null
      and work_start is not null
      and work_end is not null
      and work_end > work_start
      and late_date is null
      and leave_start_date is null
      and leave_end_date is null
      and leave_days is null
    )
  );

create index if not exists idx_employee_requests_work_from_home
  on public.employee_requests (user_id, work_date)
  where request_type = 'work_from_home';
