import { db, KnowledgeFile } from './db';
import { saveFileToOpfs, deleteFileFromOpfs, readFileFromOpfs, getOpfsFileUrl } from './opfs';

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const fileName = `avatar.${ext}`;
  const opfsPath = await saveFileToOpfs(`avatars/${userId}`, fileName, file);
  const publicUrl = await getOpfsFileUrl(opfsPath) || '';

  const settings = await db.settings.get(userId);
  if (settings) {
    await db.settings.put({ ...settings, avatarUrl: publicUrl });
  } else {
    await db.settings.put({ userId, avatarUrl: publicUrl });
  }

  return publicUrl;
}

export async function uploadKnowledgeFile(
  userId: string,
  file: File,
): Promise<{ id: string; name: string; type: string; size: number }> {
  const allowedTypes = [
    'text/plain', 'text/csv', 'application/json',
    'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/markdown',
  ];
  if (!allowedTypes.includes(file.type) && !file.name.match(/\.(txt|csv|json|pdf|docx?|md)$/i)) {
    throw new Error(`File type not supported: ${file.type}. Allowed: txt, csv, pdf, doc/docx, json, md`);
  }

  const id = crypto.randomUUID();
  const fileName = `${Date.now()}_${file.name}`;
  const opfsPath = await saveFileToOpfs(`knowledge/${userId}`, fileName, file);

  const knowledgeFile: KnowledgeFile = {
    id,
    userId,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date().toISOString(),
    opfsPath,
  };

  await db.knowledgeFiles.put(knowledgeFile);

  return {
    id: knowledgeFile.id,
    name: knowledgeFile.name,
    type: knowledgeFile.type,
    size: knowledgeFile.size,
  };
}

export async function listKnowledgeFiles(userId: string): Promise<Array<{
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  url: string;
}>> {
  const files = await db.knowledgeFiles.where('userId').equals(userId).reverse().sortBy('uploadedAt');
  
  return Promise.all(files.map(async (f) => {
    const url = await getOpfsFileUrl(f.opfsPath) || '';
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      size: f.size,
      uploadedAt: f.uploadedAt,
      url,
    };
  }));
}

export async function deleteKnowledgeFile(userId: string, fileId: string): Promise<void> {
  const file = await db.knowledgeFiles.get(fileId);
  if (!file || file.userId !== userId) throw new Error('File not found');

  await deleteFileFromOpfs(file.opfsPath);
  await db.knowledgeFiles.delete(fileId);
}

export async function fetchKnowledgeFileContent(userId: string, fileId: string): Promise<string | null> {
  const fileRecord = await db.knowledgeFiles.get(fileId);
  if (!fileRecord || fileRecord.userId !== userId) return null;

  const file = await readFileFromOpfs(fileRecord.opfsPath);
  if (!file) return null;

  try {
    const text = await file.text();
    return `File: ${fileRecord.name}\nContent:\n${text}`;
  } catch {
    return null;
  }
}

export async function updateKnowledgeDomains(userId: string, domains: string[]): Promise<void> {
  const settings = await db.settings.get(userId);
  if (settings) {
    await db.settings.put({ ...settings, knowledgeDomains: domains });
  } else {
    await db.settings.put({ userId, knowledgeDomains: domains });
  }
}
