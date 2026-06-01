import type { WhatsAppManager, WaRecentMessage } from './whatsapp';
import { toWhatsAppJid } from './whatsapp';

const ALL_PERMISSIONS = [
  'send_messages',
  'read_chats',
  'access_contacts',
  'manage_contacts',
  'access_groups',
  'send_group_messages',
  'read_group_chats',
  'view_message_history',
] as const;

type Permission = typeof ALL_PERMISSIONS[number];

function requirePerm(permissions: Record<string, boolean> | undefined, perm: Permission): string | null {
  if (!permissions?.[perm]) {
    return `Permission denied: "${perm}" is not enabled. User must enable this toggle in settings.`;
  }
  return null;
}

function cleanLimit(limit: unknown, fallback = 20): number {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 50);
}

function requireText(value: unknown, label: string): string | null {
  const text = String(value || '').trim();
  if (!text) return `${label} required`;
  return null;
}

/**
 * Format an array of WhatsApp messages into a clear, labeled conversation transcript
 * that the AI can use to understand who said what.
 *
 * @param messages - Raw WaRecentMessage array (from newest to oldest, as stored)
 * @param partnerName - Display name of the other person in a 1:1 chat
 * @param options - Optional settings for groups and participant resolution
 * @returns A human-readable, labeled conversation string
 */
function formatConversation(
  messages: WaRecentMessage[],
  partnerName: string,
  options: {
    isGroup?: boolean;
    groupName?: string;
    participantResolver?: (jid: string) => string;
  } = {},
): string {
  if (!messages || messages.length === 0) {
    const label = options.isGroup ? (options.groupName || 'Group') : partnerName;
    return `📱 WhatsApp ${options.isGroup ? 'Group' : 'Conversation'} with ${label}\n(No messages)`;
  }

  const header = options.isGroup
    ? `📱 WhatsApp Group: ${options.groupName || partnerName}`
    : `📱 WhatsApp Conversation with ${partnerName}`;

  const separator = '━'.repeat(48);

  // Sort chronologically (oldest first) for a natural reading order
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);

  const lines = sorted.map((msg) => {
    const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const body = msg.body || (msg.isMedia ? '[Media message]' : '');

    let sender: string;
    if (msg.fromMe) {
      sender = 'You (Boss)';
    } else if (options.isGroup && options.participantResolver) {
      sender = options.participantResolver(msg.from) || partnerName;
    } else {
      sender = partnerName;
    }

    return `[${timeStr}] ${sender}: ${body}`;
  });

  const count = messages.length;
  return `${header} (${count} message${count !== 1 ? 's' : ''})\n${separator}\n${lines.join('\n')}\n${separator}`;
}

export async function handleSendMessage(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, boolean> | undefined,
  to: string,
  text: string,
): Promise<{ ok: true; sent: boolean; chatId: string; messageId?: string } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'send_messages');
  if (denied) return { ok: false, error: denied };

  const recipientError = requireText(to, 'Recipient');
  if (recipientError) return { ok: false, error: recipientError };
  const textError = requireText(text, 'Message text');
  if (textError) return { ok: false, error: textError };

  try {
    const sock = wa.getClient(userId);
    const chatId = typeof wa.resolveContactJid === 'function' ? wa.resolveContactJid(userId, to) : toWhatsAppJid(to);
    if (!sock) {
      const cloudSent = await wa.sendCloudTextMessage(userId, to, text);
      if (cloudSent) {
        return { ok: true, sent: true, chatId: cloudSent.chatId, messageId: cloudSent.messageId };
      }
      return { ok: false, error: 'WhatsApp not paired and no WhatsApp Cloud API credentials are configured' };
    }
    const sent = await sock.sendMessage(chatId, { text });
    return { ok: true, sent: true, chatId, messageId: sent?.key?.id };
  } catch (error: any) {
    return { ok: false, error: error.message || 'Send failed' };
  }
}

export async function handleReadChats(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, boolean> | undefined,
  limit: number = 20,
): Promise<{ ok: true; chats: any[]; formattedChatList: string } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'read_chats');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };

  const chats = wa.getChats(userId, cleanLimit(limit));

  // Build a compact, labeled chat list
  const lines = chats.map((c: any, i: number) => {
    const badge = c.isGroup ? '👥' : '💬';
    const unread = c.unreadCount > 0 ? ` (${c.unreadCount} unread)` : '';
    const preview = c.lastMessage ? `: "${c.lastMessage.slice(0, 80)}"` : '';
    return `${i + 1}. ${badge} ${c.name}${unread}${preview}`;
  });

  const formattedChatList = `📱 Recent WhatsApp Chats (${chats.length})\n${'━'.repeat(40)}\n${lines.join('\n')}\n${'━'.repeat(40)}`;

  return { ok: true, chats, formattedChatList };
}

