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
- Trash listing and restore for files and folders, in single or bulk mode, plus restore‑all and empty‑trash
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

All primary and foreign keys (`User`, `Folder`, `File`, `ShareLink`) are native Postgres UUIDs (`gen_random_uuid()`); the API validates every id and answers `400` for a malformed one. Tokens issued before the UUID migration are rejected with `401`, so users must log in again.

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
| `GET` | `/files` | List the caller's non‑trashed files. Filters (all optional, combined with AND): `folderId` (`root` or a UUID; omitted = all), `name` (substring, case‑insensitive), `mimeType` (`application/pdf` or `image/*`), `minSize` / `maxSize` (bytes), `uploadedAfter` / `uploadedBefore` (ISO 8601, inclusive). Sorting: `sortBy` = `name` \| `size` \| `uploadedAt` (default), `order` = `asc` \| `desc` (default). |
| `POST` | `/files` | Upload a file. `multipart/form-data` with a `file` field. Streamed to disk under `FILE_ROOT` with a generated name; the original filename is preserved only for display/download. Optional `folderId` field to upload into a folder (default: root). Returns `{ id, name, size, folderId }`. |
| `GET` | `/files/:id` | Stream a file back to the client with the correct `Content-Type`, `Content-Disposition` (original filename) and `Content-Length`. |
| `GET` | `/files/:id/preview` | Reduced-size WebP copy of an image (JPEG, PNG, WebP, AVIF) for in-app previews. Optional `width` (px), snapped up to 480 / 720 / 1080 / 1600 (default 1080); never upscaled. Generated with `sharp` on first request and cached under `FILE_ROOT/.previews`. `415` for other file types, `422` if the image cannot be decoded. The original stays available, at full resolution, through `GET /files/:id`. |
| `PATCH` | `/files/:id/rename` | Rename a file. Body: `{ "name": "…" }`. |
| `PATCH` | `/files/:id/move` | Move a file. Body: `{ "folderId": "<uuid>" }` (`null` = root). |
| `DELETE` | `/files/:id` | Soft‑delete (move to trash). Returns `204 No Content`. |

### Folders
All routes require the `Authorization: Bearer <token>` header. Folder names must be unique among live siblings (`409` otherwise).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/folders` | List non‑trashed folders. Filters: `parentId` (`root` or a UUID; omitted = all), `name` (substring, case‑insensitive), `createdAfter` / `createdBefore` (ISO 8601, inclusive). Sorting: `sortBy` = `name` (default) \| `createdAt`, `order` = `asc` (default) \| `desc`. |
| `POST` | `/folders` | Create a folder. Body: `{ "name": "…", "parentId": "<uuid>" }` (`parentId` optional). |
| `PATCH` | `/folders/:id/rename` | Rename a folder. Body: `{ "name": "…" }`. |
| `PATCH` | `/folders/:id/move` | Move a folder. Body: `{ "parentId": "<uuid>" }` (`null` = root). `400` if the destination is the folder itself or one of its descendants. |
| `DELETE` | `/folders/:id` | Move the folder, its sub‑folders and their files to the trash. Returns `204 No Content`. |

### Trash
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/trash` | List trashed items as `{ files, folders }`. Only top‑level trashed items are listed; contents of a trashed folder come back with it. Filters: `type` (`file` \| `folder`), `name` (substring), `deletedAfter` / `deletedBefore` (ISO 8601, inclusive). |
| `POST` | `/trash` | Bulk delete: move several items to the trash. Body: `{ "fileIds": ["<uuid>", "<uuid>"], "folderIds": ["<uuid>"] }` (max 1000 ids). Returns `200 { succeeded, failed }`; each item is handled independently and failures carry the status the single‑item route would have returned. |
| `POST` | `/trash/restore` | Bulk restore. Same body and response as `POST /trash`. Parents are restored before children, so a folder and its contents can be listed together. |
| `POST` | `/trash/restore-all` | Restore everything in the trash. Same response as `POST /trash`. |
| `DELETE` | `/trash` | **Empty the trash: permanently** deletes every trashed file and folder, including the stored files on disk. Cannot be undone. Returns `{ deletedFiles, deletedFolders }`. |
| `POST` | `/trash/files/:id/restore` | Restore a file. `409` if its parent folder is still trashed. |
| `POST` | `/trash/folders/:id/restore` | Restore a folder with everything trashed together with it. `409` if its parent is still trashed or a live sibling has the same name. |

Invalid filter values return `400 { "error": "…" }`. See `openapi.yaml` for the full request/response contract.

## Scripts
- `npm run dev` – start server with `ts-node-dev` (watch mode)
- `npm run build` – compile TypeScript to `dist/`
- `npm start` – run compiled server
- `npm run prisma:migrate` – create & apply a migration
- `npm run prisma:generate` – regenerate Prisma client after schema changes

## License
MIT © RANDRIANASOLO Iloniaina Tohifitahiana

## Image search (CLIP + pgvector)

`GET /files/search?q=car` returns the images that *show* a car, whatever their file name.

- On upload, every supported image (jpeg, png, webp, gif, avif, tiff, up to `INDEX_MAX_BYTES`) is queued in a Postgres-backed job queue (pg-boss, `pgboss` schema, no Redis). A worker embeds it with CLIP (ViT-B/32, run locally through transformers.js) and stores a 512-dim vector in pgvector.
- Search embeds the text query with the same model and ranks images by cosine similarity. Results include a `similarity` score; hits below `SEARCH_MIN_SIMILARITY` (default 0.2) are dropped.
- `indexStatus` on a file: `NONE` (not indexable) → `PENDING` → `DONE` / `FAILED`.
- Existing images: run `npm run index:backfill` once (prod: `node dist/scripts/backfill-index.js`).
- Requirements: PostgreSQL with the `vector` extension (the migration runs `CREATE EXTENSION IF NOT EXISTS vector`), and a direct DB connection for pg-boss (`PGBOSS_DATABASE_URL` if `DATABASE_URL` is pooled). The first start downloads ~150 MB of model weights (see `CLIP_CACHE_DIR`).
