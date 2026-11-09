# ETHAN CERTIFICATE v1.2.0 — Neon Edition

**Product:** ETHAN CERTIFICATE  
**Issuer:** Ethan Digital Academy  
**Parent company:** ALLON-MAADIAH INTERNATIONAL LIMITED (RC 1364788)  
**Tagline:** Issue. Verify. Authenticate.  
**Admin URL:** https://certificate.ethandigitalacademy.org  
**Public verification URL:** https://verify.ethandigitalacademy.org

## Backend

Ethan Certificate now uses a dedicated **Neon PostgreSQL** database. The browser communicates only with the same-origin Vercel API at `/api/certificate`. Neon credentials are held in Vercel server-side environment variables and are never included in public JavaScript.

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

## Vercel environment variables

Set the following on the Vercel project for Production and Preview:

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

## Deployment

The project is a static frontend plus a Vercel Node API under `api/`. Vercel installs the pinned `pg` and `bcryptjs` dependencies. The public certificate and verification domains remain attached to this project.

## Certificate standards status

The registry is metadata-ready and supports online verification, expiry, reissue, suspension, revocation and audit history. It does **not** yet issue cryptographically signed W3C Verifiable Credentials or Open Badges 3.0 credentials; it is not 1EdTech-certified and does not claim blockchain or electronic-seal functionality.
