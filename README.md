# ETHAN CERTIFICATE v1.0 — PWA / GitHub / Vercel build

**Product:** ETHAN CERTIFICATE  
**Purpose:** Official certificate issuance and public verification for Ethan Digital Academy.  
**Tagline:** Issue. Verify. Authenticate.  
**Proposed application URL:** `https://certificate.ethandigitalacademy.org`  
**Proposed public verification URL:** `https://verify.ethandigitalacademy.org`

## Included in this package

- Responsive administrator dashboard.
- Administrator sign-in through Supabase Auth (no public sign-up).
- Certificate issuance with server-generated unique IDs in the format `EDA-CERT-YYYY-000001`.
- Student profile creation/update as part of certificate issuance.
- Ethan navy-blue and gold landscape certificate design.
- QR code linked to the public verification page.
- PDF export and browser print.
- Certificate registry, search, status management and audit log.
- Public verification by certificate number or QR token.
- Revoked and suspended status handling, reactivation and linked replacement issuance.
- PWA manifest, icons and service worker.
- Supabase schema, RLS policies and secured RPC functions.
- Vercel rewrite configuration.

## Important: preview mode vs official operation

The package opens in **Preview mode** until a Supabase project is connected. Preview records are stored only in the current browser and are visibly marked **DEMO ONLY — NOT VALID**. They are not official certificates and cannot be independently verified from another device.

To issue official certificates, complete the Supabase setup below, deploy the app over HTTPS, and test the public verification domain before issuing real learner records.

## 1. Supabase connection — completed

A dedicated Supabase project has already been created and connected to this build:

- **Project:** `ethan-certificate`
- **Project reference:** `ypmamxyorsnoyrwuqxxk`
- **Region:** EU West (Ireland)
- **Project URL:** `https://ypmamxyorsnoyrwuqxxk.supabase.co`
- **Database:** schema deployed; five registry tables created with Row Level Security enabled.
- **Frontend configuration:** `config.js` is populated with the project's public publishable key.

The first owner account has been created in **Authentication → Users** and promoted to the `owner` role in `public.admin_users`. The remaining Auth configuration action is to disable public sign-up in the Supabase Authentication settings. Only trusted administrators should be invited by the owner.

**Never use a Supabase `service_role` or secret key in `config.js`.** The browser receives only the publishable key. RLS and the database RPC functions enforce permissions.

## 2. Deploy to GitHub and Vercel

1. Create a new GitHub repository, for example `ethan-certificate`.
2. Upload the contents of this package to the repository root (not the ZIP file itself).
3. In Vercel, import the repository as a new project.
4. This is a static web application; no build command is required. Set the output directory to `.` (project root).
5. Deploy and test the Vercel preview URL.
6. Add `certificate.ethandigitalacademy.org` to the Vercel project and configure its DNS records as Vercel instructs.
7. Add `verify.ethandigitalacademy.org` as a second domain/alias to the same Vercel project and configure its DNS records.
8. Wait for HTTPS certificates to become active.

`vercel.json` routes app paths to `index.html`, so the public verification experience works at the root of the verify subdomain.

## 3. First production test

Before using the platform for real certificates:

- Sign in with the provisioned owner account.
- Issue one test certificate to a clearly identified test recipient.
- Confirm its number is unique and follows `EDA-CERT-YYYY-000001`.
- Download and inspect the PDF on desktop and mobile.
- Scan the QR code using a different device/browser.
- Confirm the public page returns **VALID CERTIFICATE** for the active record.
- Revoke the test certificate with a reason and confirm the public page returns **REVOKED CERTIFICATE**.
- Confirm a non-admin user cannot access the admin registry or issue certificates.
- Delete or clearly retain the test record according to the academy's recordkeeping policy; do not use test records as real awards.

## 4. PWA installation

After deployment over HTTPS, open the app in Chrome or Edge and use **Install app** from the browser interface. On supported mobile browsers, use **Add to Home Screen**. The service worker caches the app shell; official issuing and verification still require an internet connection to reach Supabase.

## 5. v1.0 scope and limitations

- Single issuer: Ethan Digital Academy only. The database is structured so multi-institution support can be added in a later version, but external issuers are not enabled in v1.0.
- The certificate PDF is generated in the browser from the official database record. The registry record is the source of truth.
- Public verification exposes only certificate-safe fields. Student email, phone, private remarks and internal audit data are not returned.
- Certificate number sequence is global and the year is included in the displayed number; the counter does not reset each January.
- Replacement certificates receive a new ID and are linked to the previous suspended/revoked record; the previous record remains in the audit trail.
- PDF export and QR generation load small browser libraries from public CDNs and therefore require internet access. Print-to-PDF is also available.
- The build is connected to the dedicated Supabase project, the database schema has been deployed, and the first owner account has been provisioned. Disabling public sign-up, GitHub/Vercel deployment, custom-domain DNS, and end-to-end production testing are still pending.

## Folder structure

```text
ethan-certificate/
├── index.html
├── app.js
├── styles.css
├── config.js
├── manifest.webmanifest
├── sw.js
├── vercel.json
├── robots.txt
├── assets/
│   ├── brand-mark.svg
│   ├── ethan-certificate-logo.png
│   ├── icon-192.png
│   └── icon-512.png
├── database/
│   └── schema.sql
└── docs/
    └── ADMIN-SETUP.md
```
