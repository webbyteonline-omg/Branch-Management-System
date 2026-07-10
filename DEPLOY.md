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

Do this in **Authentication → Users → Add user** (email + password). For each user, expand **User Metadata** and add JSON so they get the right role/branch automatically:

Owner (Head Office):
```json
{ "name": "Owner", "role": "owner", "branch_id": "ho" }
```
Seppa staff:
```json
{ "name": "Ravi Kumar", "role": "staff", "branch_id": "seppa" }
```
Dirang staff:
```json
{ "name": "Tenzin Norbu", "role": "staff", "branch_id": "dirang" }
```

Use real emails + passwords you give the staff. The trigger auto-creates their profile with the correct branch. (Repeat for every staff member.)

> Security note: because of RLS, a Seppa login literally cannot read or write Dirang data — it's blocked in the database, not just hidden in the app.

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
