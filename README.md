# EVARA BNS

EVARA BNS is a Supabase-powered employee attendance system with role-based access for admins and employees.

## Features

- Supabase Auth with profile-based roles
- Admin employee management
- Live attendance check-in and check-out
- QR attendance access
- Manual attendance entry for admins
- CSV export for employees and attendance history
- Advanced reports with working hours, overtime, shortfall, and employee timesheets
- Client-side pagination for employee and history views
- Rate limiting, sanitization, and HTTP header hardening
- Modular frontend helpers for reporting and export workflows

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create or update `.env` with the required values:

```env
PORT=5000
HOST=0.0.0.0
NODE_ENV=development
API_BASE_URL=/api
FRONTEND_URL=http://localhost:5000
APP_URL=http://localhost:5000
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
INITIAL_ADMIN_FULL_NAME=System Admin
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
RATE_LIMIT_MAX_REQUESTS=200
ADMIN_RATE_LIMIT_MAX=80
ATTENDANCE_RATE_LIMIT_WINDOW_MS=300000
ATTENDANCE_RATE_LIMIT_MAX=30
QR_TARGET_URL=http://localhost:5000/checkin
TRUST_PROXY_HOPS=0
```

3. Run the app:

```bash
npm start
```

4. Run a quick code health check:

```bash
npm run check
```

5. Open:

- App: `http://localhost:5000`
- Health: `http://localhost:5000/api/health`

## Supabase Setup

1. Open the Supabase SQL editor.
2. Run [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql).
3. Run [supabase/migrations/002_fix_attendance_timestamp_functions.sql](supabase/migrations/002_fix_attendance_timestamp_functions.sql).
4. Enable Email/Password authentication in Supabase Auth.
5. Set redirect URLs for your local or deployed app.

## Deployment Notes

- The project is designed to run as a single Node.js service that serves both the API and the frontend.
- Set production environment variables on your host before deployment.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## Frontend Structure

- `public/js/app.js`: app shell, routing, page rendering, and modal flows
- `public/js/reporting.js`: report calculations, attendance metrics, and chart rendering
- `public/js/exporters.js`: CSV export helpers for employees, attendance, and reports
- `public/js/checkin.js`: QR/check-in flow page logic
- `public/js/shared.js`: small reusable formatting and label helpers
