# SafeTube Production Readiness (Vercel + Domain + Resend)

## 1) Vercel project setup

1. Push repository to GitHub.
2. In Vercel: `Add New Project` -> import this repository.
3. Build settings:
   - Framework: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Confirm `vercel.json` is in repo for client-side routes (`/dashboard`, `/channels`, `/kid`, etc.).

## 2) Environment variables (Vercel)

Set these in Vercel Project -> Settings -> Environment Variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_YOUTUBE_API_KEY`

Notes:
- Use `.env.example` as template.
- Never set `VITE_DEV_DEVICE_OWNER_ID` in production.
- Any `VITE_*` value is exposed to browser clients, so use public keys only.

## 3) Supabase URL/Auth settings for production domain

In Supabase -> Authentication -> URL Configuration:

- Site URL: `https://YOUR_DOMAIN`
- Redirect URLs:
  - `https://YOUR_DOMAIN/auth`
  - `https://YOUR_DOMAIN/onboarding`
  - `https://YOUR_DOMAIN/dashboard`

If you use Vercel preview deployments, optionally add:
- `https://*.vercel.app/*`

## 4) Connect custom domain to Vercel

1. Vercel -> Project -> Settings -> Domains -> add your domain.
2. Add required DNS records at your registrar (A/CNAME as Vercel instructs).
3. Wait for DNS verification and SSL issuance.
4. Re-deploy once domain is active.

## 5) Resend for professional auth emails

SafeTube uses Supabase Auth. To send branded verification emails, configure custom SMTP via Resend.

### 5.1 Resend setup

1. Create account at [Resend](https://resend.com/).
2. Add and verify your sending domain (e.g. `mail.YOUR_DOMAIN` or `YOUR_DOMAIN`).
3. Add DNS records requested by Resend (SPF + DKIM, and DMARC recommended).
4. Create API key (or SMTP credentials for Supabase SMTP config).

### 5.2 Supabase SMTP setup

In Supabase -> Authentication -> Settings -> SMTP Settings:

- Enable custom SMTP.
- SMTP host: `smtp.resend.com`
- Port: `587` (TLS)
- Username: `resend`
- Password: `YOUR_RESEND_API_KEY`
- Sender email: `no-reply@YOUR_DOMAIN`
- Sender name: `SafeTube`

Then customize email templates in Supabase Auth templates (subject/body/branding).

## 6) YouTube API production safety

In Google Cloud Console, restrict `VITE_YOUTUBE_API_KEY` by:

1. HTTP referrers:
   - `https://YOUR_DOMAIN/*`
   - `https://*.vercel.app/*` (optional for previews)
2. API restrictions:
   - Allow only `YouTube Data API v3`.

## 7) Final verification checklist

- App loads from custom domain.
- Signup sends email from your domain via Resend.
- Email verification flow succeeds.
- Parent login, device pairing, and `/kid` flow work in production.
- `is_blocked` changes reflect correctly in child mode.
- No secrets are committed (`.env` stays local only).
