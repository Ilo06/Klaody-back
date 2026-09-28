export function serializeFile(file: {
  id: string;
  name: string;
  mimeType: string;
  size: bigint;
  folderId: string | null;
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
  id: string;
  name: string;
  parentId: string | null;
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
