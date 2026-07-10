# Branch Manager — Production Deploy Runbook

Stack: **React (Vite, PWA)** on **Vercel** + **Supabase** (PostgreSQL + Auth + Realtime).
Production code lives in `web/`. Database SQL lives in `supabase/`.

Total setup time: ~30–40 minutes. Do it once.

---

## Step 1 — Create the Supabase project (the backend)

1. Go to https://supabase.com → **New project**. Pick a region close to India (e.g. **Mumbai / ap-south-1**) for low latency. Set a strong database password and save it.
2. Wait ~2 min for it to provision.
3. Open **SQL Editor** → **New query** → paste the entire contents of `supabase/schema.sql` → **Run**. This creates all tables, the branch-level security (RLS), realtime, and the auto-profile trigger.
4. New query again → paste `supabase/seed.sql` → **Run**. This loads the branches and product catalog.
5. Go to **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key

## Step 2 — Create the user accounts

Staff sign in with a **simple User ID** (like `seppa`), not an email. Internally the app maps the ID to a fixed e-mail domain `@branch.local`, so in Supabase you create the users with these exact e-mails.

Go to **Authentication → Users → Add user**. Turn ON **Auto Confirm User** (so no email confirmation is needed). Create these three:

| Sign-in ID | Email to enter in Supabase | Password | User Metadata (JSON) |
|---|---|---|---|
| **admin** | `admin@branch.local` | `admin123` | `{ "name": "Owner", "role": "owner", "branch_id": "ho" }` |
| **seppa** | `seppa@branch.local` | `seppa123` | `{ "name": "Ravi Kumar", "role": "staff", "branch_id": "seppa" }` |
| **dirang** | `dirang@branch.local` | `dirang123` | `{ "name": "Tenzin Norbu", "role": "staff", "branch_id": "dirang" }` |

Expand **User Metadata** and paste the JSON for each. The trigger auto-creates their profile with the correct branch. To add more staff later, use the same pattern (e.g. `seppa2@branch.local`, ID `seppa2`).

So the owner logs in with ID **admin** / **admin123**, Seppa staff with **seppa** / **seppa123**, Dirang with **dirang** / **dirang123**.

> Security note: because of RLS, a Seppa login literally cannot read or write Dirang data — it's blocked in the database, not just hidden in the app.

### Passwords & "forgot password"
- **Anyone can change their own password in-app**, instantly — top-right account menu → *Change password*. No email needed.
- **Owner can reset any staff password in-app** (for lock-outs) from **Settings → Staff passwords** — but that needs the Edge Function below deployed. Without it, the owner can instead reset a password instantly from **Supabase → Authentication → Users → (user) → Reset/Update password**.

## Step 2b — (Optional but recommended) Deploy the password-reset function

This powers the in-app "Settings → Staff passwords" reset. Skip it if you'll reset from the Supabase dashboard instead.

```bash
npm i -g supabase          # one-time
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-reset-password
```

The function file is at `supabase/functions/admin-reset-password/`. It runs on Supabase's servers with the service-role key (which Supabase injects automatically — you don't paste it anywhere), and it verifies the caller is the owner before changing anything.

## Step 3 — Deploy the frontend to Vercel

1. Push the `web/` folder to a GitHub repo (or the whole project — set Vercel's **Root Directory** to `web`).
2. On https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Vite**. Root directory: `web`.
4. Add **Environment Variables**:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
5. **Deploy**. Vercel gives you a URL like `https://branch-manager.vercel.app`.

## Step 4 — Install on phones

- Open the Vercel URL on each staff phone → browser menu → **Add to Home Screen**. It installs like a real app and works offline.
- Owner opens the same URL on laptop + phone and logs in with the owner account.

## Step 5 — Backups & safety (Supabase)

- **Database → Backups**: daily backups are on by default on paid plans; on free tier, schedule a manual weekly export (or upgrade — recommended for a live business).
- Keep the database password and anon key safe. Rotate the anon key from Settings → API if a phone is lost, and change that staff member's password.

---

## Local development (optional)

```bash
cd web
cp .env.example .env      # fill in the two Supabase values
npm install
npm run dev               # opens http://localhost:5173
```

## How the offline / no-data-loss guarantee works

- Every sale/purchase is written to the phone's local database (**IndexedDB**) **first**, marked "unsynced". The staff never waits for the network.
- When the phone has internet, unsynced entries are uploaded to Supabase. Each entry has a unique id generated on the device, so re-trying an upload can **never** create duplicates.
- The owner's dashboard uses Supabase **Realtime**, so branch activity appears within seconds — no refresh needed.
- If the server is unreachable, entries simply stay queued on the phone and upload later. Nothing is ever lost.

## Going live checklist

- [ ] `schema.sql` + `seed.sql` run on a fresh Supabase project
- [ ] Owner + all staff accounts created with correct `branch_id` metadata
- [ ] Vercel env vars set, deployment green
- [ ] Installed on each staff phone, test one sale end-to-end
- [ ] Verify owner sees that sale live
- [ ] Update branches/products with the client's real data
- [ ] Add company name + logo (replace `web/public/icon.svg`, app name in `web/vite.config.ts`)
- [ ] Point client's domain at the Vercel project
