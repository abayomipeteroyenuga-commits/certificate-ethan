# Ethan Certificate — Neon owner and staff administration

## First owner activation after the Supabase-to-Neon migration

The owner identity and role were migrated into Neon, but the previous Supabase password hash was deliberately not exported. Activate the migrated owner once:

1. Open https://certificate.ethandigitalacademy.org.
2. Select **First-time migrated owner setup**.
3. Enter the existing administrator email.
4. Enter the one-time migration key supplied by the project owner.
5. Set a new password of at least 12 characters and confirm it.

The API accepts this activation only while the migrated owner record is marked `must_reset_password = true`. After success, the new bcrypt password hash is stored in Neon, the one-time flag is turned off, an audit entry is written, and a secure session is issued. The normal sign-in form should be used from then on.

Remove the `CERTIFICATE_BOOTSTRAP_TOKEN` Vercel environment variable after successful activation. Do not put it in GitHub, frontend configuration, or email.

## Roles

| Role | Permission |
|---|---|
| owner | Full registry control, issue/reissue, manage certificate status and staff oversight |
| admin | Issue/reissue, manage certificate status and oversee records |
| issuer | Issue/reissue and view registry; cannot suspend, revoke or reactivate |
| viewer | Read-only registry view with student contacts, private notes, status reason and evidence URL removed |

Role checks are performed by the Vercel API against `admin_users`; role information supplied by a browser is never trusted.

## Staff provisioning

Public administrator self-sign-up is not available. Add a new staff identity and matching `admin_users` row through a trusted, server-side owner procedure. Do not expose database credentials to the browser or ask a staff member to choose their own role.

## Backend operations

- Neon database: `ethan_certificate`
- Vercel API: `/api/certificate`
- Required server-only variables: `DATABASE_URL`, `CERTIFICATE_BOOTSTRAP_TOKEN` (temporary)
- Session cookie: HttpOnly, Secure, SameSite=Lax, eight-hour lifetime.
- Public verification is unauthenticated but rate-limited and returns safe credential details only.

## Important migration note

The prior Supabase project was retained as a rollback copy. The application code and public configuration no longer connect to Supabase. Do not delete the old Supabase project until the owner confirms that Neon sign-in, the certificate registry, issuance, status changes and public verification have all been checked.
