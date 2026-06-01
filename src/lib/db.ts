import Dexie, { Table } from 'dexie';

export interface ChatMessage {
  id?: number;
  userId: string;
  sessionId?: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  attachmentUrl?: string;
  attachmentName?: string;
}

export interface UserSettings {
  userId: string;
  googleToken?: string;
  googleRefreshToken?: string;
  avatarUrl?: string;
  whatsappPaired?: boolean;
  whatsappPhone?: string | null;
  whatsappPermissions?: any;
  knowledgeDomains?: string[];
  updatedAt?: string;
  customPrompt?: string;
  personaName?: string;
  selectedVoice?: string;
  contextSize?: number;
  userTitle?: string;
  language?: string;
  locationEnabled?: boolean;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

export interface Session {
  id: string;
  userId: string;
  lastActive: string;
}

export interface KnowledgeFile {
  id: string;
  userId: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  opfsPath: string;
}

export interface WorkspaceOutput {
  id: string;
  userId: string;
  type: 'document' | 'image' | 'video' | 'screenshot' | 'capture';
  title: string;
  textContent?: string;
  blobData?: ArrayBuffer;
  mimeType: string;
  fileSize: number;
  driveFileId?: string;
  driveLink?: string;
  createdAt: string;
}

export interface LongTermMemory {
  id?: number;
  userId: string;
  category: 'family' | 'preferences' | 'personal' | 'work' | 'health' | 'other';
  key: string;
  value: string;
  importance: 'low' | 'medium' | 'high';
  lastMentioned: string;
  createdAt: string;
  updatedAt: string;
}

export class BeatriceDatabase extends Dexie {
  messages!: Table<ChatMessage, number>;
  settings!: Table<UserSettings, string>;
  sessions!: Table<Session, string>;
  knowledgeFiles!: Table<KnowledgeFile, string>;
  workspaceOutputs!: Table<WorkspaceOutput, string>;
  longTermMemories!: Table<LongTermMemory, number>;

  constructor() {
    super('BeatriceDB');
    this.version(2).stores({
      messages: '++id, userId, sessionId, role, timestamp',
      settings: 'userId',
      sessions: 'id, userId, lastActive',
      knowledgeFiles: 'id, userId, name, uploadedAt',
      workspaceOutputs: 'id, userId, type, createdAt',
      longTermMemories: '++id, userId, category, key, importance, lastMentioned'
    });
  }
}

export const db = new BeatriceDatabase();
