# Kiran Academy

A responsive course and student portal backed by Node.js and MySQL.

## Requirements

- Node.js 20 or newer
- MySQL 8.0 or newer

## Run locally

1. Create a MySQL database and tables by running `schema.sql` with a MySQL account that can create databases.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a unique `JWT_SECRET` of at least 32 characters, and a private `ADMIN_PASSWORD`.
3. Install dependencies with `npm install`.
4. Start the app with `npm start`, then open `http://localhost:3000`.

On first startup, the app seeds four sample courses, their syllabus modules, reference links and an upcoming sample batch. It creates the administrator account from the environment variables if that email does not already exist. Changing `ADMIN_PASSWORD` later does not reset an existing account password.

The administrator can sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` to review enquiries, enable or disable student accounts, and add or publish courses. Students can register, request a course seat, see batch details and open course learning resources from their dashboard.

The sample student testimonials and academy contact details in `index.html` are presentation content and should be replaced with verified academy information before public deployment. The included course fees and batch schedule are sample data.

## API

- `GET /api/health`
- `GET /api/courses` and `GET /api/courses/:slug`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/enquiries`
- `POST /api/student/enrollments`, `GET /api/student/dashboard`
- `GET /api/admin/overview`, `GET /api/admin/students`, `PATCH /api/admin/students/:id`
- `GET /api/admin/courses`, `POST /api/admin/courses`, `PATCH /api/admin/courses/:id`
- `GET /api/admin/enquiries`, `PATCH /api/admin/enquiries/:id`

Protected endpoints use a bearer token returned by the login and registration endpoints.