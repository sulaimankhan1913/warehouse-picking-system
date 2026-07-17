# Warehouse Picking System

A professional mobile-ready warehouse operations app built with Next.js and Supabase.

## Included

- Unleashed sales-order PDF extraction endpoint
- Admin dashboard and live order stages
- Picker and packer workspaces
- Phone camera barcode scanning with manual fallback
- Quantity discrepancies and audit-log data model
- Admin, picker, and packer roles with row-level security
- Supabase Realtime-ready order, item, and discrepancy tables
- Reports workspace foundation

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Paste the Supabase Project URL and publishable/anon key.
3. Run the SQL in `supabase/migrations/001_warehouse_schema.sql` in Supabase SQL Editor.
4. Create the first user in Supabase Authentication, then promote that profile with `update public.profiles set role = 'admin' where id = '<user-id>';` in SQL Editor.
5. Install packages and run `pnpm dev`.

Without environment variables, the interface opens safely in demo-data mode.

## Deployment

Push the repository to GitHub, import it into Vercel, and add:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Do not add the service-role key unless server-only administration is implemented.
