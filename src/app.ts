import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';

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

// TODO: add other route groups (files, folders, etc.)

// Global error handler (basic)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ error: message });
});

export default app;
