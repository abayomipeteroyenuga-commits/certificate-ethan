# ETHAN CERTIFICATE v1.2.0 — Production deployment checklist

## Neon backend

- [x] Provision the dedicated Neon project and `ethan_certificate` database.
- [x] Create the Neon schema, including users, roles, students, certificates, audit logs, verification logs, sessions and rate-limit tables.
- [x] Copy the existing owner identity and role, student, certificate, audit and verification records into Neon with the original record UUIDs.
- [x] Preserve the existing certificate number and verification token.
- [x] Configure `DATABASE_URL` as a server-side Render environment variable.
- [x] Replace direct browser Supabase access with the same-origin Render API.
- [ ] Complete first-time owner activation and confirm normal Neon sign-in.
- [ ] Verify owner, admin, issuer and viewer role restrictions.
- [ ] Verify issuance, reissue, suspension, revocation, reactivation and audit history.
- [ ] Verify public lookup by certificate number and QR verification token.
- [ ] Verify expired, suspended and revoked credential results.
- [ ] Verify viewer responses omit student email/phone, private notes, status reasons and evidence URLs.
- [ ] Remove the one-time `CERTIFICATE_BOOTSTRAP_TOKEN` variable after owner activation.

## Render deployment and domains
- [x] Create `ethan-certificate` as a Node web service in Frankfurt.
- [x] Deploy the latest Git commit; Render reports the deployment as live.
- [x] Configure server-side `DATABASE_URL` and `CERTIFICATE_BOOTSTRAP_TOKEN`.
- [ ] Set `/healthz` as the Render HTTP health-check path and verify a database-connected response.

- [ ] Confirm the latest production deployment is READY.
- [ ] Add `certificate.ethandigitalacademy.org` to Render and point its DNS CNAME to `ethan-certificate.onrender.com`.
- [ ] Add `verify.ethandigitalacademy.org` to the same Render service and point its DNS CNAME to `ethan-certificate.onrender.com`.
- [ ] Confirm API requests to `/api/certificate` return JSON and are not rewritten to `index.html`.
- [x] Confirm the browser configuration contains no database connection string or Supabase publishable key.

## Rollback and retirement

- [x] Keep the old Supabase project untouched as a temporary rollback copy.
- [ ] After successful Neon validation and owner approval, retire the old Supabase project separately.
- [ ] Do not delete the old backend until the owner explicitly confirms that rollback is no longer required.

## Security

- [ ] Confirm owner MFA and administrator recovery procedures.
- [ ] Review server runtime logs for API or database errors.
- [ ] Confirm API rate limits on login, bootstrap and public verification.
- [ ] Confirm session cookies are Secure, HttpOnly and SameSite=Lax.
- [ ] Complete a live browser test for owner, issuer and viewer access.
- [ ] Review retention, consent, correction and privacy procedures for learner records.

## Standards status

The registry is metadata-ready and supports online verification, expiry, reissue, suspension, revocation and audit history. It does not yet issue cryptographically signed W3C Verifiable Credentials or Open Badges 3.0 credentials, is not 1EdTech-certified and does not claim blockchain or electronic-seal functionality.
