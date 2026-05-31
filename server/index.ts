import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WhatsAppManager } from './whatsapp';
import * as waTools from './whatsapp-tools';
import { runPlaywrightAction } from './playwright-tool';
import { duffelManager } from './duffel';

const app = express();
const PORT = process.env.SANDBOX_PORT ? parseInt(process.env.SANDBOX_PORT) : 4200;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const waManager = new WhatsAppManager();
waManager.resumeExistingSessions();

app.get('/', (_req, res) => {
  res.send('Beatrice Backend API Server is running. To open the application, visit http://localhost:3000');
});

app.get('/api/health', async (_req, res) => {
  res.json({ status: 'ok', worker: 'client-side' });
});

app.post('/api/web/glance', async (req, res) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const maxResults = Math.max(1, Math.min(Number(req.body?.maxResults) || 3, 5));

    if (query.length < 2) {
      res.status(400).json({ error: 'query must be at least 2 characters' });
      return;
    }

    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query.slice(0, 160));
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Beatrice Voice Assistant/1.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      res.status(502).json({ error: `Web glance failed with status ${response.status}` });
      return;
    }

    const data: any = await response.json();
    const related: Array<{ title: string; url: string; snippet: string }> = [];
    const stripTags = (value: unknown) => String(value || '').replace(/<[^>]*>/g, '').trim();

    const collect = (item: any) => {
      if (Array.isArray(item?.Topics)) {
        item.Topics.forEach(collect);
        return;
      }

      const title = stripTags(item?.FirstURL ? item.Text?.split(' - ')[0] : item?.Text);
      const snippet = stripTags(item?.Text);
      const itemUrl = stripTags(item?.FirstURL);
      if (title && itemUrl) {
        related.push({ title, url: itemUrl, snippet });
      }
    };

    (Array.isArray(data.RelatedTopics) ? data.RelatedTopics : []).forEach(collect);

    res.json({
      query,
      heading: stripTags(data.Heading) || undefined,
      abstract: stripTags(data.AbstractText) || undefined,
      source: stripTags(data.AbstractSource || 'DuckDuckGo'),
      results: related.slice(0, maxResults),
    });
  } catch (err: any) {
    console.error('Web glance error:', err);
    res.status(500).json({ error: err.message || 'Web glance failed' });
  }
});

app.post('/api/playwright/action', async (req, res) => {
  try {
    const result = await runPlaywrightAction(req.body || {});
    res.json(result);
  } catch (err: any) {
    console.error('Playwright action error:', err);
    res.status(500).json({
      error: {
        code: 'PLAYWRIGHT_ACTION_FAILED',
        message: err?.message || 'Playwright action failed',
      },
    });
  }
});

// ── VIES VAT Proxy ──
app.post('/api/vies/validate', async (req, res) => {
  try {
    const { countryCode, vatNumber } = req.body;
    if (!countryCode || !vatNumber) {
      res.status(400).json({ error: 'countryCode and vatNumber required' });
      return;
    }

    const response = await fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryCode, vatNumber }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      res.status(502).json({ error: `VIES API failed with status ${response.status}` });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('VIES validation error:', err);
    res.status(500).json({ error: err.message || 'VIES validation failed' });
  }
});

// ── WhatsApp Routes ──

app.post('/api/whatsapp/pair', async (req, res) => {
  try {
    const { userId, phoneNumber } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    const result = await waManager.startPairing(userId, phoneNumber);
    if ('error' in result) { res.status(500).json(result); return; }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Pairing failed' });
  }
});

app.get('/api/whatsapp/status/:userId', async (req, res) => {
  try {
    const status = await waManager.getStatusOrStart(req.params.userId);
    if (!status) { res.json({ status: 'not_found' }); return; }
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to read WhatsApp status' });
  }
});

