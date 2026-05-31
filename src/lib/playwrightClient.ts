import { getBackendUrl } from './whatsappClient';

export type PlaywrightActionStep = {
  action: string;
  url?: string;
  selector?: string;
  value?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  fullPage?: boolean;
};

export type PlaywrightActionRequest = {
  url?: string;
  action?: string;
  selector?: string;
  value?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
  screenshot?: boolean;
  fullPage?: boolean;
  steps?: PlaywrightActionStep[];
  viewport?: {
    width?: number;
    height?: number;
  };
};

export async function runPlaywrightAction(input: PlaywrightActionRequest): Promise<any> {
  const res = await fetch(`${getBackendUrl()}/api/playwright/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.error || `Server returned ${res.status}`;
    throw new Error(message);
  }

  return data;
}
