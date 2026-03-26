# EVARA BNS

EVARA BNS is a Supabase-powered employee attendance system with role-based access for admins and employees.

## Features

- Supabase Auth with profile-based roles
- Admin employee management
- Live attendance check-in and check-out
- QR attendance access
- Manual attendance entry for admins
- Attendance fencing by company network and/or geolocation
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
- Bilingual frontend foundation with English/Arabic toggle and RTL support

## Local Development

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

APP_URL=http://localhost:5000
API_BASE_URL=/api

SUPABASE_URL=<your-supabase-url>
SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>

INITIAL_ADMIN_FULL_NAME=System Admin
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=<secure-password>

RATE_LIMIT_MAX_REQUESTS=200
TRUST_PROXY_HOPS=1

ATTENDANCE_ACCESS_MODE=ip
ATTENDANCE_ALLOWED_IPS=<comma-separated-ips-or-cidrs-or-prefixes>
# Optional explicit lists (also comma-separated)
ATTENDANCE_ALLOWED_IP_PREFIXES=<optional-prefixes-like-192.168.1.*>
ATTENDANCE_ALLOWED_CIDRS=<optional-cidrs-like-10.0.0.0/24>
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
4. Run [supabase/migrations/003_update_business_schedule.sql](supabase/migrations/003_update_business_schedule.sql).
5. Run [supabase/migrations/004_adjust_checkin_window_to_8_9.sql](supabase/migrations/004_adjust_checkin_window_to_8_9.sql).
6. Run [supabase/migrations/005_create_employee_requests.sql](supabase/migrations/005_create_employee_requests.sql).
7. Enable Email/Password authentication in Supabase Auth.
8. Set redirect URLs for your local or deployed app.

### Attendance Fencing Modes

- `off`: no attendance restriction
- `ip`: only approved IPs, prefixes, or CIDR ranges can submit attendance
- `geo`: browser location must be inside the configured office radius
- `either`: approved network or approved location
- `both`: approved network and approved location together

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
