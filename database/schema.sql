-- ETHAN CERTIFICATE v1.1.1
-- Official single-issuer registry for Ethan Digital Academy.
-- Run this script in the Supabase SQL Editor using a project owner account.
-- Never expose a Supabase service_role key in frontend code.

create extension if not exists pgcrypto;

create sequence if not exists public.certificate_number_seq start 1 increment 1;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin' check (role in ('owner','admin','issuer','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists students_email_lower_idx on public.students (lower(email)) where email is not null;
create index if not exists students_name_lower_idx on public.students (lower(full_name));

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  reissued_from uuid references public.certificates(id) on delete set null,
  certificate_number text not null unique,
  verification_token uuid not null unique default gen_random_uuid(),
  award_title text not null default 'CERTIFICATE OF COMPLETION',
  programme_name text not null,
  course_title text not null,
  duration text,
  date_completed date not null,
  issued_at date not null default current_date,
  grade text,
  remarks text,
  signatory_name text not null default 'Mr. Abayomi Peter Oyenuga',
  signatory_title text not null default 'Founder',
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  status_reason text,
  revoked_at timestamptz,
  issued_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists certificates_issued_at_idx on public.certificates (issued_at desc);
alter table public.certificates add column if not exists reissued_from uuid references public.certificates(id) on delete set null;
create index if not exists certificates_student_idx on public.certificates (student_id);
create index if not exists certificates_number_upper_idx on public.certificates (upper(certificate_number));

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

create table if not exists public.verification_logs (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid references public.certificates(id) on delete set null,
  result_status text not null,
  created_at timestamptz not null default now()
);
create index if not exists verification_logs_created_at_idx on public.verification_logs (created_at desc);

-- Cover foreign keys to keep joins and deletes efficient as the registry grows.
create index if not exists audit_logs_actor_user_id_idx on public.audit_logs(actor_user_id);
create index if not exists certificates_issued_by_idx on public.certificates(issued_by);
create index if not exists certificates_reissued_from_idx on public.certificates(reissued_from);
create index if not exists students_created_by_idx on public.students(created_by);
create index if not exists verification_logs_certificate_id_idx on public.verification_logs(certificate_id);

-- Security helper: admin status is checked server-side, never from browser-supplied role data.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = auth.uid() and a.is_active = true and a.role in ('owner','admin','issuer')
  );
$$;

alter table public.admin_users enable row level security;
alter table public.students enable row level security;
alter table public.certificates enable row level security;
alter table public.audit_logs enable row level security;
alter table public.verification_logs enable row level security;

drop policy if exists "Admins can read admin directory" on public.admin_users;
create policy "Admins can read admin directory" on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Admins can read students" on public.students;
create policy "Admins can read students" on public.students
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins can read certificates" on public.certificates;
create policy "Admins can read certificates" on public.certificates
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs" on public.audit_logs
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins can read verification logs" on public.verification_logs;
create policy "Admins can read verification logs" on public.verification_logs
  for select to authenticated using ((select public.is_admin()));

-- No direct client INSERT/UPDATE/DELETE policies are provided for the registry tables.
-- All official writes must pass through the checked SECURITY DEFINER functions below.

