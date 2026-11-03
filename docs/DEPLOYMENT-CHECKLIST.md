# ETHAN CERTIFICATE v1.1.1 — Production deployment checklist

## Database upgrade
- [ ] For an existing v1.0.2 deployment, run `database/migrations/001_global_credential_readiness.sql` once in Supabase SQL Editor.
- [ ] If the original v1.1.0 migration 001 was already applied, run `database/migrations/002_restrict_internal_helpers.sql` to remove direct API execution from internal helper functions.
- [ ] For a fresh project, run `database/schema.sql` (includes the v1.1.1 migration).
- [ ] Confirm `get_admin_role()` returns `owner` for the provisioned owner.
- [ ] Confirm owner/admin/issuer/viewer roles are assigned correctly.
- [ ] Confirm public self-sign-up is disabled in Supabase Auth.
- [ ] Enable Supabase leaked-password protection in Auth password security settings.
- [ ] Run Supabase Security and Performance Advisors after the migration; review SECURITY DEFINER warnings and verify each RPC grant/role check.
- [ ] Confirm only public verification RPC is callable by `anon`; administrative RPCs are restricted to `authenticated`. Internal role helpers `is_staff()` and `can_manage_certificates()` should not be directly executable by browser roles.

## Deploy
- [ ] Replace GitHub repository contents with the extracted v1.1.1 package contents.
- [ ] Import/deploy in Vercel as a static site; no build command; output directory `.`.
- [ ] Attach `certificate.ethandigitalacademy.org` and `verify.ethandigitalacademy.org` to the same project.
- [ ] Wait for DNS and HTTPS to be active.

## Role and session tests
- [ ] Owner can issue, suspend, revoke, reactivate, export and view all required records.
- [ ] Admin can issue and manage status.
- [ ] Issuer can issue/reissue and export but cannot change status.
- [ ] Viewer can view the safe certificate registry only; cannot issue, change status, export, access activity logs, or view student contact records.
- [ ] Sign out is visible in the top bar and sidebar, including on mobile.
- [ ] Sign out clears the current device session and returns to login.
- [ ] Signing out in another tab/session triggers a return to login.

## Credential tests
- [ ] Issue a test credential with achievement description, criteria and skill tags.
- [ ] Confirm public verification shows achievement metadata and no email, phone, private remarks or evidence URL.
- [ ] Confirm an expired active record displays EXPIRED CERTIFICATE.
- [ ] Confirm suspended and revoked records display the correct status.
- [ ] Test reissue and confirm the original record remains linked.
- [ ] Export the registry CSV and confirm it contains no student email or phone.
- [ ] Download and inspect PDF, scan QR using a separate device.

## Standards honesty and next phase
- [ ] Do not claim Open Badges 3.0 or W3C VC 2.0 conformance until cryptographic proof and conformance tests are implemented.
- [ ] Plan issuer key management, signed credentials, status/revocation proof, learner delivery/wallet, bulk issuance, credential analytics and 1EdTech conformance testing.
