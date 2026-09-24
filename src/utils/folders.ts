import prisma from '../prisma/client';

/** A live (non-trashed) folder owned by `userId`, or null. */
export function getOwnedFolder(userId: number, id: number) {
  return prisma.folder.findFirst({ where: { id, userId, deletedAt: null } });
}

/** True if a live folder called `name` already exists directly under `parentId` (null = root). */
export async function siblingNameTaken(
  userId: number,
  parentId: number | null,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const existing = await prisma.folder.findFirst({
    where: {
      userId,
      parentId,
      name,
      deletedAt: null,
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return existing !== null;
}

/** True if `targetId` is `folderId` itself or one of its descendants (walks up from target). */
export async function isSelfOrDescendant(
  userId: number,
  folderId: number,
  targetId: number
): Promise<boolean> {
  let currentId: number | null = targetId;
  for (let depth = 0; currentId !== null && depth < 10_000; depth++) {
    if (currentId === folderId) return true;
    const row: { parentId: number | null } | null = await prisma.folder.findFirst({
      where: { id: currentId, userId },
      select: { parentId: true },
    });
    currentId = row ? row.parentId : null;
  }
  return false;
}

export async function collectSubtreeIds(
  userId: number,
  rootId: number,
  deletedAt: Date | null
): Promise<number[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.folder.findMany({
      where: { userId, parentId: { in: frontier }, deletedAt },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}
