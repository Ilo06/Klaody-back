export function serializeFile(file: {
  id: number;
  name: string;
  mimeType: string;
  size: bigint;
  folderId: number | null;
  uploadedAt: Date;
  deletedAt: Date | null;
}) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: Number(file.size),
    folderId: file.folderId,
    uploadedAt: file.uploadedAt,
    deletedAt: file.deletedAt,
  };
}

export function serializeFolder(folder: {
  id: number;
  name: string;
  parentId: number | null;
  createdAt: Date;
  deletedAt: Date | null;
}) {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt,
    deletedAt: folder.deletedAt,
  };
}
