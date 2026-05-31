import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import P from 'pino';
import QRCode from 'qrcode';

type WaStatus = 'init' | 'qr_ready' | 'paired' | 'disconnected' | 'error';
type WaProvider = 'linked_device' | 'cloud_api';

const WA_PERMISSION_KEYS = [
  'send_messages',
  'read_chats',
  'access_contacts',
  'manage_contacts',
  'access_groups',
  'send_group_messages',
  'read_group_chats',
  'view_message_history',
] as const;

type WaPermission = typeof WA_PERMISSION_KEYS[number];

export interface WaRecentMessage {
  id: string;
  chatId: string;
  from: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  isGroup: boolean;
  isMedia: boolean;
}

export interface WaChatSummary {
  id: string;
  name: string;
  unreadCount: number;
  lastMessage: string;
  timestamp: number;
  isGroup: boolean;
}

export interface WaContactSummary {
  id: string;
  name: string;
  notify?: string;
  verifiedName?: string;
  number: string;
}

interface WaAdminConfig {
  provider: WaProvider;
  displayName: string;
  businessAccountId: string;
  phoneNumberId: string;
  apiVersion: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
  defaultCountryCode: string;
  permissions: Record<WaPermission, boolean>;
  updatedAt: string;
}

export interface WaAdminConfigInput {
  provider?: WaProvider;
  displayName?: string;
  businessAccountId?: string;
  phoneNumberId?: string;
  apiVersion?: string;
  accessToken?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
  defaultCountryCode?: string;
  permissions?: Partial<Record<WaPermission, boolean>>;
}

export interface WaAdminConfigPublic {
  provider: WaProvider;
  displayName: string;
  businessAccountId: string;
  phoneNumberId: string;
  apiVersion: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasWebhookVerifyToken: boolean;
  defaultCountryCode: string;
  permissions: Record<WaPermission, boolean>;
  updatedAt: string | null;
}

interface WaSession {
  userId: string;
  status: WaStatus;
  qrCode: string | null;
  qrRaw: string | null;
  pairingCode?: string | null;
  phone: string | null;
  sock: any | null;
  authDir: string;
  dataFile: string;
  error: string | null;
  recentMessages: WaRecentMessage[];
  contacts: Record<string, WaContactSummary>;
  messageById: Map<string, any>;
  reconnecting: boolean;
  saveTimer: NodeJS.Timeout | null;
  reconnectTimer?: NodeJS.Timeout | null;
}

const logger = P({ level: process.env.WA_LOG_LEVEL || 'silent' });

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function defaultPermissions(): Record<WaPermission, boolean> {
  return WA_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as Record<WaPermission, boolean>);
}

function normalizePermissions(input?: Partial<Record<WaPermission, boolean>>): Record<WaPermission, boolean> {
  const base = defaultPermissions();
  for (const key of WA_PERMISSION_KEYS) {
    if (typeof input?.[key] === 'boolean') base[key] = input[key] === true;
  }
  return base;
}

function cleanPhoneNumber(input: string, defaultCountryCode = ''): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+') || !defaultCountryCode) return digits;
  if (digits.startsWith(defaultCountryCode)) return digits;
  return `${defaultCountryCode}${digits.replace(/^0+/, '')}`;
}

function messageText(message: any): string {
  const m = message?.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  );
}

function timestampMs(value: any): number {
  if (!value) return Date.now();
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value?.toNumber === 'function') return value.toNumber() * 1000;
  return Date.now();
}

export function toWhatsAppJid(value: string, group = false): string {
  const input = String(value || '').trim();
  if (!input) return '';
  if (input.includes('@s.whatsapp.net') || input.includes('@g.us') || input.includes('@broadcast')) {
    return input;
  }
  const cleaned = input.replace(/\D/g, '');
  if (!cleaned) return input;
  return `${cleaned}@${group ? 'g.us' : 's.whatsapp.net'}`;
}

function jidNumber(jid: string): string {
  return jid.split('@')[0] || jid;
}

function readSessionData(dataFile: string): Pick<WaSession, 'recentMessages' | 'contacts'> {
  try {
    if (!fs.existsSync(dataFile)) return { recentMessages: [], contacts: {} };
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      recentMessages: Array.isArray(parsed.recentMessages) ? parsed.recentMessages : [],
      contacts: parsed.contacts && typeof parsed.contacts === 'object' ? parsed.contacts : {},
    };
  } catch {
    return { recentMessages: [], contacts: {} };
  }
}

