# Chess Sathi website: setup

The website has puzzles, practice, openings and tests, a **sign-in with username and password**, and **live classes**
(video call, chat, screen share, raise hand, backgrounds, recording). Parents can watch recordings.

Everything runs on free plans to start. You need 4 small accounts' worth of settings. Never paste these keys into a chat or into GitHub.
Put them only in **Vercel → your project → Settings → Environment Variables**.

## 1. Teacher password and secret
Add two settings:
- `TEACHER_PASSWORD`: the password you will use to sign in. Your username is `teacher`.
- `SESSION_SECRET`: a long random text (30+ characters). Never share it.

## 2. Database (stores students, parents and classes) — free
In Vercel open **Storage → Create → Upstash (Redis)**, pick the free plan, and **connect it to this project**.
Vercel adds the settings by itself (`KV_REST_API_URL` and `KV_REST_API_TOKEN`). The site accepts those names.

## 3. LiveKit Cloud (the live video) — free 5,000 minutes a month
1. Make an account at cloud.livekit.io and create a project.
2. In the project open **Settings → Keys** and create a key.
3. Add three settings:
   - `LIVEKIT_URL`: the project address, like `wss://your-project.livekit.cloud`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`

## 4. Recording storage (Cloudflare R2) — free 10 GB
1. At dash.cloudflare.com open **R2** and create a bucket, for example `chess-sathi-recordings`.
2. In the bucket's **Settings → Public access**, turn on the `r2.dev` address. Copy it.
3. In **R2 → Manage API tokens** create a token with **Object Read & Write** for that bucket. Copy the Access Key ID and the Secret.
4. Add five settings:
   - `RECORD_S3_ENDPOINT`: `https://<your-account-id>.r2.cloudflarestorage.com`
   - `RECORD_S3_BUCKET`: the bucket name
   - `RECORD_S3_ACCESS_KEY` and `RECORD_S3_SECRET`
   - `RECORD_PUBLIC_URL`: the `r2.dev` address, like `https://pub-xxxx.r2.dev`

Recordings use long random file names, so the links can't be guessed, and the website only shows them to the teacher,
the students of that batch and their parents.
**Note:** LiveKit's free plan includes only about 60 minutes of recording a month. After that, recording is a few
rupees per hour on LiveKit's paid plan. Live classes themselves stay within the 5,000 free minutes.

## 5. Sathi, the AI puzzle coach (optional) — free
Sathi explains a student's wrong move in plain English and answers questions on the level puzzles. It uses a free open model (Llama) hosted by a provider. Without a key the puzzles still work: Sathi just shows a short built-in message instead.
1. Make a free key at https://console.groq.com (the first choice). Optionally also make one at https://cloud.cerebras.ai as a backup.
2. In Vercel -> Settings -> Environment Variables add `GROQ_API_KEY` (and `CEREBRAS_API_KEY` if you made one). Redeploy.
3. Optional settings: `AI_PROVIDERS` (order to try, default `groq,cerebras,openrouter`), `GROQ_MODEL` / `CEREBRAS_MODEL` / `OPENROUTER_MODEL` (model names; free model lists change, so check the provider's list if Sathi stops answering), `AI_DAILY_LIMIT` (questions per student per day, default 40), `AI_GLOBAL_LIMIT` (whole app per day, default 900, to stay inside the free limits).
Only the position and moves are sent to the provider, never a student's name.

## 5b. Tournament reminders by email (optional) — free
The Tournaments screen works without this (parents still see reminders in the app). To also send **email** reminders:
1. Make a free account at https://resend.com and create an **API key**.
2. In Vercel -> Settings -> Environment Variables add:
   - `RESEND_API_KEY` - the key from Resend.
   - `CRON_SECRET` - any long random text you make up. Vercel sends it with the daily job; without it the job refuses to run, so nobody else can trigger emails.
   - `MAIL_FROM` - for example `Chess Sathi <reminders@yourdomain.com>`. Until you verify a domain in Resend (Resend -> Domains), it can only email **your own** address, so verify one before parents use it.
   - `APP_URL` (optional) - the site address, e.g. `https://your-site.vercel.app`, so the email can link back to the app.
3. Redeploy. The daily job runs at about 8 AM India time. It also refreshes the Karnataka tournament list from the AICF website.
Free plan limits: Resend sends up to 100 emails a day; Vercel Cron runs once a day (so a reminder arrives that morning, not at an exact hour).

## 6. Deploy
- Vercel project settings: Framework **Vite**, build command `vite build`, output `dist` (already in `vercel.json`).
- If your GitHub repo keeps the website on its own branch, set **Settings → Git → Production Branch** to that branch.
- After adding settings, click **Redeploy**.

## 7. First test
1. Open the website, sign in as `teacher` with your `TEACHER_PASSWORD`.
2. **Live** tab → **Add a student** → send the username and password to the family (there is a copy button for WhatsApp).
3. **Schedule a class** for that batch, press **Start class**, then join from a second phone as the student.
4. Leave the class, wait a few minutes, and open the recording from the parent login.

## The mobile app
Put the website address in the app's `src/config.js` (`SITE_URL`). Everyone signs in with the same username and password.

## Run the checks (developers)
`npm test` checks the whole API against a fake database and a fake LiveKit. `npm run build && node test/dev-server.mjs`
opens a demo at http://localhost:4173 (teacher password `demo-teacher`) that needs no accounts.
