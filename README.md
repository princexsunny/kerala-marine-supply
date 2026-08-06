# Kerala Marine Supply

Careers site + admin backend, built on:

- **Language:** JavaScript (Node.js + Express)
- **Frontend:** HTML + CSS + vanilla JS (`public/`)
- **Backend:** Express server (`server/`)
- **Database:** Firebase Firestore
- **Storage:** Firebase Storage (photos, resumes, documents)
- **Code hosting:** GitHub
- **Server hosting:** Render

## What's in here

```
public/            static site — served as-is by Express
  index.html         home page (self-contained export)
  careers.html        job listings
  apply.html           application form → POSTs to /api/apply via api.js
  admin.html            the admin page: photos, video, documents, applications
  login.html             admin sign-in form
  api.js                window.KMS.applyJob() — the glue apply.html calls
  site-media.js          puts the admin's photos + video onto the home page
  image-slot.js, support.js, _ds/   design-tool runtime assets, kept as-is

server/
  index.js            Express app, static file serving, route wiring
  firebase.js           Firebase Admin SDK init (Firestore + Storage)
  session.js             signed-cookie sessions for the admin login
  middleware/adminAuth.js  session check for the admin surface
  routes/
    auth.js              POST /api/login, /api/logout
    apply.js             POST /api/apply
    media.js              GET/PUT /api/media, POST/DELETE /api/media/video
    documents.js           POST/GET/DELETE /api/documents (document library)
    applications.js          GET/DELETE /api/applications  (admin review)
```

### How admin photos reach the home page

`index.html` was exported from a design tool, and its picture areas are
`<image-slot>` custom elements that only ever read from a local
`.image-slots.state.json` sidecar the tool wrote. That sidecar doesn't exist in
production, so for a while photos saved in the admin went into Firebase and
were never displayed anywhere — the admin appeared to work and the home page
never changed.

`site-media.js` is the bridge. It fetches `GET /api/media` and swaps each
`<image-slot>` for a real `<img>`, and injects a `<video>` section after the
photo strip when a video has been uploaded. Two things worth knowing if you
touch it:

- **`GET /api/media` must stay public** (mounted before `adminAuth` in
  `server/index.js`). It's what ordinary visitors call; behind auth it would
  401 for the entire audience.
- The home page is a **self-unpacking bundle** — it rebuilds the DOM after
  load, so the slots usually don't exist when the script first runs. That's why
  `site-media.js` watches for them with a `MutationObserver` instead of
  assuming `DOMContentLoaded` is late enough.

## API

| Method | Path              | Auth  | Purpose                                    |
|--------|-------------------|-------|---------------------------------------------|
| GET    | /api/health        | none  | `{ ok: true/false }` — is Firebase configured |
| POST   | /api/apply          | none  | Save a job application (name, phone, resume…) |
| GET    | /api/media           | none  | Site photos + video, for the home page |
| POST   | /api/login            | none  | Start an admin session (rate limited) |
| POST   | /api/logout            | none  | End the admin session |
| PUT    | /api/media              | admin | Save site photo slots (hero, photo1‑3, founder) |
| POST   | /api/media/video         | admin | Replace the home-page video (multipart: file) |
| DELETE | /api/media/video          | admin | Remove the home-page video |
| POST   | /api/documents             | admin | Upload a document (multipart: category, file) |
| GET    | /api/documents              | admin | List uploaded documents |
| DELETE | /api/documents/:id           | admin | Delete a document and its stored file |
| GET    | /api/applications             | admin | List job applications |
| DELETE | /api/applications/:id          | admin | Delete an application and its resume |

Admin routes (and `/admin.html`) require a signed-in session — see `server/session.js`. Sign in at `/login.html` with `ADMIN_PASSWORD`.

Upload ceilings: photos 15 MB each (the admin downscales them in the browser first), video 150 MB, documents 200 MB. The video limit is deliberately below the others because the file is held in memory before going to Storage, and Render's free tier only has 512 MB of RAM.

## 1. Set up Firebase

