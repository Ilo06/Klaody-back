import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';

const TOKEN_BYTES = 24; // -> 32 base64url characters
const MAX_GENERATION_ATTEMPTS = 5;

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export type CreateShareResult =
  | { ok: true; token: string; expiresAt: Date | null }
  | { ok: false; status: number; error: string };


export async function createShareLink(
  userId: number,
  fileId: number,
  expiresIn?: number
): Promise<CreateShareResult> {
  const file = await prisma.file.findFirst({
    where: { id: fileId, userId, deletedAt: null },
  });
  if (!file) {
    return { ok: false, status: 404, error: 'File not found' };
  }

  const expiresAt = expiresIn != null ? new Date(Date.now() + expiresIn * 1000) : null;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const token = generateToken();
    try {
      const link = await prisma.shareLink.create({
        data: { token, fileId, expiresAt },
      });
      return { ok: true, token: link.token, expiresAt: link.expiresAt };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to generate a unique share token');
}

export type ResolvedShare =
  | {
      ok: true;
      name: string;
      mimeType: string;
      size: bigint;
      storedName: string;
    }
  | { ok: false };


export async function resolveShareToken(token: string): Promise<ResolvedShare> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { file: true },
  });
  if (!link) return { ok: false };

  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    await prisma.shareLink.delete({ where: { id: link.id } }).catch(() => undefined);
    return { ok: false };
  }

  if (!link.file || link.file.deletedAt) {
    return { ok: false };
  }

  const { file } = link;
  return {
    ok: true,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    storedName: file.storedName,
  };
}
