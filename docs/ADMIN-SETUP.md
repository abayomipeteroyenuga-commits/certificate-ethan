# Ethan Certificate — first administrator setup

This application does not provide public administrator sign-up. The first owner is provisioned directly in Supabase by the project owner.

## 1. Create the owner account

1. Open the Supabase project for Ethan Certificate.
2. Go to **Authentication → Users**.
3. Invite or create the owner's account using the intended administrator email.
4. Confirm the account is active and set a secure password.

## 2. Promote the owner in the database

Open **SQL Editor** and run the following, replacing the email with the exact account email:

```sql
insert into public.admin_users (user_id, email, role, is_active)
select id, email, 'owner', true
from auth.users
where lower(email) = lower('YOUR-ADMIN-EMAIL@example.com')
on conflict (user_id) do update
set email = excluded.email, role = 'owner', is_active = true;
```

Confirm the record exists:

```sql
select user_id, email, role, is_active
from public.admin_users
order by created_at;
```

Do not grant owner rights based on a browser form or a user-editable profile field. Only a trusted project owner should run this SQL.

## 3. Add additional administrators

Create each account in Supabase Authentication first. Then run the following SQL with the exact email and chosen role:

```sql
insert into public.admin_users (user_id, email, role, is_active)
select id, email, 'issuer', true
from auth.users
where lower(email) = lower('ISSUER-EMAIL@example.com')
on conflict (user_id) do update
set email = excluded.email, role = excluded.role, is_active = true;
```

Available roles after applying `database/migrations/001_global_credential_readiness.sql`:

- `owner` — full control; maintain this role for the designated owner.
- `admin` — issue certificates, manage status and oversee records.
- `issuer` — issue/reissue and view records; cannot suspend, revoke or reactivate certificates.
- `viewer` — read-only certificate registry access only; cannot view student contact records or activity logs.

Do not assign `viewer` until the v1.1.1 database migration has been applied. The older v1.0.2 frontend does not understand the separated viewer permissions.


## 4. Security rules

- Disable public sign-up in Supabase Auth.
- Use only the Supabase anon/publishable key in `config.js`.
- Never paste a `service_role` or secret key into frontend files, GitHub, or Vercel environment variables exposed to the browser.
- The database uses RLS and server-side RPC authorization. Do not add permissive `anon` table policies.
- Enable MFA for owner accounts where available.
- Keep a secure record of who is authorised to issue and revoke certificates.
