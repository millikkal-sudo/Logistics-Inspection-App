-- =====================================================================
-- Calo UAE — Van pre-departure quality check
-- Supabase migration 0001. Portable Postgres except where marked
-- [SUPABASE]. Those blocks are the ones to replace on the AWS move.
-- =====================================================================

create extension if not exists "pgcrypto";

create type inspection_status as enum ('compliant', 'noncompliant', 'action_required');
create type check_input_type  as enum ('boolean', 'temperature');
create type user_role         as enum ('supervisor', 'manager', 'admin');

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------

-- [SUPABASE] references auth.users. On AWS this becomes the Cognito sub
-- as a plain uuid with no FK.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text not null,
  role       user_role not null default 'supervisor',
  depot      text not null default 'Central Warehouse',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- [SUPABASE] Google OAuth alone will let any Google account in. This is
-- the gate that actually enforces @calo.app.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email not like '%@calo.app' then
    raise exception 'Only @calo.app accounts may sign in';
  end if;

  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Fleet and checklist
-- ---------------------------------------------------------------------

create table vans (
  id         uuid primary key default gen_random_uuid(),
  plate      text not null unique,
  depot      text not null default 'Central Warehouse',
  temp_min_c numeric(4,1) not null default 0.0,
  temp_max_c numeric(4,1) not null default 5.0,
  active     boolean not null default true
);

create table drivers (
  id          uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  full_name   text not null,
  route       text,
  default_van uuid references vans(id),
  active      boolean not null default true
);

-- Checklist is data. Kuldeep changing an item is a row, not a deploy.
create table check_items (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  label      text not null,
  help_text  text,
  input_type check_input_type not null default 'boolean',
  critical   boolean not null default false,
  sort_order int not null,
  active     boolean not null default true
);

-- ---------------------------------------------------------------------
-- Inspections — immutable once written
-- ---------------------------------------------------------------------

create table inspections (
  id               uuid primary key default gen_random_uuid(),
  van_id           uuid not null references vans(id),
  driver_id        uuid not null references drivers(id),
  inspector_id     uuid not null references profiles(id),
  performed_at     timestamptz not null default now(),
  status           inspection_status not null,
  dispatch_blocked boolean not null default false,
  latitude         numeric(9,6),
  longitude        numeric(9,6),
  notes            text,
  supersedes_id    uuid references inspections(id),
  created_at       timestamptz not null default now()
);

create index inspections_performed_at_idx on inspections (performed_at desc);
create index inspections_van_idx          on inspections (van_id, performed_at desc);
create index inspections_blocked_idx      on inspections (performed_at desc) where dispatch_blocked;

create table inspection_results (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  check_item_id uuid not null references check_items(id),
  passed        boolean not null,
  numeric_value numeric(5,2),
  note          text,
  unique (inspection_id, check_item_id),
  constraint failure_needs_note check (passed or note is not null)
);

create table inspection_photos (
  id          uuid primary key default gen_random_uuid(),
  result_id   uuid not null references inspection_results(id) on delete cascade,
  storage_key text not null,
  captured_at timestamptz not null default now(),
  byte_size   int
);

create table alerts (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id),
  channel       text not null,
  recipient     text not null,
  sent_at       timestamptz,
  delivered     boolean not null default false,
  error         text,
  payload       jsonb
);

create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references profiles(id),
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity, entity_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------

create or replace function prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Inspections are immutable. File a correcting inspection with supersedes_id instead.';
end;
$$;

create trigger inspections_immutable
  before update or delete on inspections
  for each row execute function prevent_mutation();

create trigger results_immutable
  before update or delete on inspection_results
  for each row execute function prevent_mutation();

-- ---------------------------------------------------------------------
-- Reporting view
-- ---------------------------------------------------------------------

create view v_inspection_summary as
select
  i.id,
  i.performed_at,
  v.plate,
  v.depot,
  d.full_name as driver_name,
  p.full_name as inspector_name,
  i.status,
  i.dispatch_blocked,
  (select count(*) from inspection_results r
     where r.inspection_id = i.id and not r.passed) as failed_count,
  (select r.numeric_value from inspection_results r
     join check_items c on c.id = r.check_item_id
     where r.inspection_id = i.id and c.code = 'temp') as temp_reading_c
