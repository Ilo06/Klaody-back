# Klaody Backend

A personal cloud storage service (Google‑Drive‑like) built with **Node.js**, **Express**, **TypeScript**, **Prisma** and **PostgreSQL**. Files are streamed directly to a local disk directory (`FILE_ROOT`).

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Database & Prisma](#database--prisma)
- [Running the Server](#running-the-server)
- [API](#api)
  - [Health Check](#health-check)
  - [Authentication](#authentication)
  - [Files](#files)
- [Scripts](#scripts)
- [License](#license)

## Features
- JWT‑based authentication, bootstrapped as a single admin account
- Admin-gated account creation (the first registered user becomes admin; only an admin can register further accounts afterwards)
- Streaming upload/download (no whole‑file buffering), 5 GB max file size by default
- File listing, rename, and soft‑delete (trash)
- OpenAPI contract in `openapi.yaml`

## Prerequisites
- **Node.js** ≥ 20 (LTS) and **npm**
- **PostgreSQL** server (local or remote)
- **Git** (for version control)

## Setup
```bash
# Clone the repo (if you haven't already)
git clone <repo‑url>
cd Cloud/Backend

# Install dependencies
npm install

# Initialise Prisma client (generates `node_modules/.prisma/client`)
npm run prisma:generate
```

## Environment Variables
Create a `.env` file based on `.env.example`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/Klaody
JWT_SECRET=your‑strong‑secret
FILE_ROOT=/srv/storage   # must exist and be writable by the node process; created automatically if missing
PORT=3000               # optional, defaults to 3000
```

## Database & Prisma
```bash
# Create the initial migration and apply it
npm run prisma:migrate   # will prompt for a migration name; e.g. "init"

# If you need to reset the DB (development only)
# npx prisma migrate reset
```
The `prisma/schema.prisma` currently defines `User` and `File` models:
- `User` — email, password hash, `isAdmin` flag
- `File` — name, MIME type, size, on‑disk `storedName` (UUID, never exposed to clients), owning user, upload timestamp, and a `deletedAt` marker used for soft delete

Additional models (Folder, ShareLink) will be added as the project grows.

## Running the Server
```bash
# Development mode (auto‑restart on changes)
npm run dev

# Production build
npm run build   # compiles to ./dist
npm start       # runs node ./dist/server.js
```
The server will listen on `http://localhost:$PORT` (default 3000).

## API

### Health Check
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Public liveness check. Returns plain text `OK`. |

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/register` | Create a user. Body: `{ "email": "…", "password": "…" }`. The **first** account ever created requires no authentication and is automatically made admin. **Every subsequent** call requires a valid admin `Authorization: Bearer <token>` header, and may optionally set `isAdmin` on the new account. Returns `{ token, expiresIn }`. |
| `POST` | `/auth/login` | Log in with email/password. Same response format as register. |

### Files
All routes below require the `Authorization: Bearer <token>` header and only ever operate on files owned by the requesting user.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/files` | List the caller's non‑trashed files. |
| `POST` | `/files` | Upload a file. `multipart/form-data` with a `file` field. Streamed to disk under `FILE_ROOT` with a generated name; the original filename is preserved only for display/download. Returns `{ id, name, size }`. |
| `GET` | `/files/:id` | Stream a file back to the client with the correct `Content-Type`, `Content-Disposition` (original filename) and `Content-Length`. |
| `PATCH` | `/files/:id/rename` | Rename a file. Body: `{ "name": "…" }`. |
| `DELETE` | `/files/:id` | Soft‑delete (move to trash). Returns `204 No Content`. |

See `openapi.yaml` for the full request/response contract.

## Scripts
- `npm run dev` – start server with `ts-node-dev` (watch mode)
- `npm run build` – compile TypeScript to `dist/`
- `npm start` – run compiled server
- `npm run prisma:migrate` – create & apply a migration
- `npm run prisma:generate` – regenerate Prisma client after schema changes

## License
MIT © RANDRIANASOLO Iloniaina Tohifitahiana