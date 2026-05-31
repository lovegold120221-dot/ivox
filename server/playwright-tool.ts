import { chromium, type Browser, type Page } from 'playwright';

type PlaywrightStep = {
  action?: string;
  url?: string;
  selector?: string;
  value?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
  waitUntil?: string;
  state?: string;
  fullPage?: boolean;
  delayMs?: number;
};

const MAX_STEPS = 12;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TEXT_CHARS = 8_000;

const waitUntilValues = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
const selectorStates = new Set(['attached', 'detached', 'visible', 'hidden']);

const clampTimeout = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(numeric, 250), MAX_TIMEOUT_MS);
};

const clampText = (value: unknown, max = MAX_TEXT_CHARS) => {
  const text = String(value || '').replace(/\s+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
};

const normalizeAction = (action: unknown) => {
  const normalized = String(action || 'snapshot')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/[\s-]+/g, '_')
    .replace(/^_+/, '')
    .toLowerCase();

  if (normalized === 'wait_for_timeout') return 'wait';
  if (normalized === 'select') return 'select_option';
  if (normalized === 'text') return 'extract_text';
  return normalized;
};

const requireString = (value: unknown, name: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${name} is required`);
  return text;
};

const sanitizeUrl = (rawUrl: unknown) => {
  const text = requireString(rawUrl, 'url');
  const url = new URL(text);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.');
  }
  return url.toString();
};

const buildSteps = (input: Record<string, any>): PlaywrightStep[] => {
  const providedSteps = Array.isArray(input.steps)
    ? input.steps.filter(Boolean).slice(0, MAX_STEPS)
    : [];

  const steps: PlaywrightStep[] = providedSteps.length > 0
    ? providedSteps.map((step) => ({ ...(step as PlaywrightStep) }))
    : [{ ...input, action: input.action || (input.url ? 'navigate' : 'snapshot') }];

  if (input.url && normalizeAction(steps[0]?.action) !== 'navigate') {
    steps.unshift({ action: 'navigate', url: input.url });
  }

  if (input.screenshot === true && !steps.some((step) => normalizeAction(step.action) === 'screenshot')) {
    steps.push({ action: 'screenshot', fullPage: Boolean(input.fullPage) });
  }

  return steps.slice(0, MAX_STEPS);
};

const getPageText = async (page: Page) => {
  const text = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
  return clampText(text);
};

const getPageLinks = async (page: Page) => {
  return page.locator('a[href]').evaluateAll((elements) =>
    elements.slice(0, 20).map((element) => {
      const anchor = element as HTMLAnchorElement;
      return {
        text: (anchor.innerText || anchor.textContent || '').trim().slice(0, 120),
        href: anchor.href,
      };
    }).filter((link) => link.href)
  ).catch(() => []);
};

const takeScreenshot = async (page: Page, fullPage = false) => {
  const buffer = await page.screenshot({
    type: 'jpeg',
    quality: 78,
    fullPage,
  });

  return {
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
  };
};

const executeStep = async (page: Page, rawStep: PlaywrightStep, inheritedTimeoutMs: number) => {
  const action = normalizeAction(rawStep.action);
  const timeoutMs = clampTimeout(rawStep.timeoutMs || inheritedTimeoutMs);

  switch (action) {
    case 'navigate': {
      const waitUntil = waitUntilValues.has(String(rawStep.waitUntil || 'domcontentloaded'))
        ? rawStep.waitUntil as 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
        : 'domcontentloaded';
      await page.goto(sanitizeUrl(rawStep.url), { waitUntil, timeout: timeoutMs });
      return { action, ok: true, url: page.url() };
    }
    case 'click': {
      await page.locator(requireString(rawStep.selector, 'selector')).first().click({ timeout: timeoutMs });
      return { action, ok: true };
    }
    case 'fill': {
      await page.locator(requireString(rawStep.selector, 'selector')).first().fill(String(rawStep.value ?? rawStep.text ?? ''), { timeout: timeoutMs });
      return { action, ok: true };
    }
    case 'type': {
      await page.locator(requireString(rawStep.selector, 'selector')).first().pressSequentially(String(rawStep.value ?? rawStep.text ?? ''), {
        timeout: timeoutMs,
        delay: Math.max(0, Math.min(Number(rawStep.delayMs) || 0, 250)),
      });
      return { action, ok: true };
    }
    case 'press': {
      const key = requireString(rawStep.key || rawStep.value || rawStep.text, 'key');
      if (rawStep.selector) {
        await page.locator(rawStep.selector).first().press(key, { timeout: timeoutMs });
      } else {
        await page.keyboard.press(key);
      }
      return { action, ok: true };
    }
    case 'select_option': {
      await page.locator(requireString(rawStep.selector, 'selector')).first().selectOption(String(rawStep.value ?? rawStep.text ?? ''), { timeout: timeoutMs });
      return { action, ok: true };
    }
    case 'wait_for_selector': {
      const state = selectorStates.has(String(rawStep.state || 'visible'))
        ? rawStep.state as 'attached' | 'detached' | 'visible' | 'hidden'
        : 'visible';
      await page.locator(requireString(rawStep.selector, 'selector')).first().waitFor({ state, timeout: timeoutMs });
      return { action, ok: true, state };
    }
    case 'wait': {
      await page.waitForTimeout(clampTimeout(rawStep.timeoutMs || rawStep.value || 1_000));
      return { action, ok: true };
    }
    case 'extract_text': {
      const text = rawStep.selector
        ? await page.locator(rawStep.selector).first().innerText({ timeout: timeoutMs })
        : await getPageText(page);
      return { action, ok: true, text: clampText(text) };
    }
    case 'screenshot': {
      return { action, ok: true, screenshot: await takeScreenshot(page, Boolean(rawStep.fullPage)) };
    }
    case 'snapshot': {
      return {
        action,
        ok: true,
        title: await page.title().catch(() => ''),
        url: page.url(),
        text: await getPageText(page),
      };
    }
    default:
      throw new Error(`Unsupported Playwright action: ${action}`);
  }
};

export async function runPlaywrightAction(input: Record<string, any>) {
  const startedAt = Date.now();
  const timeoutMs = clampTimeout(input.timeoutMs);
  const steps = buildSteps(input || {});
  let browser: Browser | null = null;

  if (steps.length === 0) {
    throw new Error('At least one Playwright action is required.');
  }

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      viewport: {
        width: Math.min(Math.max(Number(input.viewport?.width) || 1365, 320), 2560),
        height: Math.min(Math.max(Number(input.viewport?.height) || 900, 320), 2000),
      },
      userAgent: typeof input.userAgent === 'string' && input.userAgent.trim() ? input.userAgent.trim() : undefined,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    const stepResults = [];
    let screenshot: { mimeType: string; dataUrl: string } | undefined;

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      try {
        const result = await executeStep(page, step, timeoutMs);
        if ('screenshot' in result && result.screenshot) {
          screenshot = result.screenshot;
        }
        stepResults.push({ index, ...result });
      } catch (error: any) {
        stepResults.push({
          index,
          action: normalizeAction(step.action),
          ok: false,
          error: error?.message || String(error),
        });
        throw new Error(`Step ${index + 1} failed: ${error?.message || String(error)}`);
      }
    }

    const finalTitle = await page.title().catch(() => '');
    const finalUrl = page.url();
    const finalText = await getPageText(page);
    const finalLinks = await getPageLinks(page);
    const resultScreenshot = screenshot || (input.screenshot === true ? await takeScreenshot(page, Boolean(input.fullPage)) : undefined);

    await context.close();

    return {
      ok: true,
      title: finalTitle,
      url: finalUrl,
      text: finalText,
      links: finalLinks,
      screenshot: resultScreenshot,
      steps: stepResults,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