function writeSessionData(entry: WaSession) {
  const payload = {
    recentMessages: entry.recentMessages.slice(0, 250),
    contacts: entry.contacts,
  };
  fs.writeFileSync(entry.dataFile, JSON.stringify(payload, null, 2));
}

export class WhatsAppManager {
  private sessions = new Map<string, WaSession>();
  private authRoot = process.env.WA_AUTH_ROOT || path.join(process.cwd(), '.baileys_auth');

  async resumeExistingSessions(): Promise<void> {
    if (!fs.existsSync(this.authRoot)) return;
    try {
      const dirs = fs.readdirSync(this.authRoot);
      for (const dir of dirs) {
        const fullPath = path.join(this.authRoot, dir);
        if (fs.statSync(fullPath).isDirectory()) {
          const credsFile = path.join(fullPath, 'creds.json');
          if (fs.existsSync(credsFile)) {
            console.log(`Resuming WhatsApp session: ${dir}`);
            this.startSession(dir).catch((err: any) => {
              console.error(`Failed to auto-resume session ${dir}:`, err.message);
            });
          }
        }
      }
    } catch (error) {
      console.error('Error resuming existing WhatsApp sessions:', error);
    }
  }

  async startPairing(userId: string, phoneNumber?: string): Promise<{ pairingCode: string; status: string }> {
    const existing = this.sessions.get(userId);
    if (existing && ['init', 'qr_ready', 'paired'].includes(existing.status)) {
      if (phoneNumber) {
        await this.disconnect(userId);
      } else {
        return { pairingCode: safeUserId(userId), status: existing.status };
      }
    }

    await this.startSession(userId, phoneNumber);
    return { pairingCode: safeUserId(userId), status: this.sessions.get(userId)?.status || 'init' };
  }

  private async reconnect(userId: string, attempt = 0) {
    const entry = this.sessions.get(userId);
    if (!entry) return; // User has disconnected/removed the session

    // If it's already logged out, do not reconnect
    if (entry.status === 'disconnected') return;

    entry.reconnecting = true;
    
    // Calculate backoff delay: 2s, 5s, 10s, 30s, up to 60s max
    const delays = [2000, 5000, 10000, 30000, 60000];
    const delay = delays[Math.min(attempt, delays.length - 1)];

    console.log(`[WhatsApp] Scheduling reconnection for ${userId} in ${delay}ms (attempt ${attempt + 1})`);

    this.clearReconnectTimer(entry);

    entry.reconnectTimer = setTimeout(async () => {
      // Check again if the session is still active and unchanged
      const currentEntry = this.sessions.get(userId);
      if (currentEntry !== entry) return;

      try {
        console.log(`[WhatsApp] Attempting to reconnect session for ${userId}...`);
        await this.startSession(userId);
      } catch (error: any) {
        console.error(`[WhatsApp] Reconnection attempt ${attempt + 1} failed for ${userId}:`, error.message);
        
        // Update status and error in the active session
        const activeEntry = this.sessions.get(userId);
        if (activeEntry === entry) {
          activeEntry.status = 'error';
          activeEntry.error = error.message || 'Reconnect failed';
          // Trigger the next retry
          this.reconnect(userId, attempt + 1);
        }
      }
    }, delay);
  }

