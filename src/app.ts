import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import authRoutes from './routes/auth.routes';
import fileRoutes from './routes/file.routes';
import folderRoutes from './routes/folder.routes';
import trashRoutes from './routes/trash.routes';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Health check (public)
app.get('/healthz', (_req, res) => {
  res.type('text').send('OK');
});

// Auth routes (register & login)
app.use('/auth', authRoutes);

// File routes (list, upload, download, rename, move, soft delete)
app.use('/files', fileRoutes);

// Folder routes (create, list, rename, move, soft delete)
app.use('/folders', folderRoutes);

// Trash routes (list, restore)
app.use('/trash', trashRoutes);

// TODO: add other route groups (share)

// Global error handler (basic)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);

  if (err instanceof multer.MulterError) {
    // e.g. file too large, unexpected field name
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ error: message });
});

export default app;