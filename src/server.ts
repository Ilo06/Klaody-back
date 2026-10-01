import app from './app';
import { startIndexing, stopIndexing } from './services/indexing.service';

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    await startIndexing();
  } catch (err) {
    console.error('[indexing] disabled, could not start the queue:', err);
  }

  const server = app.listen(PORT, () => {
    console.log(` Server listening on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    server.close();
    stopIndexing().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
