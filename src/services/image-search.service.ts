import prisma from '../prisma/client';
import { embedText, toVectorLiteral } from './clip.service';

export const DEFAULT_MIN_SIMILARITY = Number(process.env.SEARCH_MIN_SIMILARITY) || 0.2;

/** Returns the user's non-trashed images ranked by similarity to the text query (best first). */
export async function searchImages(userId: string, query: string, limit: number, minSimilarity: number) {
  const vector = toVectorLiteral(await embedText(query));
  const rows = await prisma.$queryRaw<{ id: string; similarity: number }[]>`
    SELECT e."fileId" AS id, 1 - (e."embedding" <=> ${vector}::vector) AS similarity
    FROM "ImageEmbedding" e
    JOIN "File" f ON f."id" = e."fileId"
    WHERE f."userId" = ${userId}::uuid AND f."deletedAt" IS NULL
    ORDER BY e."embedding" <=> ${vector}::vector
    LIMIT ${limit}`;

  const hits = rows.filter((r) => r.similarity >= minSimilarity);
  if (hits.length === 0) return [];

  const files = await prisma.file.findMany({ where: { id: { in: hits.map((h) => h.id) } } });
  const byId = new Map(files.map((f) => [f.id, f]));
  return hits
    .filter((h) => byId.has(h.id))
    .map((h) => ({ file: byId.get(h.id)!, similarity: Math.round(h.similarity * 1000) / 1000 }));
}
