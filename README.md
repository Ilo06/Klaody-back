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
  - [Folders](#folders)
  - [Trash](#trash)
- [Scripts](#scripts)
- [License](#license)

## Features
- JWT‑based authentication, bootstrapped as a single admin account
- Admin-gated account creation (the first registered user becomes admin; only an admin can register further accounts afterwards)
- Streaming upload/download (no whole‑file buffering), 5 GB max file size by default
- File listing, rename, move, and soft‑delete (trash)
- Nested folders (create, browse, rename, move) with recursive soft‑delete
- Trash listing and restore for files and folders
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
- `Folder` — name, optional parent folder (`null` = root), owning user, `createdAt`, and a `deletedAt` marker used for soft delete
- `File` — name, MIME type, size, on‑disk `storedName` (UUID, never exposed to clients), optional folder (`null` = root), owning user, upload timestamp, and a `deletedAt` marker used for soft delete

The `ShareLink` model will be added later.

After pulling the folder changes, run `npx prisma migrate dev --name folders` to create and apply the migration.

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
| `GET` | `/files` | List the caller's non‑trashed files. Optional `?folderId=`: `root` for top‑level files, or a folder id. Omitted = all files. |
| `POST` | `/files` | Upload a file. `multipart/form-data` with a `file` field. Streamed to disk under `FILE_ROOT` with a generated name; the original filename is preserved only for display/download. Optional `folderId` field to upload into a folder (default: root). Returns `{ id, name, size, folderId }`. |
| `GET` | `/files/:id` | Stream a file back to the client with the correct `Content-Type`, `Content-Disposition` (original filename) and `Content-Length`. |
| `PATCH` | `/files/:id/rename` | Rename a file. Body: `{ "name": "…" }`. |
| `PATCH` | `/files/:id/move` | Move a file. Body: `{ "folderId": 12 }` (`null` = root). |
| `DELETE` | `/files/:id` | Soft‑delete (move to trash). Returns `204 No Content`. |

### Folders
All routes require the `Authorization: Bearer <token>` header. Folder names must be unique among live siblings (`409` otherwise).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/folders` | List non‑trashed folders. Optional `?parentId=`: `root` for top‑level folders, or a folder id for its direct sub‑folders. Omitted = all folders. |
| `POST` | `/folders` | Create a folder. Body: `{ "name": "…", "parentId": 3 }` (`parentId` optional). |
| `PATCH` | `/folders/:id/rename` | Rename a folder. Body: `{ "name": "…" }`. |
| `PATCH` | `/folders/:id/move` | Move a folder. Body: `{ "parentId": 3 }` (`null` = root). `400` if the destination is the folder itself or one of its descendants. |
| `DELETE` | `/folders/:id` | Move the folder, its sub‑folders and their files to the trash. Returns `204 No Content`. |

### Trash
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/trash` | List trashed items as `{ files, folders }`. Only top‑level trashed items are listed; contents of a trashed folder come back with it. |
| `POST` | `/trash/files/:id/restore` | Restore a file. `409` if its parent folder is still trashed. |
| `POST` | `/trash/folders/:id/restore` | Restore a folder with everything trashed together with it. `409` if its parent is still trashed or a live sibling has the same name. |

See `openapi.yaml` for the full request/response contract.

## Scripts
- `npm run dev` – start server with `ts-node-dev` (watch mode)
- `npm run build` – compile TypeScript to `dist/`
- `npm start` – run compiled server
- `npm run prisma:migrate` – create & apply a migration
- `npm run prisma:generate` – regenerate Prisma client after schema changes

## License
MIT © RANDRIANASOLO Iloniaina Tohifitahiana