create or replace function public.issue_certificate(
  p_full_name text,
  p_email text,
  p_phone text,
  p_award_title text,
  p_programme_name text,
  p_course_title text,
  p_duration text,
  p_date_completed date,
  p_date_issued date,
  p_grade text,
  p_remarks text,
  p_signatory_name text,
  p_signatory_title text,
  p_reissued_from uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_certificate_id uuid;
  v_certificate_number text;
  v_token uuid;
  v_seq bigint;
  v_previous_number text;
  v_previous_status text;
  v_issued_date date := coalesce(p_date_issued, current_date);
begin
  if not public.is_admin() then
    raise exception 'You are not authorised to issue certificates.' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null then raise exception 'Student full name is required.'; end if;
  if nullif(btrim(p_programme_name), '') is null then raise exception 'Programme name is required.'; end if;
  if nullif(btrim(p_course_title), '') is null then raise exception 'Course title is required.'; end if;
  if p_date_completed is null then raise exception 'Completion date is required.'; end if;

  if p_reissued_from is not null then
    select certificate_number, status into v_previous_number, v_previous_status
    from public.certificates where id = p_reissued_from;
    if not found then raise exception 'The original certificate record was not found.'; end if;
    if v_previous_status = 'active' then raise exception 'Reissue requires the previous certificate to be suspended or revoked first.'; end if;
  end if;

  if nullif(btrim(p_email), '') is not null then
    select s.id into v_student_id from public.students s
      where lower(s.email) = lower(btrim(p_email)) order by s.created_at asc limit 1;
  end if;

  if v_student_id is null then
    insert into public.students(full_name,email,phone,created_by)
    values (btrim(p_full_name), nullif(btrim(p_email),''), nullif(btrim(p_phone),''), auth.uid())
    returning id into v_student_id;
  else
    update public.students set full_name=btrim(p_full_name), phone=nullif(btrim(p_phone),''), updated_at=now()
    where id=v_student_id;
  end if;

  v_seq := nextval('public.certificate_number_seq');
  v_certificate_number := 'EDA-CERT-' || to_char(v_issued_date, 'YYYY') || '-' || lpad(v_seq::text, 6, '0');
  v_token := gen_random_uuid();

  insert into public.certificates(
    student_id,reissued_from,certificate_number,verification_token,award_title,programme_name,course_title,
    duration,date_completed,issued_at,grade,remarks,signatory_name,signatory_title,issued_by
  ) values (
    v_student_id,p_reissued_from,v_certificate_number,v_token,
    coalesce(nullif(btrim(p_award_title),''),'CERTIFICATE OF COMPLETION'),
    btrim(p_programme_name),btrim(p_course_title),nullif(btrim(p_duration),''),p_date_completed,
    v_issued_date,nullif(btrim(p_grade),''),nullif(btrim(p_remarks),''),
    coalesce(nullif(btrim(p_signatory_name),''),'Mr. Abayomi Peter Oyenuga'),
    coalesce(nullif(btrim(p_signatory_title),''),'Founder'),auth.uid()
  ) returning id into v_certificate_id;

  insert into public.audit_logs(actor_user_id,action,details)
  values(auth.uid(),case when p_reissued_from is null then 'CERTIFICATE ISSUED' else 'CERTIFICATE REISSUED' end,jsonb_build_object('certificate_id',v_certificate_id,'certificate_number',v_certificate_number,'student_id',v_student_id,'reissued_from',p_reissued_from,'previous_certificate_number',v_previous_number));

  return jsonb_build_object(
    'id',v_certificate_id,'student_id',v_student_id,'reissued_from',p_reissued_from,'certificate_number',v_certificate_number,
    'verification_token',v_token,'status','active','issued_at',v_issued_date,
    'date_completed',p_date_completed,'award_title',coalesce(nullif(btrim(p_award_title),''),'CERTIFICATE OF COMPLETION'),
    'programme_name',btrim(p_programme_name),'course_title',btrim(p_course_title),
    'duration',nullif(btrim(p_duration),''),'grade',nullif(btrim(p_grade),''),
    'signatory_name',coalesce(nullif(btrim(p_signatory_name),''),'Mr. Abayomi Peter Oyenuga'),
    'signatory_title',coalesce(nullif(btrim(p_signatory_title),''),'Founder'),
    'students',jsonb_build_object('id',v_student_id,'full_name',btrim(p_full_name),'email',nullif(btrim(p_email),''),'phone',nullif(btrim(p_phone),''))
  );
end;
$$;

create or replace function public.set_certificate_status(
  p_certificate_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  if not public.is_admin() then
    raise exception 'You are not authorised to change certificate status.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active','suspended','revoked') then raise exception 'Unsupported certificate status.'; end if;
  if p_status in ('revoked','suspended') and nullif(btrim(p_reason),'') is null then raise exception 'A reason is required for suspension or revocation.'; end if;

  update public.certificates set status=p_status,status_reason=nullif(btrim(p_reason),''),
    revoked_at=case when p_status='revoked' then now() else null end,updated_at=now()
    where id=p_certificate_id returning certificate_number into v_number;
  if v_number is null then raise exception 'Certificate record not found.'; end if;

  insert into public.audit_logs(actor_user_id,action,details)
  values(auth.uid(),'CERTIFICATE STATUS CHANGED',jsonb_build_object('certificate_number',v_number,'status',p_status,'reason',nullif(btrim(p_reason),'')));
  return jsonb_build_object('certificate_number',v_number,'status',p_status);
end;
$$;

-- Public function deliberately returns only verification-safe fields. No email, phone, private notes or token.
create or replace function public.verify_certificate(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cert public.certificates%rowtype;
  v_name text;
begin
  if nullif(btrim(p_identifier),'') is null then return jsonb_build_object('status','not_found'); end if;

  select c into v_cert
  from public.certificates c
  where upper(c.certificate_number)=upper(btrim(p_identifier))
     or c.verification_token::text=btrim(p_identifier)
  limit 1;

  if not found then
    insert into public.verification_logs(certificate_id,result_status) values(null,'not_found');
    return jsonb_build_object('status','not_found');
  end if;

  select s.full_name into v_name from public.students s where s.id=v_cert.student_id;
  insert into public.verification_logs(certificate_id,result_status) values(v_cert.id,v_cert.status);
  return jsonb_build_object(
    'status',v_cert.status,
    'certificate_number',v_cert.certificate_number,
    'recipient_name',v_name,
    'award_title',v_cert.award_title,
    'programme_name',v_cert.programme_name,
    'course_title',v_cert.course_title,
    'duration',v_cert.duration,
    'date_completed',v_cert.date_completed,
    'date_issued',v_cert.issued_at,
    'issuer_name','Ethan Digital Academy'
  );
end;
$$;

revoke all on function public.issue_certificate(text,text,text,text,text,text,text,date,date,text,text,text,text,uuid) from public, anon;
revoke all on function public.set_certificate_status(uuid,text,text) from public, anon;
revoke all on function public.verify_certificate(text) from public;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.issue_certificate(text,text,text,text,text,text,text,date,date,text,text,text,text,uuid) to authenticated;
grant execute on function public.set_certificate_status(uuid,text,text) to authenticated;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- Restrict table access to the intended roles. RLS still applies to authenticated clients.
revoke all on table public.admin_users, public.students, public.certificates, public.audit_logs, public.verification_logs from anon, authenticated;
grant select on public.admin_users, public.students, public.certificates, public.audit_logs, public.verification_logs to authenticated;
grant usage on schema public to anon, authenticated;

-- After creating the owner in Supabase Authentication, use the SQL in docs/ADMIN-SETUP.md
-- to add that user's auth.users UUID to public.admin_users. Do not enable public self-registration.

-- v1.1.1 global credential readiness migration (also available separately for existing deployments).
-- ETHAN CERTIFICATE v1.1.1
-- Credential metadata, staff role separation, and safer status verification.
-- Run once in the Supabase SQL Editor after v1.0.2 has been deployed.
-- This migration does NOT create cryptographic W3C Verifiable Credentials or Open Badges 3.0 proofs.

begin;

alter table public.certificates
  add column if not exists achievement_description text,
  add column if not exists criteria_narrative text,
  add column if not exists skills_tags text[] not null default '{}'::text[],
  add column if not exists evidence_url text,
  add column if not exists expiration_date date,
  add column if not exists framework_alignment text;

create index if not exists certificates_expiration_date_idx
  on public.certificates(expiration_date) where expiration_date is not null;

-- All active staff may access the certificate workspace. Viewer remains read-only.
create or replace function public.get_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from public.admin_users a
  where a.user_id = auth.uid() and a.is_active = true
  limit 1;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = auth.uid() and a.is_active = true
      and a.role in ('owner','admin','issuer','viewer')
  );
$$;

create or replace function public.can_manage_certificates()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = auth.uid() and a.is_active = true
      and a.role in ('owner','admin')
  );