1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project**.
2. In the new project, enable **Firestore Database** (Build → Firestore Database → Create database, production mode is fine) and **Storage** (Build → Storage → Get started).

   Storage requires the **Blaze (pay-as-you-go) plan** on any project created after October 2024 — enforced since February 2026 — so you'll need a card on file. The always-free tier (5 GB stored, 100 GB egress/month) covers this site's usage many times over, so the expected bill is zero; set a budget alert in Google Cloud if you want a hard backstop.
3. Go to **Project settings → Service accounts → Generate new private key**. This downloads a JSON file — keep it private, never commit it.
4. Keep that file — step 2 reads it automatically. The storage bucket name is shown on the Storage page: `<project-id>.firebasestorage.app` for newer projects, `<project-id>.appspot.com` for older ones.

## 2. Configure environment variables

Leave the downloaded JSON in your Downloads folder and run:

```bash
npm install
npm run setup
```

That finds the service-account file, writes a correct `.env`, and generates a strong admin password (printed once — save it). To point at the file explicitly:

```bash
npm run setup -- "C:\path\to\your-key.json"
```

It won't overwrite an existing `.env` unless you pass `--force`.

<details>
<summary>Doing it by hand instead</summary>

```bash
cp .env.example .env
```

```
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=...
# ADMIN_USER is no longer used — the login page asks for a password only.
ADMIN_PASSWORD=pick-a-real-password
```

`FIREBASE_PRIVATE_KEY` must stay on one line with literal `\n` sequences, wrapped in double quotes — that's how the JSON file has it. The server converts them back to real newlines at startup, so both this form and Render's env-var form work.

</details>

## 3. Verify and run

```bash
npm run check
```

This does a real round trip — writes, reads and deletes a Firestore document, then uploads, downloads and deletes a Storage file. Any failure is reported with the specific thing to fix (malformed key, billing not enabled, wrong bucket name, and so on) rather than a raw stack trace.

Once it passes:

```bash
npm start
```

Visit `http://localhost:3000` for the site and `http://localhost:3000/admin.html` for the admin page — you'll be sent to `/login.html` to sign in with `ADMIN_PASSWORD`. `GET /api/health` returns `{ ok:false }` until Firebase is configured — the rest of the API returns a clear error message rather than crashing.

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "Kerala Marine Supply — Express + Firebase backend"
git branch -M main
git remote add origin https://github.com/<your-username>/kerala-marine-supply.git
git push -u origin main
```

`.env` and `serviceAccountKey.json` are already in `.gitignore` — double check `git status` before your first push so no secrets slip in.

## 5. Deploy to Render

**Option A — Blueprint (uses `render.yaml`):**
1. Render dashboard → **New → Blueprint** → pick your GitHub repo.
2. Render reads `render.yaml` and creates the web service; it will prompt you for each `sync:false` env var (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_STORAGE_BUCKET`, `ADMIN_PASSWORD`) — paste the same values from your `.env`.
3. Deploy. Render runs `npm install` then `npm start`.

**Option B — Manual web service:**
1. Render dashboard → **New → Web Service** → connect the repo.
2. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
3. Add the same environment variables under the service's **Environment** tab.

When pasting `FIREBASE_PRIVATE_KEY` into Render's env var UI, keep the `\n` escapes exactly as they appear in the downloaded JSON (don't paste actual line breaks).

## Notes

- **Resumes/documents/photos** are stored in Firebase Storage with long-lived signed URLs (valid to year 2500) — anyone with the link can view the file, but the paths aren't discoverable without going through the API.
- **index.html** is a self-contained export (images and the page template are bundled inline) — no other file it depends on needs to be present for it to render.
- **`admin.html` is the only admin page.** Two earlier ones (`Admin.dc.html`, a design-tool export that never rendered its data correctly, and `admin-dashboard.html`, a separate localStorage-only planner) were deleted because having three lookalike pages made it impossible to tell which one was actually working. Both old URLs 301 to `/admin.html` so old bookmarks still land somewhere sensible.
- Document uploads are capped at 200 MB in the API; Render's free plan has 512 MB RAM, so very large uploads may need a paid plan.