  async startSession(userId: string, phoneNumber?: string): Promise<void> {
    const safeId = safeUserId(userId);
    const authDir = path.join(this.authRoot, safeId);
    const dataFile = path.join(authDir, 'session-data.json');
    ensureDir(authDir);

    let entry = this.sessions.get(userId);
    if (entry) {
      this.clearSaveTimer(entry);
      this.clearReconnectTimer(entry);
      try {
        entry.sock?.end?.(undefined);
      } catch {}
      
      entry.status = 'init';
      entry.sock = null;
      entry.error = null;
    } else {
      const savedData = readSessionData(dataFile);
      entry = {
        userId,
        status: 'init',
        qrCode: null,
        qrRaw: null,
        pairingCode: null,
        phone: null,
        sock: null,
        authDir,
        dataFile,
        error: null,
        recentMessages: savedData.recentMessages,
        contacts: savedData.contacts,
        messageById: new Map(),
        reconnecting: false,
        saveTimer: null,
        reconnectTimer: null,
      };
      this.sessions.set(userId, entry);
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      if (this.sessions.get(userId) !== entry) return;

      let version: [number, number, number] = [2, 3000, 0];
      try {
        const fetched = await fetchLatestBaileysVersion();
        if (this.sessions.get(userId) !== entry) return;
        version = fetched.version;
      } catch (verErr: any) {
        console.warn(`[WhatsApp] Failed to fetch latest Baileys version, using fallback:`, verErr.message);
      }

      const sock = makeWASocket({
        version,
        logger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async (key) => {
          const jid = key.remoteJid;
          const id = key.id;
          if (!jid || !id) return undefined;
          return entry!.messageById.get(`${jid}:${id}`)?.message;
        },
      });

      entry.sock = sock;

      if (phoneNumber && !state.creds.registered) {
        setTimeout(async () => {
          try {
            const cleaned = phoneNumber.replace(/\D/g, '');
            console.log(`[Baileys] Requesting pairing code for phone number: ${cleaned}`);
            const code = await sock.requestPairingCode(cleaned);
            if (this.sessions.get(userId) !== entry) return;
            entry.pairingCode = code;
            entry.status = 'qr_ready';
            console.log(`[Baileys] Generated pairing code successfully: ${code}`);
          } catch (err: any) {
            console.error(`[Baileys] Failed to generate pairing code:`, err);
            if (this.sessions.get(userId) !== entry) return;
            entry.error = err.message || 'Failed to request pairing code';
            entry.status = 'error';
          }
        }, 1000);
      }

      entry.saveTimer = setInterval(() => {
        try {
          if (entry && this.sessions.get(userId) === entry) {
            writeSessionData(entry);
          }
        } catch (error) {
          console.warn(`Failed to write WhatsApp data for ${userId}:`, error);
        }
      }, 10_000);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (this.sessions.get(userId) !== entry) return;

        if (qr) {
          entry.qrRaw = qr;
          entry.qrCode = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
          entry.status = 'qr_ready';
          entry.error = null;
        }

        if (connection === 'open') {
          entry.status = 'paired';
          entry.qrCode = null;
          entry.qrRaw = null;
          entry.error = null;
          entry.phone = sock.user?.id ? jidNumber(sock.user.id) : 'connected';
          console.log(`WhatsApp paired for user ${userId}: ${entry.phone}`);
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          entry.status = loggedOut ? 'disconnected' : 'error';
          entry.error = loggedOut ? null : (lastDisconnect?.error?.message || 'WhatsApp connection closed');
          entry.sock = null;
          this.clearSaveTimer(entry);

          if (!loggedOut) {
            this.reconnect(userId, 0);
          }
        }
      });

      sock.ev.on('messages.upsert', ({ messages }: any) => {
        if (this.sessions.get(userId) !== entry) return;

        for (const msg of messages || []) {
          const chatId = msg.key?.remoteJid || '';
          if (!chatId || chatId === 'status@broadcast') continue;
          if (msg.key?.id) entry.messageById.set(`${chatId}:${msg.key.id}`, msg);

          const body = messageText(msg) || '[media]';
          const record: WaRecentMessage = {
            id: msg.key?.id || `${chatId}:${Date.now()}`,
            chatId,
            from: msg.key?.participant || msg.key?.remoteJid || '',
            body: body.slice(0, 1000),
            timestamp: timestampMs(msg.messageTimestamp),
            fromMe: !!msg.key?.fromMe,
            isGroup: chatId.endsWith('@g.us'),
            isMedia: !!msg.message?.imageMessage || !!msg.message?.videoMessage || !!msg.message?.documentMessage,
          };
          entry.recentMessages.unshift(record);

          // Capture public profile name (pushName) from incoming messages to pair it with the JID
          if (chatId && chatId.endsWith('@s.whatsapp.net') && msg.pushName) {
            const existing = entry.contacts[chatId];
            const savedName = existing?.name && existing.name !== chatId ? existing.name : '';
            const notifyName = msg.pushName || existing?.notify || '';
            entry.contacts[chatId] = {
              id: chatId,
              name: savedName || notifyName || chatId,
              notify: notifyName || undefined,
              verifiedName: existing?.verifiedName || undefined,
              number: jidNumber(chatId),
            };
          }
        }
        entry.recentMessages = entry.recentMessages.slice(0, 250);
      });

      const updateContacts = (contacts: any[]) => {
        if (this.sessions.get(userId) !== entry) return;

        for (const contact of contacts || []) {
          const id = contact.id || contact.jid;
          if (!id || !String(id).endsWith('@s.whatsapp.net')) continue;
          
          const existing = entry.contacts[id];
          const savedName = contact.name || (existing?.name && existing.name !== id ? existing.name : '');
          const notifyName = contact.notify || contact.verifiedName || existing?.notify || '';

          entry.contacts[id] = {
            id,
            name: savedName || notifyName || id,
            notify: notifyName || undefined,
            verifiedName: contact.verifiedName || existing?.verifiedName || undefined,
            number: jidNumber(id),
          };
        }
      };

