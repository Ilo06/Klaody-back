// Queues every image that is not indexed yet (uploaded before this feature, or FAILED earlier).
//   dev:  npm run index:backfill
//   prod: node dist/scripts/backfill-index.js
// The server's worker picks the jobs up; run this while the server is running (or start it afterwards).
import dotenv from 'dotenv';
dotenv.config();

import PgBoss from 'pg-boss';
import prisma from '../prisma/client';
import { isIndexable } from '../services/indexing.service';

async function main() {
  const connectionString = process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const boss = new PgBoss({ connectionString, max: 2 });
  boss.on('error', (err) => console.error(err));
  await boss.start();
  await boss.createQueue('index-image', { name: 'index-image', retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 900 });

  const files = await prisma.file.findMany({
    where: { mimeType: { startsWith: 'image/', mode: 'insensitive' }, indexStatus: { in: ['NONE', 'FAILED'] } },
    select: { id: true, mimeType: true, size: true },
  });

  let queued = 0;
  for (const f of files) {
    if (!isIndexable(f.mimeType, f.size)) continue;
    await prisma.file.update({ where: { id: f.id }, data: { indexStatus: 'PENDING' } });
    await boss.send('index-image', { fileId: f.id });
    queued++;
  }
  console.log(`Queued ${queued} image(s) for indexing.`);

  await boss.stop({ graceful: true });
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
