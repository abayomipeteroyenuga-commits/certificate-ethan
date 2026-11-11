# ETHAN CERTIFICATE v2.0.0 — Neon Edition

**Product:** ETHAN CERTIFICATE  
**Issuer:** Ethan Digital Academy  
**Parent company:** ALLON-MAADIAH INTERNATIONAL LIMITED (RC 1364788)  
**Tagline:** Issue. Verify. Authenticate.  
**Admin URL:** https://certificate.ethandigitalacademy.org  
**Public verification URL:** https://verify.ethandigitalacademy.org/?verify=EDA-CERT-YYYY-000001

## Backend

Ethan Certificate now uses a dedicated **Neon PostgreSQL** database. The browser communicates only with the same-origin Render web-service API at `/api/certificate`. Neon credentials are held in Render server-side environment variables and are never included in public JavaScript.

The Neon database is provisioned as `ETHAN CERTIFICATE`, database `ethan_certificate`. The schema is documented in `database/schema.sql`.

## Migration status

The previous Supabase database contained one owner account, one student, one certificate, one audit entry and one verification entry. Those six records (one each across the six record sets) have been copied into Neon with their original UUIDs, certificate number and verification token.

The original owner identity and owner role were retained. Password hashes were deliberately not copied. On first access, the migrated owner must use the one-time migration key and set a new password of at least 12 characters. This is a one-time activation; after success, normal email/password sign-in is used.

The original Supabase project has been left untouched as a temporary rollback copy. It is no longer referenced by the application source or browser configuration. Do not delete the old project until Neon login, issuance and public verification have been checked.

## Security and service design

- Server-side PostgreSQL access only; never put `DATABASE_URL` in browser code.
- Passwords are hashed with bcrypt; the database stores only the resulting password hash.
- Sessions use random opaque tokens in secure HttpOnly, SameSite=Lax cookies. Only SHA-256 hashes of those tokens are stored in Neon.
- Session lifetime is eight hours.
- Owner/admin may issue certificates and manage status.
- Issuer may issue/reissue and view the registry, but cannot suspend, revoke or reactivate.
- Viewer may view registry-safe information only; student contact fields, private remarks, status reason and evidence URL are redacted.
- Public verification returns certificate-safe achievement metadata only. Email, phone, private notes and evidence URLs are not returned.
- Public verification and password setup/sign-in have rate limits.
- Every issuance, reissue, status update and one-time owner activation creates an audit entry.
- No public administrator self-sign-up is provided.

## Render environment variables

Set the following on the `ethan-certificate` Render web service:

- `DATABASE_URL` — Neon pooled PostgreSQL connection string (Sensitive).
- `CERTIFICATE_BOOTSTRAP_TOKEN` — one-time owner activation key (Sensitive; remove after the owner has activated their account).

Do not expose either variable using a `VITE_`, `NEXT_PUBLIC_` or other client-prefixed name.

## First-time owner activation

1. Open https://certificate.ethandigitalacademy.org.
2. Choose **First-time migrated owner setup**.
3. Enter the existing owner email address and the one-time migration key supplied by the project owner.
4. Set a new password with at least 12 characters and confirm it.
5. After activation, use normal sign-in thereafter.

The migration does not provide public sign-up or a password reset email flow. Future staff accounts must be provisioned by the application owner through a trusted administrative procedure.

## Batch issuance (v2.0)

Authorised staff with certificate-issuing permission can open **Bulk issue (CSV)** from the registry workspace.

- Download the supplied CSV template and prepare up to 50 recipients per file.
- Required columns: `full_name`, `programme_name`, `course_title` and `date_completed`.
- Optional fields include email, phone, certificate title, duration, issue date, grade, signatory details, remarks, achievement description, earning criteria, skills, expiry date and framework alignment.
- The import is validated before issuing. Invalid rows are flagged; valid rows are issued one at a time through the same authenticated Neon API used by individual issuance.
- Each successful certificate receives its own unique registry number, QR verification URL and audit event. A results CSV records issued certificate numbers and any failed rows.

The batch is not a browser-only preview and does not bypass the owner's/issuer's normal permissions. Review all recipient details before confirming issuance.

## Public verification links

New certificate QR codes use the public verification alias, `https://verify.ethandigitalacademy.org/?verify=...`. The app now opens the public verifier even when the query parameter is initially empty.

## Deployment

The main administration application runs on the Render Node web service (`server.js`) at `https://certificate.ethandigitalacademy.org`. It serves the frontend and the Node API in `api/`, using the shared Neon database.

The public verification hostname is designed to run as a separate Railway web service from this same repository at `https://verify.ethandigitalacademy.org`. Configure the Railway service with:

- `DATABASE_URL` — the same Neon pooled PostgreSQL connection string (Sensitive).
- `VERIFY_ONLY=true` — enables verification-only API protection on that service.
- Do **not** set `CERTIFICATE_BOOTSTRAP_TOKEN` on the verification service.

Both services use `npm install` and `npm start`. Railway supplies the port through `PORT`; the Node server binds to `0.0.0.0`. Add `verify.ethandigitalacademy.org` as a custom domain on the Railway service and use the exact CNAME target Railway returns in Spaceship DNS.

When `VERIFY_ONLY=true`, the service permits only the public `verify_certificate` API operation. It rejects login, owner bootstrap, registry, student, issuance, status-change and other administrative API actions. The verification UI detects the `verify.` hostname and links administrators back to the Render-hosted main app. Keep `certificate.ethandigitalacademy.org` on Render.

The PWA service-worker cache key is versioned to refresh installed clients when app assets are updated.

## Certificate standards status

The registry is metadata-ready and supports online verification, expiry, reissue, suspension, revocation and audit history. It does **not** yet issue cryptographically signed W3C Verifiable Credentials or Open Badges 3.0 credentials; it is not 1EdTech-certified and does not claim blockchain or electronic-seal functionality.
