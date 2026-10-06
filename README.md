# EVARA BNS

EVARA BNS is a Supabase-powered employee attendance system with role-based access for admins and employees.

## Features

- Supabase Auth with profile-based roles
- Admin employee management
- Live attendance check-in and check-out
- QR attendance access
- Manual attendance entry for admins
- QR-only attendance (printed office QR + office network check)
- Admin Excel timesheet export per employee (one sheet per month)
- 8-hour actuals dashboard for daily shift completion, overtime, and shortfall
- Default business schedule: Sunday to Thursday, flexible check-in at 8:00 AM or 9:00 AM, and check-out at 4:00 PM or 5:00 PM, with Friday and Saturday as weekly days off
- CSV export for employees and attendance history
- Advanced reports with working hours, overtime, shortfall, and employee timesheets
- Employee request management:
  - Two-hour delay requests (maximum 2 requests per employee per month)
  - Annual leave requests (maximum 21 days per employee per year)
- Client-side pagination for employee and history views
- Rate limiting, sanitization, and HTTP header hardening
- Modular frontend helpers for reporting and export workflows
- English/Arabic toggle with RTL support in the admin dashboard; sign-in, QR check-in, password recovery and all employee screens are English only

## Frontend architecture and performance

- `public/css/style.css` contains the component layout and `public/css/redesign.css` contains the current visual system, including responsive and RTL refinements.
- The login and password recovery headers show original sayings (in English) from `public/js/rotatingQuotes.js`. They rotate every 15 seconds without repeating within a cycle, choose a different saying on the next visit, and offer a pause control. Reduced-motion preferences start rotation paused, and hidden tabs do not rotate. No network request is needed for the sayings.
- `public/js/app.js` coordinates navigation and page rendering. `public/js/dataStore.js` owns query caching and complete, batched Supabase reads.
- Attendance and employee reads used in monthly reports are fetched in 500-row pages, avoiding silent truncation at the Supabase API row limit.
- After a page renders, the app only preloads the most likely next screen instead of issuing requests for every section. Data cache entries are invalidated when related data changes.
- Run `npm run test:data` to verify batched reads and cache invalidation.

## Speed

- **Compression:** `middlewares/staticAssets.js` serves scripts, styles and the HTML pages with Brotli (or gzip), cached in memory after the first request. No extra npm package is needed.
- **Long-term caching:** in production every asset link in the HTML points to `/v/<version>/...`, where the version is a hash of `public/`. Those files are cached for a year; any deploy that changes a file changes the version, so browsers fetch the new copy by themselves. Locally URLs stay unversioned and are revalidated. `/api/health` reports `asset_version`.
- **Translations:** `public/js/locales/en.js` ships with the page; `ar.js` is fetched only when an admin uses Arabic. Edit strings in these two files.
- **Lazy modules:** the CSV exporters and the camera QR reader load only when used.
- **Live updates:** a change made by someone else drops the cached data and shows admins a small "new updates" button instead of rebuilding the page; an employee's own screen refreshes only when no dialog or form field is in use.
- Run `npm run test:speed` to check compression, caching and translation loading.

## Check-out reminders

Employees can turn on a push notification that reminds them to check out (Me -> Check-out reminder). A shift is reminded once, 8 h 15 min after check-in, or at 21:00 Cairo time if still open.