export async function handleGetContacts(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, boolean> | undefined,
): Promise<{ ok: true; contacts: any[] } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'access_contacts');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  const raw = wa.getContacts(userId);
  // Enrich contacts with explicit labels so the AI model can distinguish
  // between the user's saved name and the contact's own WhatsApp profile name
  const contacts = raw.map(c => ({
    id: c.id,
    number: c.number,
    savedName: c.name,            // What the USER saved this contact as in their phonebook
    whatsappProfileName: c.notify, // The contact's own public WhatsApp display name (pushName)
    verifiedName: c.verifiedName,  // Verified business name (if applicable)
  }));
  return { ok: true, contacts };
}

export async function handleAddContact(
  _wa: WhatsAppManager,
  _userId: string,
  permissions: Record<string, boolean> | undefined,
  name: string,
  number: string,
): Promise<{ ok: true; added: boolean } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'manage_contacts');
  if (denied) return { ok: false, error: denied };
  const nameError = requireText(name, 'Contact name');
  if (nameError) return { ok: false, error: nameError };
  const numberError = requireText(number, 'Contact number');
  if (numberError) return { ok: false, error: numberError };
  return {
    ok: false,
    error: 'Adding contacts is not exposed by Baileys as a reliable WhatsApp Web operation. Save the contact on the device, then refresh contacts.',
  };
}

export async function handleGetGroups(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, boolean> | undefined,
): Promise<{ ok: true; groups: any[] } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'access_groups');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  try {
    const groups = await wa.getGroups(userId);
    return { ok: true, groups };
  } catch (error: any) {
    return { ok: false, error: error.message || 'Failed to get groups' };
  }
}

export async function handleSendGroupMessage(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, boolean> | undefined,
  groupId: string,
  text: string,
): Promise<{ ok: true; sent: boolean; groupId: string; messageId?: string } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'send_group_messages');
  if (denied) return { ok: false, error: denied };

  const groupError = requireText(groupId, 'Group ID');
  if (groupError) return { ok: false, error: groupError };
  const textError = requireText(text, 'Message text');
  if (textError) return { ok: false, error: textError };

  const sock = wa.getClient(userId);
  if (!sock) return { ok: false, error: 'WhatsApp not paired' };

  try {
    const jid = toWhatsAppJid(groupId, true);
    const sent = await sock.sendMessage(jid, { text });
    return { ok: true, sent: true, groupId: jid, messageId: sent?.key?.id };
  } catch (error: any) {
    return { ok: false, error: error.message || 'Failed to send group message' };
  }
}

export async function handleReadGroupChat(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, boolean> | undefined,
  groupId: string,
  limit: number = 20,
): Promise<{
  ok: true;
  messages: any[];
  formattedConversation: string;
  groupName: string;
  messageCount: number;
} | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'read_group_chats');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  const groupError = requireText(groupId, 'Group ID');
  if (groupError) return { ok: false, error: groupError };

  const resolvedJid = toWhatsAppJid(groupId, true);
  const rawMessages: WaRecentMessage[] = wa.getMessageHistory(userId, resolvedJid, cleanLimit(limit));

  // Resolve group name from stored chats, or fall back to JID
  const chats = wa.getChats(userId, 50);
  const groupChat = chats.find((c: any) => c.id === resolvedJid);
  const groupDisplayName = groupChat?.name || resolvedJid.split('@')[0] || 'Unknown Group';

  // Build a participant name resolver from the contacts list
  const contacts = wa.getContacts(userId, 500);
  const participantResolver = (jid: string): string => {
    const contact = contacts.find((c: any) => c.id === jid);
    return contact?.name || contact?.notify || jid.split('@')[0] || 'Unknown';
  };

  const formattedConversation = formatConversation(rawMessages, groupDisplayName, {
    isGroup: true,
    groupName: groupDisplayName,
    participantResolver,
  });

  return {
    ok: true,
    messages: rawMessages,
    formattedConversation,
    groupName: groupDisplayName,
    messageCount: rawMessages.length,
  };
}

export async function handleGetMessageHistory(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, boolean> | undefined,
  chatId: string,
  limit: number = 20,
): Promise<{
  ok: true;
  messages: any[];
  formattedConversation: string;
  conversationWith: string;
  messageCount: number;
  contactSavedName?: string;
  contactProfileName?: string;
  contactJid: string;
} | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'view_message_history');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  const chatError = requireText(chatId, 'Chat ID');
  const resolvedJid = typeof wa.resolveContactJid === 'function' ? wa.resolveContactJid(userId, chatId) : toWhatsAppJid(chatId);

  const rawMessages: WaRecentMessage[] = wa.getMessageHistory(userId, resolvedJid, cleanLimit(limit));

  // Resolve the contact's display name from the phonebook
  const contacts = wa.getContacts(userId, 500);
  const contact = contacts.find((c: any) => c.id === resolvedJid);
  const contactName = contact?.name || contact?.notify || resolvedJid.split('@')[0] || 'Unknown';
  const savedName = contact?.name || undefined;
  const profileName = contact?.notify || undefined;

  const formattedConversation = formatConversation(rawMessages, contactName, { isGroup: false });

  return {
    ok: true,
    messages: rawMessages,
    formattedConversation,
    conversationWith: contactName,
    messageCount: rawMessages.length,
    contactSavedName: savedName,
    contactProfileName: profileName,
    contactJid: resolvedJid,
  };
}
