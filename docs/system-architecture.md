# System Architecture and Technical Debt Roadmap

## Email System Overview

- **Transactional provider:** The project uses **Resend** for transactional emails (Welcome and PIN-related messages).
- **Trigger mechanism:** Email dispatch is initiated from **database triggers on `profiles`**, managed via migrations:
  - `supabase/migrations/021_hardcode_email_trigger_settings.sql`
  - `supabase/migrations/022_email_trigger_exception_safety.sql`
  - `supabase/migrations/023_email_trigger_pg_net_schema_fix.sql`
- **Auth emails:** Authentication emails are currently sent through **Supabase default SMTP**. During testing, we observed **auto-confirmation behavior** that needs explicit verification against expected policy.

## Known Issues and TODOs

### 1) Custom SMTP for strict email confirmation

If mandatory email confirmation is required, configure **Custom SMTP** in Supabase:

- Host: `smtp.resend.com`
- Port: `465`

This should align Supabase auth-email delivery with the same provider used for transactional messages.

### 2) Move profile creation to DB trigger

Current profile recovery includes client-side fallback logic. To reduce race conditions and bootstrap inconsistencies:

- Move profile creation responsibility to a **PostgreSQL trigger on `auth.users`**.
- Keep client behavior minimal (read-only bootstrap where possible).

### 3) Missing payment component

The client invokes an Edge Function named `create-checkout`, but the implementation is currently missing from the repository.

- Action: add and deploy the missing Edge Function.
- Validate end-to-end checkout flow from client invocation to provider redirect.

## Security Audit

### 1) Legacy Resend key cleanup

- Confirm that the old Resend API key prefix (`re_TWSv1...`) is fully removed from:
  - tracked files,
  - generated artifacts,
  - CI/CD logs and environment history where applicable.

### 2) Secret management policy

- Ensure all secrets are managed exclusively via environment variables or platform secret stores.
- Prevent hardcoded secrets in source-controlled files, migrations, and client bundles.

## Suggested Next Review Milestones

1. Finalize auth email policy (auto-confirm vs mandatory confirmation).
2. Complete DB-centric profile bootstrap migration.
3. Restore and test `create-checkout` Edge Function.
4. Run periodic secret scanning and rotation checks.