$$;

-- Viewers use a protected registry RPC; direct table access is denied to all frontend roles.
drop policy if exists "Admins can read certificates" on public.certificates;
drop policy if exists "Active staff can read certificates" on public.certificates;
create policy "Admins and issuers can read certificate table" on public.certificates
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins can read audit logs" on public.audit_logs;
drop policy if exists "Active staff can read audit logs" on public.audit_logs;
create policy "Admins and issuers can read audit logs" on public.audit_logs
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admins can read verification logs" on public.verification_logs;
drop policy if exists "Active staff can read verification logs" on public.verification_logs;
create policy "Admins and issuers can read verification logs" on public.verification_logs
  for select to authenticated using ((select public.is_admin()));

-- Role-aware registry RPC. It is the only certificate-list read path used by the frontend.
-- The function checks staff membership and returns private contact/evidence fields only to owner/admin/issuer.
create or replace function public.get_certificate_registry()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_is_admin boolean;
begin
  if not public.is_staff() then
    raise exception 'You are not authorised to view the certificate registry.' using errcode = '42501';
  end if;
  v_is_admin := public.is_admin();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,
    'recipient_name',r.recipient_name,
    'student_email',case when v_is_admin then r.student_email else null end,
    'student_phone',case when v_is_admin then r.student_phone else null end,
    'certificate_number',r.certificate_number,
    'verification_token',r.verification_token,
    'award_title',r.award_title,
    'programme_name',r.programme_name,
    'course_title',r.course_title,
    'duration',r.duration,
    'date_completed',r.date_completed,
    'issued_at',r.issued_at,
    'grade',r.grade,
    'remarks',case when v_is_admin then r.remarks else null end,
    'signatory_name',r.signatory_name,
    'signatory_title',r.signatory_title,
    'status',r.status,
    'status_reason',case when v_is_admin then r.status_reason else null end,
    'expiration_date',r.expiration_date,
    'achievement_description',r.achievement_description,
    'criteria_narrative',r.criteria_narrative,
    'skills_tags',r.skills_tags,
    'evidence_url',case when v_is_admin then r.evidence_url else null end,
    'framework_alignment',r.framework_alignment
  ) order by r.issued_at desc), '[]'::jsonb)
  into v_rows
  from (
    select c.id, s.full_name as recipient_name, s.email as student_email, s.phone as student_phone,
      c.certificate_number, c.verification_token, c.award_title, c.programme_name, c.course_title,
      c.duration, c.date_completed, c.issued_at, c.grade, c.remarks, c.signatory_name,
      c.signatory_title, c.status, c.status_reason, c.expiration_date, c.achievement_description,
      c.criteria_narrative, c.skills_tags, c.evidence_url, c.framework_alignment
    from public.certificates c
    join public.students s on s.id = c.student_id
    order by c.issued_at desc
    limit 500
  ) r;

  return v_rows;