      sock.ev.on('messaging-history.set', ({ contacts }: any) => {
        updateContacts(contacts || []);
      });
      sock.ev.on('contacts.upsert', updateContacts);
      sock.ev.on('contacts.update', updateContacts);

    } catch (err: any) {
      console.error(`[WhatsApp] Failed to initialize session for ${userId}:`, err.message);
      if (this.sessions.get(userId) === entry) {
        entry.status = 'error';
        entry.error = err.message || 'Failed to initialize WhatsApp session';
        
        const hasCreds = fs.existsSync(path.join(authDir, 'creds.json'));
        if (hasCreds) {
          this.reconnect(userId, 0);
        }
      }
    }
  }

  async getStatusOrStart(userId: string): Promise<{ status: string; qrCode?: string; phone?: string; error?: string; pairingCode?: string } | null> {
    const current = this.getStatus(userId);
    if (current) return current;

    const authDir = path.join(this.authRoot, safeUserId(userId));
    if (fs.existsSync(path.join(authDir, 'creds.json'))) {
      await this.startSession(userId);
      return this.getStatus(userId);
    }

    return null;
  }

  getStatus(userId: string): { status: string; qrCode?: string; phone?: string; error?: string; pairingCode?: string } | null {
    const entry = this.sessions.get(userId);
    if (!entry) return null;
    return {
      status: entry.status,
      qrCode: entry.qrCode || undefined,
      phone: entry.phone || undefined,
      error: entry.error || undefined,
      pairingCode: entry.pairingCode || undefined,
    };
  }

  getAdminConfigPublic(userId: string): WaAdminConfigPublic {
    const config = this.readAdminConfig(userId);
    return {
      provider: config.provider,
      displayName: config.displayName,
      businessAccountId: config.businessAccountId,
      phoneNumberId: config.phoneNumberId,
      apiVersion: config.apiVersion,
      hasAccessToken: !!config.accessToken,
      hasAppSecret: !!config.appSecret,
      hasWebhookVerifyToken: !!config.webhookVerifyToken,
      defaultCountryCode: config.defaultCountryCode,
      permissions: config.permissions,
      updatedAt: config.updatedAt || null,
    };
  }

  saveAdminConfig(userId: string, input: WaAdminConfigInput): WaAdminConfigPublic {
    const current = this.readAdminConfig(userId);
    const next: WaAdminConfig = {
      ...current,
      provider: input.provider || current.provider,
      displayName: input.displayName?.trim() ?? current.displayName,
      businessAccountId: input.businessAccountId?.trim() ?? current.businessAccountId,
      phoneNumberId: input.phoneNumberId?.trim() ?? current.phoneNumberId,
      apiVersion: input.apiVersion?.trim() || current.apiVersion || 'v23.0',
      defaultCountryCode: cleanPhoneNumber(input.defaultCountryCode || current.defaultCountryCode),
      permissions: input.permissions ? normalizePermissions(input.permissions) : current.permissions,
      updatedAt: new Date().toISOString(),
      accessToken: input.accessToken?.trim() ? input.accessToken.trim() : current.accessToken,
      appSecret: input.appSecret?.trim() ? input.appSecret.trim() : current.appSecret,
      webhookVerifyToken: input.webhookVerifyToken?.trim() ? input.webhookVerifyToken.trim() : current.webhookVerifyToken,
    };

    this.writeAdminConfig(userId, next);
    return this.getAdminConfigPublic(userId);
  }

  getEffectivePermissions(userId: string, requestPermissions?: Record<string, boolean>): Record<string, boolean> {
    const config = this.readAdminConfig(userId);
    if (config.updatedAt) return config.permissions;
    return requestPermissions || config.permissions;
  }

  async sendCloudTextMessage(userId: string, to: string, text: string): Promise<{ chatId: string; messageId?: string } | null> {
    const config = this.readAdminConfig(userId);
    if (config.provider !== 'cloud_api' || !config.accessToken || !config.phoneNumberId) return null;

    const resolvedJid = this.resolveContactJid(userId, to);
    const resolvedNumber = jidNumber(resolvedJid);
    const recipient = cleanPhoneNumber(resolvedNumber || to, config.defaultCountryCode);
    if (!recipient) throw new Error('Recipient phone number required');

    const version = config.apiVersion || 'v23.0';
    const url = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(config.phoneNumberId)}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `WhatsApp Cloud API returned ${response.status}`);
    }

    return { chatId: `${recipient}@cloud.whatsapp`, messageId: data?.messages?.[0]?.id };
  }

  async getAdminOverview(userId: string) {
    const status = await this.getStatusOrStart(userId);
    const config = this.getAdminConfigPublic(userId);
    return {
      config,
      status: status || { status: 'not_found' },
      messages: this.getRecentMessages(userId, 20),
      chats: this.getChats(userId, 20),
      contactsCount: this.getContacts(userId, 500).length,
      authRootConfigured: !!this.authRoot,
    };
  }

  ingestCloudWebhook(userId: string, payload: any): { accepted: number } {
    const safeId = safeUserId(userId);
    const authDir = path.join(this.authRoot, safeId);
    const dataFile = path.join(authDir, 'session-data.json');
    ensureDir(authDir);

    let entry = this.sessions.get(userId);
    if (!entry) {
      const savedData = readSessionData(dataFile);
      entry = {
        userId,
        status: 'paired',
        qrCode: null,
        qrRaw: null,
        phone: null,
        sock: null,
        authDir,
        dataFile,
        error: null,
        recentMessages: savedData.recentMessages,
        contacts: savedData.contacts,
        messageById: new Map(),
        reconnecting: false,
        saveTimer: null,
      };
      this.sessions.set(userId, entry);
    }

    let accepted = 0;
    for (const root of payload?.entry || []) {
      for (const change of root?.changes || []) {
        for (const msg of change?.value?.messages || []) {
          const from = msg.from || '';
          const chatId = from ? `${from}@cloud.whatsapp` : `cloud:${Date.now()}`;
          const body = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '[cloud message]';
          entry.recentMessages.unshift({
            id: msg.id || `${chatId}:${Date.now()}`,
            chatId,
            from,
            body: String(body).slice(0, 1000),
            timestamp: msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now(),
            fromMe: false,
            isGroup: false,
            isMedia: !!msg.image || !!msg.video || !!msg.document || !!msg.audio,
          });
          accepted++;
        }
      }
    }

    entry.recentMessages = entry.recentMessages.slice(0, 250);
    writeSessionData(entry);
    return { accepted };
  }

  verifyWebhookToken(userId: string, token: unknown): boolean {
    const expected = this.readAdminConfig(userId).webhookVerifyToken;
    return !!expected && String(token || '') === expected;
  }

  getRecentMessages(userId: string, limit = 20): WaRecentMessage[] {
    const entry = this.sessions.get(userId);
    if (!entry) return [];
    return entry.recentMessages.slice(0, Math.min(limit, 50));
  }

  getChats(userId: string, limit = 20): WaChatSummary[] {
    const entry = this.sessions.get(userId);
    if (!entry) return [];

    const byId = new Map<string, WaChatSummary>();
    for (const msg of entry.recentMessages) {
      const current = byId.get(msg.chatId);
      if (!current || msg.timestamp >= current.timestamp) {
        byId.set(msg.chatId, {
          id: msg.chatId,
          name: current?.name || entry.contacts[msg.chatId]?.name || msg.chatId,
          unreadCount: current?.unreadCount || 0,
          lastMessage: msg.body.slice(0, 160),
          timestamp: msg.timestamp,
          isGroup: msg.isGroup,
        });
      }
    }

    return [...byId.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, Math.min(limit, 50));
  }

  getContacts(userId: string, limit = 100): WaContactSummary[] {
    const entry = this.sessions.get(userId);
    if (!entry?.contacts) return [];

    return Object.values(entry.contacts)
      .filter(contact => contact.id.endsWith('@s.whatsapp.net'))
      .slice(0, Math.min(limit, 500));
  }

  resolveContactJid(userId: string, nameOrNumberOrJid: string): string {
    const input = String(nameOrNumberOrJid || '').trim();
    if (!input) return '';

    // If it's already a JID, return it
    if (input.endsWith('@s.whatsapp.net') || input.endsWith('@g.us') || input.endsWith('@broadcast')) {
      return input;
    }

    // If it contains only digits (with optional leading +), it's a number
    const isNumber = /^\+?\d+$/.test(input);
    if (isNumber) {
      return toWhatsAppJid(input);
    }

    // Otherwise, search contacts by name
    const entry = this.sessions.get(userId);
    if (entry?.contacts) {
      const searchName = input.toLowerCase();

      // 1. Try exact match on saved phone book name
      let match = Object.values(entry.contacts).find(
        c => c.name && c.name.toLowerCase() === searchName
      );
      if (match) return match.id;

      // 2. Try exact match on notify (WhatsApp public profile pushname)
      match = Object.values(entry.contacts).find(
        c => c.notify && c.notify.toLowerCase() === searchName
      );
      if (match) return match.id;

      // 3. Try exact match on verified business name
      match = Object.values(entry.contacts).find(
        c => c.verifiedName && c.verifiedName.toLowerCase() === searchName
      );
      if (match) return match.id;

      // 4. Try partial case-insensitive match on saved name
      match = Object.values(entry.contacts).find(
        c => c.name && c.name.toLowerCase().includes(searchName)
      );
      if (match) return match.id;

      // 5. Try partial case-insensitive match on notify name
      match = Object.values(entry.contacts).find(
        c => c.notify && c.notify.toLowerCase().includes(searchName)
      );
      if (match) return match.id;
    }

    // Fallback: clean digits anyway
    return toWhatsAppJid(input);
  }

  async getGroups(userId: string): Promise<WaChatSummary[]> {
    const sock = this.getClient(userId);
    if (!sock) return [];
    const groups = await sock.groupFetchAllParticipating();
    return Object.entries(groups).map(([id, meta]: [string, any]) => ({
      id,
      name: meta.subject || id,
      unreadCount: 0,
      lastMessage: '',
      timestamp: timestampMs(meta.creation),
      isGroup: true,
    }));
  }

  getMessageHistory(userId: string, chatId: string, limit = 20): WaRecentMessage[] {
    const entry = this.sessions.get(userId);
    if (!entry) return [];
    const jid = toWhatsAppJid(chatId, chatId.endsWith('@g.us'));
    return entry.recentMessages
      .filter(message => message.chatId === jid)
      .slice(0, Math.min(limit, 50));
  }

  async disconnect(userId: string): Promise<void> {
    const entry = this.sessions.get(userId);
    if (!entry) return;
    try {
      if (entry.sock) {
        await entry.sock.logout().catch(async () => entry.sock?.end?.(undefined));
      }
    } catch (error) {
      console.error(`WhatsApp disconnect error for ${userId}:`, error);
    }

    this.clearSaveTimer(entry);
    this.clearReconnectTimer(entry);
    this.sessions.delete(userId);
    fs.rmSync(entry.authDir, { recursive: true, force: true });
  }

  getClient(userId: string): any {
    const entry = this.sessions.get(userId);
    if (!entry || entry.status !== 'paired' || !entry.sock) return null;
    return entry.sock;
  }

  isPaired(userId: string): boolean {
    return this.sessions.get(userId)?.status === 'paired';
  }

  async shutdown(): Promise<void> {
    for (const entry of this.sessions.values()) {
      this.clearSaveTimer(entry);
      this.clearReconnectTimer(entry);
      try {
        writeSessionData(entry);
        entry.sock?.end?.(undefined);
      } catch {}
    }
    this.sessions.clear();
  }

  private clearSaveTimer(entry: WaSession) {
    if (entry.saveTimer) {
      clearInterval(entry.saveTimer);
      entry.saveTimer = null;
    }
  }

  private clearReconnectTimer(entry: WaSession) {
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  }

  private adminConfigFile(userId: string): string {
    const authDir = path.join(this.authRoot, safeUserId(userId));
    ensureDir(authDir);
    return path.join(authDir, 'admin-config.json');
  }

  private readAdminConfig(userId: string): WaAdminConfig {
    const file = this.adminConfigFile(userId);
    const fallback: WaAdminConfig = {
      provider: 'linked_device',
      displayName: '',
      businessAccountId: '',
      phoneNumberId: '',
      apiVersion: 'v23.0',
      accessToken: '',
      appSecret: '',
      webhookVerifyToken: '',
      defaultCountryCode: '',
      permissions: defaultPermissions(),
      updatedAt: '',
    };

    try {
      if (!fs.existsSync(file)) return fallback;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        ...fallback,
        ...parsed,
        provider: parsed.provider === 'cloud_api' ? 'cloud_api' : 'linked_device',
        permissions: normalizePermissions(parsed.permissions),
      };
    } catch {
      return fallback;
    }
  }

  private writeAdminConfig(userId: string, config: WaAdminConfig) {
    fs.writeFileSync(this.adminConfigFile(userId), JSON.stringify(config, null, 2));
  }
}