- On iPhone, notifications only work from the Home Screen app (iOS 16.4+): add the site to the Home Screen, open it from there, then enable reminders.
- The server never runs its own timer (Render's free plan sleeps). The `Check-out reminders` GitHub Action calls `POST /api/cron/checkout-reminders` every 30 minutes on working days, which also wakes the server.

Setup, once:
1. Run migration `supabase/migrations/012_checkout_reminders.sql` in the Supabase SQL editor.
2. Generate keys: `npx web-push generate-vapid-keys`. On Render set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` your email) and `CRON_SECRET` (16+ random characters).
3. In GitHub -> Settings -> Secrets and variables -> Actions add `APP_URL` (the site URL, no trailing slash) and `CRON_SECRET` (same value).
4. Optional check: Actions -> Check-out reminders -> Run workflow; the log shows how many shifts were open, due and reminded.

GitHub pauses scheduled workflows after 60 days without repository activity; re-enable it from the Actions tab if that happens.

## Local Development

### Password recovery

The sign-in screen links to `/password-reset`. It sends a Supabase password recovery email and accepts the recovery session to set a new password. Add the exact callback URL `http://localhost:5000/password-reset?mode=update` to Supabase Auth → URL Configuration → Redirect URLs for local use, and add the equivalent HTTPS URL for the deployed site. Set the Supabase Site URL to the deployed application and configure email delivery before rollout. See the [Supabase password recovery API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

The UI handles invalid or expired links, password strength, confirmation mismatch, request errors, and successful updates. Recovery sessions stay in memory and are not stored in the browser; a normal stored session alone does not open the password reset form. Reloading the reset page requires opening the recovery email link again or requesting a new link. Login sessions already persist and refresh automatically; employees stay signed in for 30 days of inactivity (so the office QR works every morning without a new sign-in), while admin sessions keep the eight-hour inactivity limit. Without Supabase configuration, sign-in and recovery submission are disabled with a user-facing notice.

### Setup

1. Install dependencies:

```bash
npm install
```

2. Create or update `.env` with the required values (see `.env.example` for reference):

```env
PORT=5000
HOST=0.0.0.0
NODE_ENV=development

FRONTEND_URL=http://localhost:5000
QR_TARGET_URL=http://localhost:5000/checkin

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
RATE_LIMIT_MAX_REQUESTS=200
RATE_LIMIT_REDIS_ENABLED=false
REDIS_URL=
RATE_LIMIT_REDIS_PREFIX=evara:rate-limit:
RATE_LIMIT_IPV6_SUBNET=56

APP_URL=http://localhost:5000
API_BASE_URL=/api

SUPABASE_URL=<your-supabase-url>
SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>

INITIAL_ADMIN_FULL_NAME=System Admin
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=<secure-password>

TRUST_PROXY_HOPS=1
REQUEST_LOG_FORMAT=

ATTENDANCE_ACCESS_MODE=off
ATTENDANCE_ALLOWED_IPS=
# Optional explicit lists (also comma-separated)
ATTENDANCE_ALLOWED_IP_PREFIXES=<optional-prefixes-like-192.168.1.*>
ATTENDANCE_ALLOWED_CIDRS=<optional-cidrs-like-10.0.0.0/24>
```

Optional structured request logs:

```env
# empty/default = morgan logs, json = one-line JSON logs
REQUEST_LOG_FORMAT=json
```

Optional Redis-backed rate limiting (recommended for multi-instance production):

```env
RATE_LIMIT_REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379
RATE_LIMIT_REDIS_PREFIX=evara:rate-limit:
```

3. Run the app:

```bash
npm start
```

4. Run a quick code health check:

```bash
npm run check
```

5. Run smoke checks (with your local server running):

```bash
npm run smoke
```

6. Open:

- App: `http://localhost:5000`
- Health: `http://localhost:5000/api/health`

## Supabase Setup

1. Open the Supabase SQL editor.
2. Run [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql).
3. Run [supabase/migrations/002_fix_attendance_timestamp_functions.sql](supabase/migrations/002_fix_attendance_timestamp_functions.sql).
4. Run [supabase/migrations/003_update_business_schedule.sql](supabase/migrations/003_update_business_schedule.sql).
5. Run [supabase/migrations/004_adjust_checkin_window_to_8_9.sql](supabase/migrations/004_adjust_checkin_window_to_8_9.sql).
6. Run [supabase/migrations/005_create_employee_requests.sql](supabase/migrations/005_create_employee_requests.sql).
7. Run [supabase/migrations/006_flexible_checkin_no_auto_late.sql](supabase/migrations/006_flexible_checkin_no_auto_late.sql).
8. Run [supabase/migrations/007_atomic_request_quota_enforcement.sql](supabase/migrations/007_atomic_request_quota_enforcement.sql).
9. Run [supabase/migrations/008_server_only_writes.sql](supabase/migrations/008_server_only_writes.sql) before deploying the matching server code.
10. Run [supabase/migrations/009_checkout_work_notes.sql](supabase/migrations/009_checkout_work_notes.sql) before deploying the daily work notes UI.
11. Run [supabase/migrations/010_qr_only_attendance_and_timesheet_exports.sql](supabase/migrations/010_qr_only_attendance_and_timesheet_exports.sql) before deploying QR-only attendance and Excel export.
12. Enable Email/Password authentication in Supabase Auth.
13. Set redirect URLs for your local or deployed app.

### Employee work timesheets

Each employee's monthly dashboard and the admin's selected-employee report use the reference layout: Day, Date, From, To, Training, Work, Place, Notes. The CSV export uses the same eight columns and includes every calendar day and totals. Hours are decimal values; recorded training is included in attendance duration and subtracted from the Work column. Missing historical training/place/notes remain blank, and open shifts do not get invented final hours.

Both dashboard and QR check-out open a daily summary form. Notes are required (1–4000 characters); workplace and training time are optional. The API validates the fields, and migration 009 commits notes and the server-generated checkout timestamp together. An overnight checkout belongs to the check-in date if the open shift began within the prior 24 hours. Failed requests keep the draft in page memory for a retry. Closing/reloading the page clears the draft. Existing historical records are preserved. Run `npm run test:attendance` for the API and timesheet checks.

### Reset EVARA application data

The reset command targets the Supabase project in `.env`. It deletes **all Auth users in that project** and the four EVARA tables (attendance, employee requests, logs, and profiles), then creates one fresh admin from `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, and `INITIAL_ADMIN_FULL_NAME`. Use it only when this Supabase project belongs entirely to EVARA. Stop running app instances first so automatic admin bootstrap cannot race the reset.

```bash
npm run reset:supabase
npm run reset:supabase -- --execute --project=<hostname printed by preview>
```

The first command only lists counts and the project hostname. The second performs the irreversible reset. The script verifies that only the new admin remains and all business tables are empty. Configure the Supabase URL, service role key, and initial admin credentials locally; never commit them. Apply migration 008 before deploying the API-only write path.

### QR-only attendance

Check-in and check-out are accepted **only** from the office QR code. The dashboard no longer has check-in/check-out buttons.

1. Run migration 010. It creates `attendance_settings` (QR secret, office-network switch, approved networks) and `timesheet_exports`.
2. As an admin, open **QR Access**. Print the QR code and place it at the office. The QR opens `/checkin?k=<secret>`.
3. On the same page, open it from a device on the office Wi-Fi, press **Add this IP**, and save. With *Require the office network* on (the default), attendance is rejected from any other network, so a photo of the QR cannot be used from home. Until at least one network is approved, nobody can record attendance.
4. Employees scan the QR on arrival to check in. When leaving they scan the same QR again; check-out opens the daily summary form (notes required).
   The employee Home/Today card now opens an in-site rear-camera scanner, and `/checkin` offers the same scanner when a new scan is needed. Camera permission is requested only after the employee presses the button. The camera stops on close, a successful scan, or leaving the tab. Only this app's `/checkin` QR URLs are accepted; the attendance API still enforces the QR secret and office network. Camera access requires HTTPS on phones (localhost works for local browser testing).
5. **Generate New Code** replaces the secret; every old printout stops working immediately.

The camera reader loads the bundled [jsQR](https://github.com/cozmo/jsQR) decoder only when opened; frames are decoded locally in the browser and are not uploaded. The vendor copy is `public/vendor/jsQR.js`, sourced from the pinned `jsqr` npm dependency; its Apache-2.0 license is included alongside it. To refresh it after an intentional dependency upgrade, copy `node_modules/jsqr/dist/jsQR.js` and `node_modules/jsqr/LICENSE` to the vendor paths.

The scanned secret is kept only in the current browser tab for 15 minutes and is cleared after each successful action, so check-out needs a fresh scan. The API checks the secret with a constant-time comparison and reads the client IP from `req.ip`, so set `TRUST_PROXY_HOPS` to the real number of proxies in front of the app (Render/Nginx: `1`). Spoofed `X-Forwarded-For` headers are ignored beyond that hop count. `ATTENDANCE_ALLOWED_IPS`, `ATTENDANCE_ALLOWED_IP_PREFIXES` and `ATTENDANCE_ALLOWED_CIDRS` are still honoured as extra approved networks. Admin manual attendance entry is unchanged for corrections.

### Excel timesheet export (admin only)

Admins export an `.xlsx` timesheet per employee from **Employees → Excel** or **Reports → Export Excel Timesheet**. The file matches the company layout: Day, Date, From, To, Training, Work, Place, Notes, one sheet per month, Friday/Saturday highlighted, a live `SUM` total, and a Work formula that handles overnight shifts. Times are shown in Cairo time.

The date range defaults to the day after the employee's previous export through today; the first export starts at the first recorded attendance day. The admin can change both dates (up to 366 days). A short leading piece of fewer than 7 days is folded into the next month's sheet. Every export is recorded in `timesheet_exports` and the audit log. Approved annual leave, approved two-hour delays, missing check-outs and admin manual entries are noted in the Notes column. The workbook is generated on the server without extra npm packages (`utils/xlsxWriter.js`). Run `npm run test:excel` to verify it.

## Deployment Notes

- The project is designed to run as a single Node.js service that serves both the API and the frontend.
- Set production environment variables on your host before deployment.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- No embedded Supabase defaults are shipped anymore. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` explicitly per environment.

## Frontend Structure

- `public/js/app.js`: app shell, routing, page rendering, and modal flows
- `public/js/dataStore.js`: complete paginated reads and race-safe query cache
- `public/js/apiClient.js`: shared frontend API request/fallback helper for app and check-in pages
- `public/js/reporting.js`: report calculations, attendance metrics, and chart rendering
- `public/js/exporters.js`: CSV export helpers for employees, attendance, and reports
- `public/js/checkin.js`: QR/check-in flow page logic
- `public/js/shared.js`: small reusable formatting and label helpers