end;
$$;

-- v1.1 frontend reads use the role-aware RPC; RLS keeps direct table reads limited to owner/admin/issuer for backward compatibility.

-- Versioned issuance RPC: richer achievement metadata without breaking the v1.0 RPC.
create or replace function public.issue_certificate_v2(
  p_full_name text,
  p_email text,
  p_phone text,
  p_award_title text,
  p_programme_name text,
  p_course_title text,
  p_duration text,
  p_date_completed date,
  p_date_issued date,
  p_grade text,
  p_remarks text,
  p_signatory_name text,
  p_signatory_title text,
  p_achievement_description text,
  p_criteria_narrative text,
  p_skills_tags text[],
  p_evidence_url text,
  p_expiration_date date,
  p_framework_alignment text,
  p_reissued_from uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_certificate_id uuid;
  v_certificate_number text;
  v_token uuid;
  v_seq bigint;
  v_previous_number text;
  v_previous_status text;
  v_previous_expiration date;
  v_issued_date date := coalesce(p_date_issued, current_date);
  v_skills text[];
begin
  if not public.is_admin() then
    raise exception 'You are not authorised to issue certificates.' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null then raise exception 'Student full name is required.'; end if;
  if nullif(btrim(p_programme_name), '') is null then raise exception 'Programme name is required.'; end if;
  if nullif(btrim(p_course_title), '') is null then raise exception 'Course title is required.'; end if;
  if p_date_completed is null then raise exception 'Completion date is required.'; end if;
  if p_date_completed > v_issued_date then raise exception 'Completion date cannot be after the issue date.'; end if;
  if p_expiration_date is not null and p_expiration_date < v_issued_date then
    raise exception 'Expiry date cannot be earlier than the issue date.';
  end if;
  if nullif(btrim(p_evidence_url), '') is not null and btrim(p_evidence_url) !~* '^https?://[^[:space:]]+$' then
    raise exception 'Evidence link must be a valid HTTP or HTTPS URL.';
  end if;

  select coalesce(array_agg(t.clean_tag order by t.ord), '{}'::text[])
    into v_skills
  from (
    select left(btrim(tag), 80) as clean_tag, ord
    from unnest(coalesce(p_skills_tags, '{}'::text[])) with ordinality as tags(tag, ord)
    where nullif(btrim(tag), '') is not null
    order by ord
    limit 20
  ) t;

  if p_reissued_from is not null then
    select certificate_number, status, expiration_date into v_previous_number, v_previous_status, v_previous_expiration
    from public.certificates where id = p_reissued_from;
    if not found then raise exception 'The original certificate record was not found.'; end if;
    if v_previous_status = 'active' and (v_previous_expiration is null or v_previous_expiration >= current_date) then
      raise exception 'Reissue requires the previous certificate to be suspended, revoked or expired.';
    end if;
  end if;

  if nullif(btrim(p_email), '') is not null then
    select s.id into v_student_id from public.students s
    where lower(s.email) = lower(btrim(p_email)) order by s.created_at asc limit 1;
  end if;

  if v_student_id is null then
    insert into public.students(full_name,email,phone,created_by)
    values (btrim(p_full_name), nullif(btrim(p_email),''), nullif(btrim(p_phone),''), auth.uid())
    returning id into v_student_id;
  else
    update public.students set full_name=btrim(p_full_name), phone=nullif(btrim(p_phone),''), updated_at=now()
    where id=v_student_id;
  end if;

  v_seq := nextval('public.certificate_number_seq');
  v_certificate_number := 'EDA-CERT-' || to_char(v_issued_date, 'YYYY') || '-' || lpad(v_seq::text, 6, '0');
  v_token := gen_random_uuid();

  insert into public.certificates(
    student_id,reissued_from,certificate_number,verification_token,award_title,programme_name,course_title,
    duration,date_completed,issued_at,grade,remarks,signatory_name,signatory_title,issued_by,
    achievement_description,criteria_narrative,skills_tags,evidence_url,expiration_date,framework_alignment
  ) values (
    v_student_id,p_reissued_from,v_certificate_number,v_token,
    coalesce(nullif(btrim(p_award_title),''),'CERTIFICATE OF COMPLETION'),
    btrim(p_programme_name),btrim(p_course_title),nullif(btrim(p_duration),''),p_date_completed,
    v_issued_date,nullif(btrim(p_grade),''),nullif(btrim(p_remarks),''),
    coalesce(nullif(btrim(p_signatory_name),''),'Mr. Abayomi Peter Oyenuga'),
    coalesce(nullif(btrim(p_signatory_title),''),'Founder'),auth.uid(),
    nullif(btrim(p_achievement_description),''),nullif(btrim(p_criteria_narrative),''),v_skills,
    nullif(btrim(p_evidence_url),''),p_expiration_date,nullif(btrim(p_framework_alignment),'')
  ) returning id into v_certificate_id;

  insert into public.audit_logs(actor_user_id,action,details)
  values(auth.uid(),case when p_reissued_from is null then 'CERTIFICATE ISSUED' else 'CERTIFICATE REISSUED' end,
    jsonb_build_object('certificate_id',v_certificate_id,'certificate_number',v_certificate_number,
      'student_id',v_student_id,'reissued_from',p_reissued_from,'previous_certificate_number',v_previous_number,
      'skills_count',coalesce(cardinality(v_skills),0),'has_criteria',nullif(btrim(p_criteria_narrative),'') is not null));

  return jsonb_build_object(
    'id',v_certificate_id,'student_id',v_student_id,'reissued_from',p_reissued_from,
    'certificate_number',v_certificate_number,'verification_token',v_token,'status','active','issued_at',v_issued_date,
    'date_completed',p_date_completed,'award_title',coalesce(nullif(btrim(p_award_title),''),'CERTIFICATE OF COMPLETION'),
    'programme_name',btrim(p_programme_name),'course_title',btrim(p_course_title),'duration',nullif(btrim(p_duration),''),
    'grade',nullif(btrim(p_grade),''),'signatory_name',coalesce(nullif(btrim(p_signatory_name),''),'Mr. Abayomi Peter Oyenuga'),
    'signatory_title',coalesce(nullif(btrim(p_signatory_title),''),'Founder'),
    'achievement_description',nullif(btrim(p_achievement_description),''),'criteria_narrative',nullif(btrim(p_criteria_narrative),''),
    'skills_tags',v_skills,'expiration_date',p_expiration_date,'framework_alignment',nullif(btrim(p_framework_alignment),''),
    'students',jsonb_build_object('id',v_student_id,'full_name',btrim(p_full_name),'email',nullif(btrim(p_email),''),'phone',nullif(btrim(p_phone),''))
  );
end;
$$;

-- Only owners and administrators may suspend, revoke, or reactivate credentials.
create or replace function public.set_certificate_status(
  p_certificate_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  if not public.can_manage_certificates() then
    raise exception 'Only owners and administrators can change certificate status.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active','suspended','revoked') then raise exception 'Unsupported certificate status.'; end if;
  if p_status in ('revoked','suspended') and nullif(btrim(p_reason),'') is null then raise exception 'A reason is required for suspension or revocation.'; end if;

  update public.certificates set status=p_status,status_reason=nullif(btrim(p_reason),''),
    revoked_at=case when p_status='revoked' then now() else null end,updated_at=now()
    where id=p_certificate_id returning certificate_number into v_number;
  if v_number is null then raise exception 'Certificate record not found.'; end if;

  insert into public.audit_logs(actor_user_id,action,details)
  values(auth.uid(),'CERTIFICATE STATUS CHANGED',jsonb_build_object('certificate_number',v_number,'status',p_status,'reason',nullif(btrim(p_reason),'')));
  return jsonb_build_object('certificate_number',v_number,'status',p_status);
end;
$$;

-- Public verification reveals credential metadata, but never email, phone, private notes or evidence URL.
create or replace function public.verify_certificate(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cert public.certificates%rowtype;
  v_name text;
  v_public_status text;
begin
  if nullif(btrim(p_identifier),'') is null then return jsonb_build_object('status','not_found'); end if;

  select c into v_cert from public.certificates c
  where upper(c.certificate_number)=upper(btrim(p_identifier))
     or c.verification_token::text=btrim(p_identifier)
  limit 1;

  if not found then
    insert into public.verification_logs(certificate_id,result_status) values(null,'not_found');
    return jsonb_build_object('status','not_found');
  end if;

  select s.full_name into v_name from public.students s where s.id=v_cert.student_id;
  v_public_status := case
    when v_cert.status='active' and v_cert.expiration_date is not null and v_cert.expiration_date < current_date then 'expired'
    else v_cert.status end;
  insert into public.verification_logs(certificate_id,result_status) values(v_cert.id,v_public_status);

  return jsonb_build_object(
    'status',v_public_status,'certificate_number',v_cert.certificate_number,'recipient_name',v_name,
    'award_title',v_cert.award_title,'programme_name',v_cert.programme_name,'course_title',v_cert.course_title,
    'duration',v_cert.duration,'date_completed',v_cert.date_completed,'date_issued',v_cert.issued_at,
    'issuer_name','Ethan Digital Academy','achievement_description',v_cert.achievement_description,
    'criteria_narrative',v_cert.criteria_narrative,'skills_tags',v_cert.skills_tags,
    'expiration_date',v_cert.expiration_date,'framework_alignment',v_cert.framework_alignment
  );
end;
$$;

revoke all on function public.get_admin_role() from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.can_manage_certificates() from public, anon;
revoke all on function public.get_certificate_registry() from public, anon;
revoke all on function public.issue_certificate_v2(text,text,text,text,text,text,text,date,date,text,text,text,text,text,text,text[],text,date,text,uuid) from public, anon;
revoke all on function public.set_certificate_status(uuid,text,text) from public, anon;
revoke all on function public.verify_certificate(text) from public;
grant execute on function public.get_admin_role() to authenticated;
revoke execute on function public.is_staff() from authenticated;
revoke execute on function public.can_manage_certificates() from authenticated;
grant execute on function public.get_certificate_registry() to authenticated;
grant execute on function public.issue_certificate_v2(text,text,text,text,text,text,text,date,date,text,text,text,text,text,text,text[],text,date,text,uuid) to authenticated;
grant execute on function public.set_certificate_status(uuid,text,text) to authenticated;
grant execute on function public.verify_certificate(text) to anon, authenticated;

commit;
