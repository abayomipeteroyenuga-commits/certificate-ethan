# ETHAN CERTIFICATE — International credential roadmap

## Systems and standards reviewed

- **Accredible:** credential design, metadata, skills frameworks, expiration, learner wallet, share links, integrations, bulk upload, analytics and issuer controls.
- **Credly:** issuer-controlled credentialing, badge metadata, learner sharing, portability and Open Badges support.
- **1EdTech Open Badges 3.0:** standardised achievement metadata, earner, issuer, criteria, evidence, skill claims, portable JSON-LD and cryptographic verification.
- **W3C Verifiable Credentials 2.0:** issuer/holder/verifier model, credential claims, validity, status and cryptographic securing mechanisms.
- **Europass Digital Credentials:** electronic seals, signed credential envelopes, portable learner delivery and automatic integrity checks.

## Delivered in v1.1.1

- Visible sign-out in dashboard top bar and sidebar.
- Current-device session sign-out and signed-out event handling.
- Role separation: owner/admin, issuer, viewer.
- Viewer can use only the safe certificate registry RPC; student contact records and activity logs remain restricted.
- Credential metadata fields for achievement description, criteria, skills, evidence reference, expiry and framework alignment.
- Public verifier displays safe achievement metadata and expiry-aware status.
- CSV export for authorised staff.
- Settings page transparently describes standards readiness and limitations.

## Planned v1.2+ work

1. **Cryptographically signed credentials:** issue W3C VC 2.0 / Open Badges 3.0 credentials using an approved proof suite, server-side issuer keys and key rotation.
2. **Credential status lists:** verifiable suspension/revocation status, independent of a simple database lookup.
3. **Learner credential wallet:** recipient delivery, claim flow, portable credential download and sharing.
4. **Bulk issuance:** CSV import with row validation, duplicate detection, preview and controlled batch issuance.
5. **Credential analytics:** issue trends, verification counts, sharing metrics and programme outcomes.
6. **Template designer:** multiple certificate/badge templates, languages and expiration defaults.
7. **Integrations:** Ethan Learn completion hooks, APIs and webhook-based automatic issuance.
8. **Interoperability and assurance:** validate against the 1EdTech Open Badges 3.0 test suite and W3C VC test vectors; do not display certification logos unless certification is formally granted.

## Security work still required before production

- Confirm Supabase public sign-up is disabled.
- Enable Supabase leaked-password protection; the current advisor check reports it disabled.
- Review SECURITY DEFINER advisor warnings after the v1.1.1 migration and retain only RPCs with explicit role checks and narrow grants.
- Apply the database migration before deploying this frontend.
- Configure owner MFA and administrator recovery procedures.
- Add rate limiting and abuse monitoring to public verification.
- Establish retention, correction, consent and privacy procedures for learner records.
- Perform live end-to-end tests after Vercel and DNS deployment.

## Reference links

- Accredible platform integrations: https://www.accredible.com/services/integrations
- Credly credential features and Open Badges 3.0: https://info.credly.com/acclaim-product-features
- 1EdTech Open Badges 3.0 specification: https://www.imsglobal.org/spec/ob/v3p0
- W3C Verifiable Credentials Data Model 2.0: https://www.w3.org/TR/vc-data-model/
- Europass Digital Credentials issuer guidance: https://europass.europa.eu/en/how-issue-european-digital-credentials-learning
