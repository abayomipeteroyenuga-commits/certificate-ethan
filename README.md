# ETHAN CERTIFICATE v1.1.1 — Global Credential Readiness Upgrade

**Product:** ETHAN CERTIFICATE  
**Issuer:** Ethan Digital Academy  
**Parent company:** ALLON-MAADIAH INTERNATIONAL LIMITED (RC 1364788)  
**Tagline:** Issue. Verify. Authenticate.  
**Admin URL:** `https://certificate.ethandigitalacademy.org`  
**Public verification URL:** `https://verify.ethandigitalacademy.org`

## What this release adds

- Clear **Sign out** controls in the dashboard top bar and sidebar, including on mobile.
- Local-device Supabase sign-out, explicit feedback, and session-ended handling.
- Role-aware access for `owner`, `admin`, `issuer`, and `viewer`.
- Owners and admins can suspend, revoke and reactivate; issuers can issue/reissue; viewers can view certificate registry only.
- All certificate list reads use a role-checked registry RPC. Viewer responses omit student contacts, evidence links and internal notes; viewers also cannot query the certificate table, students or audit logs directly.
- Rich credential metadata: achievement description, earning criteria, skills/competencies, optional evidence link, optional expiry date and framework alignment.
- Public verification displays achievement information, skills and expiry status, while keeping email, phone, private notes and evidence URLs private.
- Expired certificates are identified as expired by verification, even if their underlying registry status remains active.
- CSV export of registry records for authorised staff (without student email or phone).
- Settings page documents international standards and the honest implementation status.
- PWA cache refreshed to v1.1.1.

## International systems reviewed

This release takes design direction from established credential ecosystems including Accredible and Credly, plus the open standards work of 1EdTech Open Badges 3.0, W3C Verifiable Credentials 2.0 and Europass Digital Credentials for Learning. Common practices include structured achievement metadata, criteria, skills, evidence, expiry, issuer identity, learner portability, controlled verification and credential analytics.

**Important standards distinction:** v1.1.1 is metadata-ready and registry-verifiable. It does **not** yet issue cryptographically signed W3C Verifiable Credentials or Open Badges 3.0, does not have an electronic seal, does not provide a learner wallet, and is not 1EdTech certified. The next standards phase requires issuer key management, a cryptographic proof format, public-key/DID resolution, signed status/revocation data, portable learner delivery and conformance testing. Do not market this build as blockchain-backed, tamper-proof, W3C VC compliant or Open Badges certified.

## Database upgrade instructions

The existing v1.0.2 Supabase project already has the original five tables and RPCs. **Before deploying the v1.1.1 frontend, run this migration once** in the Supabase SQL Editor:

`database/migrations/001_global_credential_readiness.sql`

It adds credential metadata columns, the v2 issuance RPC, a role-aware registry RPC with field redaction for viewers, role lookup, owner/admin-only status changes, expiry-aware public verification, and least-privilege grants for internal role helpers. The script is designed to be re-runnable. For a brand-new Supabase project, `database/schema.sql` includes the original schema and these security settings.

If you already applied the earlier v1.1.0 version of migration 001, apply `database/migrations/002_restrict_internal_helpers.sql` once to revoke direct API execution from the internal `is_staff()` and `can_manage_certificates()` helpers.

After migration, verify the owner row remains active in `public.admin_users`. The roles are:

| Role | Permissions |
|---|---|
| `owner` | Full registry control and staff oversight |
| `admin` | Issue, manage status, view records and export |
| `issuer` | Issue/reissue and view records; cannot suspend/revoke/reactivate |
| `viewer` | View certificate registry only; no student contact access, activity logs or write actions |

## Security and production notes

- Disable public self-sign-up in Supabase Authentication before launch.
- Enable leaked-password protection in Supabase Auth. The existing project advisor check on 3 November 2026 reported this setting is currently disabled.
- Re-run Supabase Security and Performance Advisors after applying the migration. Existing SECURITY DEFINER warnings include the intentionally public verification RPC and authenticated administrative functions; verify the exact grants and server-side role checks.
- Add rate limiting and abuse monitoring to public verification before broad public launch.
- Keep the Supabase service-role/secret key out of all browser files and GitHub. `config.js` must contain only the publishable/anon key.
- Use MFA for owner accounts where available.
- Review staff membership in `public.admin_users` regularly.
- The `evidence_url` is restricted to owner, admin and issuer table access, and is deliberately excluded from the viewer-safe registry RPC and public verification.
- Public verification exposes certificate-safe achievement metadata only.
- Current public verification uses the database registry and QR lookup; cryptographic proof verification and rate-limiting still need a dedicated backend/security phase.

## Deployment

1. For an existing v1.0.2 database, run migration 001. If you previously applied the original v1.1.0 migration 001, run migration 002 as well.
2. Replace the GitHub repository contents with this package's extracted contents (do not upload the ZIP file itself).
3. Import/deploy the repository in Vercel as a static site with no build command and output directory `.`.
4. Attach `certificate.ethandigitalacademy.org` and `verify.ethandigitalacademy.org` to the same Vercel project.
5. Test owner, admin, issuer and viewer access separately.
6. Test sign-out, expiry, PDF generation, QR verification, suspension, revocation and replacement issuance on a separate device.
7. Confirm public self-sign-up is disabled and no secrets are exposed.

## Project structure

```text
ethan-certificate/
├── index.html
├── app.js
├── styles.css
├── config.js
├── manifest.webmanifest
├── sw.js
├── vercel.json
├── assets/
├── database/
│   ├── schema.sql
│   └── migrations/
│       └── 001_global_credential_readiness.sql
└── docs/
    ├── ADMIN-SETUP.md
    ├── DEPLOYMENT-CHECKLIST.md
    └── GLOBAL-CREDENTIAL-ROADMAP.md
```
