# Deploying to keralamarinesupply.in

Three stages: GitHub → Render → DNS. Budget about 30 minutes, most of it waiting for DNS.

---

## 0. Before you start — delete the broken `.git` folder

There is a partially-created `.git` folder in this project. It was started from a sandboxed environment that couldn't finish the job, and it contains a stale `index.lock` that will make every `git commit` fail with *"Another git process seems to be running"*.

Delete it first. In the project folder:

**PowerShell** (the blue terminal — this is what you're most likely using):

```powershell
Remove-Item -Recurse -Force .git
```

**Command Prompt** (the black terminal):

```cmd
rmdir /s /q .git
```

The two shells take different syntax; `rmdir /s /q` in PowerShell fails with *"A positional parameter cannot be found that accepts argument '/q'"*. You can also just turn on hidden files in Explorer and delete the `.git` folder by hand.

Then confirm `git status` says *"not a git repository"* before continuing.

---

## 1. Push to GitHub

Create an empty repository at [github.com/new](https://github.com/new) — name it `kerala-marine-supply`, leave it **private**, and do **not** tick "Add a README" (you already have one).

Then, in the project folder (git commands are the same in both shells):

```powershell
git init
git add .
git status
```

**Read that `git status` output before committing.** You should see about 29 files. You must *not* see `.env` — it holds your Firebase private key and your admin password. It's covered by `.gitignore`, so it should already be excluded; if it appears, stop and tell me.

```cmd
git commit -m "Kerala Marine Supply website and careers backend"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/kerala-marine-supply.git
git push -u origin main
```

---

## 2. Deploy on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign in with GitHub.
2. **New → Blueprint**, select the `kerala-marine-supply` repo.
3. Render reads `render.yaml` and shows the service. It will prompt for the six secret values — copy them straight out of your local `.env`:

   | Variable | Where it comes from |
   |---|---|
   | `FIREBASE_PROJECT_ID` | `kerala-marine-supply` |
   | `FIREBASE_CLIENT_EMAIL` | the `firebase-adminsdk-...@...` address |
   | `FIREBASE_PRIVATE_KEY` | the long quoted key |
   | `FIREBASE_STORAGE_BUCKET` | `kerala-marine-supply.firebasestorage.app` |
   | `ADMIN_USER` | `admin` |
   | `ADMIN_PASSWORD` | the generated password |

   **When pasting the private key, keep the `\n` sequences literal.** Don't let them become real line breaks — paste it exactly as it appears in `.env`, including the surrounding quotes.

4. Deploy. First build takes 2–3 minutes.
5. Check `https://kerala-marine-supply.onrender.com/api/health` — it should return `{"ok":true}`. If it returns `{"ok":false}`, the Firebase variables didn't come across correctly; the private key is the usual culprit.

### A word about the free plan

`render.yaml` sets `plan: free`. Free instances **spin down after 15 minutes of inactivity**, and the next visitor waits roughly 50 seconds for the site to wake up. Custom domains work fine on free — but for a business address you're handing to customers and job applicants, that first-visit delay is a poor impression.

To keep it always on, change one line in `render.yaml`:

```yaml
plan: starter   # $7/month
```

Your call. Everything else works identically either way.

---

## 3. Point the domain

### 3a. Add the domain in Render

Service → **Settings** → **Custom Domains** → **+ Add Custom Domain** → enter `keralamarinesupply.in`.

Render automatically adds `www.keralamarinesupply.in` alongside it and redirects www to the apex, so you get one canonical address. Both together count as 2 domains, which is exactly what the free Hobby workspace includes.

### 3b. Set the DNS records

Log in wherever `keralamarinesupply.in` is registered (BigRock, GoDaddy, Namecheap, Hostinger…) and open its DNS settings.

**First: delete any `AAAA` records.** Those are IPv6, Render is IPv4-only, and leaving one in place breaks routing *and* blocks the TLS certificate from being issued. This is the most common reason the whole thing silently fails.

Then add:

| Type | Name / Host | Value |
|---|---|---|
| `A` | `@` (the root) | `216.24.57.1` |
| `CNAME` | `www` | `kerala-marine-supply.onrender.com` |

If your registrar supports `ALIAS` or `ANAME` records, prefer that for the root instead of the `A` record — point it at `kerala-marine-supply.onrender.com`. It survives Render changing its load-balancer IP.

**Using Cloudflare?** You must use a CNAME for the root instead of an A record, and set the root record to "DNS only" (grey cloud), not proxied.

Also delete any existing "domain forwarding" or "parking" the registrar set up by default — those quietly override your records.

### 3c. Verify

Back in Render, click **Verify** next to the domain. If it fails, DNS hasn't propagated yet — wait and retry. Typically 10–30 minutes, occasionally a few hours.

Check propagation any time at [dnschecker.org](https://dnschecker.org/).

Once verified, Render issues a TLS certificate automatically and redirects all HTTP traffic to HTTPS. You don't need to configure certificates or redirects — the app deliberately doesn't do either, because doing it in both places causes redirect loops.

---

## 4. Confirm it all works

Visit in order:

- `https://keralamarinesupply.in` — home page, padlock in the address bar
- `https://www.keralamarinesupply.in` — should redirect to the address above
- `http://keralamarinesupply.in` — should redirect to `https://`
- `https://keralamarinesupply.in/careers.html` — job listings
- `https://keralamarinesupply.in/apply.html` — submit a real test application
- `https://keralamarinesupply.in/admin.html` — log in, confirm your test application appears, then delete it from the Firebase console

If the test application saves and shows up in admin, the whole chain — browser → Express → Firestore → Storage → admin — is working.

---

## Making changes later

Render redeploys automatically on every push to `main`:

```cmd
git add .
git commit -m "what changed"
git push
```

Changing an environment variable (rotating the admin password, say) is done in the Render dashboard under Environment, not by pushing — and it triggers a restart on its own.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `{"ok":false}` at `/api/health` | Firebase env vars wrong on Render — nearly always the private key's `\n` |
| Domain won't verify | Leftover `AAAA` record, or registrar domain-forwarding still active |
| 502 Bad Gateway right after verifying | Render still updating routes; wait a few minutes |
| First visit takes ~50s | Free instance cold start — upgrade to `starter` |
| Admin page won't accept the password | `ADMIN_PASSWORD` on Render doesn't match what you're typing |
| Applications submit but don't appear | Firestore rules aren't the issue (Admin SDK bypasses them) — check the Render logs |

Render logs are under the service → **Logs**, and they show the server-side error for any failed API call.
