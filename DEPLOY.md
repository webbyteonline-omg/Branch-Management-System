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

You only need to create **one** account by hand here — the **owner**. Every staff member is then added from inside the app (owner → Settings → Staff accounts), so you never touch the Supabase dashboard again.

Users sign in with a **simple User ID** (like `admin`), not an email. Internally the app maps the ID to a fixed e-mail domain `@branch.local`.

Go to **Authentication → Users → Add user**, turn ON **Auto Confirm User**, and create the owner:

| Sign-in ID | Email to enter in Supabase | Password | User Metadata (JSON) |
|---|---|---|---|
| **admin** | `admin@branch.local` | `admin123` | `{ "name": "Owner", "role": "owner", "branch_id": "ho" }` |

Expand **User Metadata** and paste the JSON. The trigger auto-creates the owner profile.

Now the owner logs in with **admin** / **admin123**, opens **Settings → Staff accounts → + Add staff**, and creates each staff member (name, login ID like `seppa`, password, and their branch). Those staff then log in with the ID/password the owner set. *(This requires the `admin-create-staff` function from Step 2b.)*

> Security note: because of RLS, a Seppa login literally cannot read or write Dirang data — it's blocked in the database, not just hidden in the app.

### Passwords & "forgot password"
- **Anyone can change their own password in-app**, instantly — top-right account menu → *Change password*. No email needed.
- **Owner can reset any staff password in-app** (for lock-outs) from **Settings → Staff passwords** — but that needs the Edge Function below deployed. Without it, the owner can instead reset a password instantly from **Supabase → Authentication → Users → (user) → Reset/Update password**.

## Step 2b — Deploy the owner Edge Functions

These power **Add staff** and **Reset staff password** inside the app (so the owner never needs the Supabase dashboard). Run once:

```bash
npm i -g supabase          # one-time
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-create-staff --no-verify-jwt
supabase functions deploy admin-reset-password --no-verify-jwt
supabase functions deploy admin-list-accounts --no-verify-jwt
supabase functions deploy admin-update-account --no-verify-jwt
```

`admin-list-accounts` and `admin-update-account` power **Settings → Manage Accounts**, where the owner can edit any account's name, User ID (login), and password — including their own — all in-app. No dashboard needed for day-to-day account changes.

**Tip — real forgot-password:** by default every login ID maps to a fake `@branch.local` email, so Supabase's email-based password reset can't reach anyone. If you (the owner) set your own User ID to a real email address (e.g. `you@gmail.com`) from **Settings → Manage Accounts → Edit**, the login screen's "Forgot password?" link will send you a real reset email for that account. Staff can stay on simple IDs like `seppa` since the owner can always reset their password in-app.

**`--no-verify-jwt` is required** — without it Supabase's gateway rejects the browser's CORS preflight (OPTIONS) request and you get a "blocked by CORS policy" error in the app. The functions still do their own auth (they verify the caller is the owner via their token), so security is unchanged.

The function files are in `supabase/functions/`. They run on Supabase's servers with the service-role key (which Supabase injects automatically — you never paste it anywhere). No Docker needed for deploy.

> If you skip these, you can still add staff / reset passwords manually from the Supabase dashboard (Authentication → Users), but the in-app buttons won't work.

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
