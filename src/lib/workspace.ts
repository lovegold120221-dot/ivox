import { db, type WorkspaceOutput } from './db';

export type { WorkspaceOutput };

export async function listOutputs(userId: string): Promise<WorkspaceOutput[]> {
  return db.workspaceOutputs
    .where('userId')
    .equals(userId)
    .reverse()
    .sortBy('createdAt');
}

export async function saveOutput(output: WorkspaceOutput): Promise<void> {
  await db.workspaceOutputs.put(output);
}

export async function deleteOutput(id: string): Promise<void> {
  await db.workspaceOutputs.delete(id);
}

export async function getOutput(id: string): Promise<WorkspaceOutput | undefined> {
  return db.workspaceOutputs.get(id);
}

export async function clearUserOutputs(userId: string): Promise<void> {
  await db.workspaceOutputs.where('userId').equals(userId).delete();
}

// ── Google Drive sync ──

async function findOrCreateWorkspaceFolder(
  gFetch: (url: string, options?: RequestInit, isRetry?: boolean) => Promise<{ ok: boolean; status: number; data: any }>
): Promise<string | null> {
  // Search for existing folder
  const searchRes = await gFetch(
    "https://www.googleapis.com/drive/v3/files?q=name='Beatrice_Workspace' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)"
  );
  if (searchRes.ok && searchRes.data?.files?.length > 0) {
    return searchRes.data.files[0].id;
  }

  // Create folder
  const createRes = await gFetch(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Beatrice_Workspace',
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Auto-saved outputs from Beatrice AI assistant',
      }),
    }
  );
  if (createRes.ok && createRes.data?.id) {
    return createRes.data.id;
  }
  return null;
}

export async function uploadToDrive(
  gFetch: (url: string, options?: RequestInit, isRetry?: boolean) => Promise<{ ok: boolean; status: number; data: any }>,
  output: WorkspaceOutput
): Promise<{ fileId: string; link: string } | null> {
  try {
    const folderId = await findOrCreateWorkspaceFolder(gFetch);
    if (!folderId) return null;

    let body: BodyInit;
    let mimeType: string;

    if (output.type === 'document' && output.textContent) {
      body = output.textContent;
      mimeType = output.mimeType || 'text/html';
    } else if (output.blobData) {
      body = output.blobData;
      mimeType = output.mimeType || 'application/octet-stream';
    } else {
      return null;
    }

    const ext = mimeType === 'text/html' ? 'html' : mimeType.split('/')[1] || 'bin';
    const boundary = 'beatrice_boundary_42';
    const metadata = JSON.stringify({
      name: `${output.title.replace(/[^a-zA-Z0-9 _-]/g, '')}.${ext}`,
      parents: [folderId],
      description: `Created by Beatrice on ${output.createdAt}`,
    });

    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      body instanceof ArrayBuffer ? new Uint8Array(body).reduce((acc, b) => acc + String.fromCharCode(b), '') : body,
      `--${boundary}--`,
    ].join('\r\n');

    const uploadRes = await gFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipartBody,
      }
    );

    if (uploadRes.ok && uploadRes.data?.id) {
      return {
        fileId: uploadRes.data.id,
        link: uploadRes.data.webViewLink || `https://drive.google.com/file/d/${uploadRes.data.id}/view`,
      };
    }
    return null;
  } catch (err) {
    console.error('Drive upload failed:', err);
    return null;
  }
}