app.get('/api/whatsapp/messages/:userId', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const messages = waManager.getRecentMessages(req.params.userId, limit);
  res.json({ messages });
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    await waManager.disconnect(userId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { userId, to, text, permissions } = req.body;
    if (!userId || !to || !text) { res.status(400).json({ error: 'userId, to, text required' }); return; }
    const effectivePermissions = waManager.getEffectivePermissions(userId, permissions);
    const result = await waTools.handleSendMessage(waManager, userId, effectivePermissions, to, text);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/tool', async (req, res) => {
  try {
    const { userId, tool, permissions } = req.body;
    const params = req.body.params || {};
    if (!userId || !tool) { res.status(400).json({ error: 'userId and tool required' }); return; }
    const effectivePermissions = waManager.getEffectivePermissions(userId, permissions);

    let result: any;
    switch (tool) {
      case 'sendMessage':
        result = await waTools.handleSendMessage(waManager, userId, effectivePermissions, params.to, params.text);
        break;
      case 'readChats':
        result = await waTools.handleReadChats(waManager, userId, effectivePermissions, params.limit);
        break;
      case 'getContacts':
        result = await waTools.handleGetContacts(waManager, userId, effectivePermissions);
        break;
      case 'addContact':
        result = await waTools.handleAddContact(waManager, userId, effectivePermissions, params.name, params.number || params.to);
        break;
      case 'getGroups':
        result = await waTools.handleGetGroups(waManager, userId, effectivePermissions);
        break;
      case 'sendGroupMessage':
        result = await waTools.handleSendGroupMessage(waManager, userId, effectivePermissions, params.groupId || params.chatId || params.groupName, params.text);
        break;
      case 'readGroupChat':
        result = await waTools.handleReadGroupChat(waManager, userId, effectivePermissions, params.groupId || params.chatId || params.groupName, params.limit);
        break;
      case 'getMessageHistory':
        result = await waTools.handleGetMessageHistory(waManager, userId, effectivePermissions, params.chatId || params.contactId || params.to || params.name, params.limit);
        break;
      default:
        res.status(400).json({ error: `Unknown tool: ${tool}` });
        return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/admin/overview/:userId', async (req, res) => {
  try {
    res.json(await waManager.getAdminOverview(req.params.userId));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load WhatsApp admin overview' });
  }
});

app.get('/api/whatsapp/admin/config/:userId', (req, res) => {
  try {
    res.json({ config: waManager.getAdminConfigPublic(req.params.userId) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load WhatsApp admin config' });
  }
});

app.post('/api/whatsapp/admin/config', (req, res) => {
  try {
    const { userId, config } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    res.json({ config: waManager.saveAdminConfig(userId, config || {}) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save WhatsApp admin config' });
  }
});

app.post('/api/whatsapp/admin/test-message', async (req, res) => {
  try {
    const { userId, to, text } = req.body;
    if (!userId || !to || !text) { res.status(400).json({ error: 'userId, to, text required' }); return; }
    const permissions = waManager.getEffectivePermissions(userId);
    const result = await waTools.handleSendMessage(waManager, userId, permissions, to, text);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to send test message' });
  }
});

// ── Duffel Flight Booking Routes ──

app.post('/api/flights/search', async (req, res) => {
  try {
    const result = await duffelManager.searchFlights(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Flight search failed' });
  }
});

app.post('/api/flights/book', async (req, res) => {
  try {
    const result = await duffelManager.bookFlight(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Flight booking failed' });
  }
});

app.get('/api/whatsapp/webhook/:userId', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && waManager.verifyWebhookToken(req.params.userId, token)) {
    res.status(200).send(String(challenge || ''));
    return;
  }
  res.sendStatus(403);
});

app.post('/api/whatsapp/webhook/:userId', (req, res) => {
  try {
    res.json(waManager.ingestCloudWebhook(req.params.userId, req.body));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Webhook ingest failed' });
  }
});

// ── Shutdown hook ──

process.on('SIGTERM', async () => {
  console.log('Shutting down WhatsApp clients...');
  await waManager.shutdown();
  process.exit(0);
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Beatrice Backend Server running on http://0.0.0.0:${PORT}`);
});
