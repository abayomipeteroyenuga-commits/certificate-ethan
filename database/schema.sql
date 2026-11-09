-- ETHAN CERTIFICATE v1.2.0 — Neon PostgreSQL schema
-- Server-side only. Do not expose DATABASE_URL or Neon credentials in browser code.
-- Vercel API routes enforce sessions, roles, audit logging, issuance and public verification.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SEQUENCE IF NOT EXISTS public.certificate_number_seq START 1 INCREMENT 1;

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text,
  email_confirmed_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  must_reset_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin','issuer','viewer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  reissued_from uuid REFERENCES public.certificates(id) ON DELETE SET NULL,
  certificate_number text NOT NULL UNIQUE,
  verification_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  award_title text NOT NULL DEFAULT 'CERTIFICATE OF COMPLETION',
  programme_name text NOT NULL,
  course_title text NOT NULL,
  duration text,
  date_completed date NOT NULL,
  issued_at date NOT NULL DEFAULT current_date,
  grade text,
  remarks text,
  signatory_name text NOT NULL DEFAULT 'Mr. Abayomi Peter Oyenuga',
  signatory_title text NOT NULL DEFAULT 'Founder',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  status_reason text,
  revoked_at timestamptz,
  issued_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  achievement_description text,
  criteria_narrative text,
  skills_tags text[] NOT NULL DEFAULT '{}'::text[],
  evidence_url text,
  expiration_date date,
  framework_alignment text
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.app_users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.verification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id uuid REFERENCES public.certificates(id) ON DELETE SET NULL,
  result_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.request_limits (
  bucket_key text NOT NULL,
  action text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, action)
);

CREATE INDEX IF NOT EXISTS students_email_lower_idx ON public.students (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS students_name_lower_idx ON public.students (lower(full_name));
CREATE INDEX IF NOT EXISTS certificates_issued_at_idx ON public.certificates (issued_at DESC);
CREATE INDEX IF NOT EXISTS certificates_student_idx ON public.certificates (student_id);
CREATE INDEX IF NOT EXISTS certificates_number_upper_idx ON public.certificates (upper(certificate_number));
CREATE INDEX IF NOT EXISTS certificates_expiration_date_idx ON public.certificates (expiration_date) WHERE expiration_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_user_id_idx ON public.audit_logs (actor_user_id);
CREATE INDEX IF NOT EXISTS verification_logs_created_at_idx ON public.verification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS verification_logs_certificate_id_idx ON public.verification_logs (certificate_id);
CREATE INDEX IF NOT EXISTS app_sessions_user_expires_idx ON public.app_sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON public.app_sessions (expires_at);