from inspections i
join vans v     on v.id = i.van_id
join drivers d  on d.id = i.driver_id
join profiles p on p.id = i.inspector_id
where not exists (
  select 1 from inspections newer where newer.supersedes_id = i.id
);

-- ---------------------------------------------------------------------
-- [SUPABASE] RLS — defence in depth only.
-- Writes go through server route handlers using the service role, which
-- bypasses these. Authorization is enforced in the route handler so it
-- ports to AWS unchanged; these policies stop a leaked anon key from
-- becoming a data breach.
-- ---------------------------------------------------------------------

alter table profiles           enable row level security;
alter table vans               enable row level security;
alter table drivers            enable row level security;
alter table check_items        enable row level security;
alter table inspections        enable row level security;
alter table inspection_results enable row level security;
alter table inspection_photos  enable row level security;
alter table audit_log          enable row level security;

create policy profiles_read_self on profiles
  for select to authenticated using (id = auth.uid());

create policy reference_read on vans
  for select to authenticated using (active);
create policy drivers_read on drivers
  for select to authenticated using (active);
create policy check_items_read on check_items
  for select to authenticated using (active);

create policy inspections_read on inspections
  for select to authenticated
  using (
    inspector_id = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid() and role in ('manager', 'admin')
    )
  );

create policy results_read on inspection_results
  for select to authenticated
  using (exists (select 1 from inspections i where i.id = inspection_id));

create policy photos_read on inspection_photos
  for select to authenticated
  using (exists (select 1 from inspection_results r where r.id = result_id));

-- No insert/update/delete policies: all writes are server-side.

-- ---------------------------------------------------------------------
-- [SUPABASE] Private photo bucket. Becomes an S3 bucket + presigned
-- PUT on the AWS move.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-photos', 'inspection-photos', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy photos_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inspection-photos');

create policy photos_view on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-photos');

-- ---------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------

insert into check_items (code, label, help_text, input_type, critical, sort_order) values
  ('temp',      'Van temperature',      'Must read 0–5 °C at the loading point',   'temperature', true,  1),
  ('sensor',    'Temperature sensor',   'Powered and logging to the fleet portal', 'boolean',     true,  2),
  ('gps',       'GPS tracker',          'Live signal showing on the fleet portal', 'boolean',     true,  3),
  ('curtains',  'Plastic curtains',     'Intact and clean, no tears',              'boolean',     false, 4),
  ('mats',      'Floor mats',           'Clean, dry and in position',              'boolean',     false, 5),
  ('load_area', 'Load area condition',  'No debris, spills or odours',             'boolean',     false, 6);

insert into vans (plate, depot) values
  ('DXB-4021', 'Central Warehouse'),
  ('DXB-4022', 'Central Warehouse'),
  ('SHJ-1108', 'Central Warehouse'),
  ('AUH-2210', 'Central Warehouse'),
  ('DXB-4023', 'Central Warehouse'),
  ('DXB-4024', 'Central Warehouse');

insert into drivers (employee_id, full_name, route, default_van)
select v.emp, v.name, v.route, vans.id
from (values
  ('D-1041', 'Rashid Al Mansoori', 'Dubai Marina – JLT',         'DXB-4021'),
  ('D-1042', 'Joseph Fernandes',   'Downtown – Business Bay',    'DXB-4022'),
  ('D-1043', 'Anil Kumar',         'Sharjah Central',            'SHJ-1108'),
  ('D-1044', 'Mohammed Irfan',     'Abu Dhabi – Khalifa City',   'AUH-2210'),
  ('D-1045', 'Peter Okoye',        'Jumeirah – Umm Suqeim',      'DXB-4023'),
  ('D-1046', 'Samuel Thomas',      'Deira – Al Nahda',           'DXB-4024')
) as v(emp, name, route, plate)
join vans on vans.plate = v.plate;
