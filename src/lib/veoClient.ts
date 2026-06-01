/** Veo 2.0 Video Generation API client */
import { getEnv } from '../lib/constants';

interface VideoGenResponse {
  ok?: boolean;
  error?: string;
  taskId?: string;
  status?: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
  durationSeconds?: number;
  fileName?: string;
  videoUrl?: string;
  videoDataBase64?: string;
}

const SANDBOX_URL = () => getEnv('VITE_SANDBOX_URL') || 'http://localhost:4200';

/**
 * Start video generation.
 * Returns the task ID for status polling.
 */
export async function generateVideo(prompt: string): Promise<VideoGenResponse> {
  const resp = await fetch(`${SANDBOX_URL()}/api/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return resp.json();
}

/**
 * Poll for video generation status.
 */
export async function getVideoStatus(taskId: string): Promise<VideoGenResponse> {
  const resp = await fetch(`${SANDBOX_URL()}/api/generate-video/status/${taskId}`);
  return resp.json();
}

/**
 * Full flow: start generation and poll until completion.
 * Calls onProgress callback with status updates.
 * Returns the final result.
 */
export async function generateVideoWithPolling(
  prompt: string,
  onProgress?: (status: string) => void
): Promise<VideoGenResponse> {
  onProgress?.('starting');
  const startResult = await generateVideo(prompt);
  
  if (startResult.error) return startResult;
  if (startResult.ok) return startResult; // Already completed (rare)
  
  const taskId = startResult.taskId;
  if (!taskId) return { error: 'No task ID returned from server' };
  
  // Poll every 10 seconds
  const maxPolls = 36; // 6 minutes max
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 10000));
    onProgress?.('processing');
    
    const status = await getVideoStatus(taskId);
    if (status.error) return status;
    if (status.status === 'done' || status.ok) return status;
    if (status.status === 'error') return { error: status.error || 'Video generation failed' };
  }
  
  return { error: 'Video generation timed out' };
}
