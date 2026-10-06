-- Some profiles stored the word 'null' as text in optional fields (shown as "null" in
-- the employees table). Turn those into real empty values. Safe to run more than once.
update public.profiles
set
  position = case when lower(trim(position)) in ('null', 'undefined') then null else position end,
  department = case when lower(trim(department)) in ('null', 'undefined') then null else department end,
  phone = case when lower(trim(phone)) in ('null', 'undefined') then null else phone end
where lower(trim(coalesce(position, ''))) in ('null', 'undefined')
   or lower(trim(coalesce(department, ''))) in ('null', 'undefined')
   or lower(trim(coalesce(phone, ''))) in ('null', 'undefined');
