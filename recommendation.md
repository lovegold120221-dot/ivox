# Recommendation: Local-First Storage with Firebase Auth

## Problem Statement

The Beatrice app currently stores all user data in cloud databases (Supabase for messages, settings, knowledge files). This means:

- **Every page load** requires a network request to Supabase — slow or broken when offline
- **Message history** is inaccessible without internet
- **Uploaded knowledge files** live in Supabase Storage, requiring download on every session start
- **Google OAuth tokens** stored in fragile `localStorage` (5-10MB limit, sync API, blocks main thread)
- **User settings** (permissions, persona, voice) are fetched from Supabase on every init

The user wants data to live primarily **on-device** while still using **Firebase Authentication** for identity.

---

## Available Browser Storage Technologies

| Technology | Max Size | Async? | Survives Close? | Structured Data? | Binary? |
|---|---|---|---|---|---|
| **IndexedDB** | ~50% of disk (GBs) | ✅ | ✅ | ✅ (objects, indexes) | ✅ (ArrayBuffer, Blob) |
| **OPFS** (Origin Private File System) | ~50% of disk | ✅ | ✅ | ❌ (files only) | ✅ (fast file I/O) |
| **Cache API** | ~50% of disk | ✅ | ✅ | ❌ (HTTP pairs) | ✅ |
| **localStorage** | 5–10 MB | ❌ (sync) | ✅ | ❌ (strings only) | ❌ |
| **sessionStorage** | 5–10 MB | ❌ (sync) | ❌ (per tab) | ❌ (strings only) | ❌ |
| **WebSQL** (deprecated) | ~50 MB | ✅ | ✅ | ✅ | ❌ |

### IndexedDB — The Gold Standard

IndexedDB is the clear winner for general-purpose local storage:

- **Massive capacity**: Typically 50% of available disk space (several GB on modern devices)
- **Async API**: Never blocks the main thread
- **Persistence**: Survives browser close, tab close, even browser restart
- **Structured data**: Native support for JavaScript objects, auto-generated indexes, cursor-based queries
- **Binary support**: Can store `ArrayBuffer`, `Blob`, `File` objects
- **Transaction safety**: ACID semantics with read/write transactions
- **Cross-tab**: Events fire when data changes in other tabs

### Dexie.js — The Best Wrapper

[Dexie.js](https://dexie.org/) wraps IndexedDB's verbose callback API into a clean, promise-based interface:

```typescript
class BeatriceDatabase extends Dexie {
  messages!: Dexie.Table<ChatMessage, number>;
  settings!: Dexie.Table<UserSettings, string>;
  sessions!: Dexie.Table<Session, string>;
  knowledgeFiles!: Dexie.Table<KnowledgeFile, string>;

  constructor() {
    super('BeatriceDB');
    this.version(2).stores({
      messages: '++id, userId, sessionId, role, createdAt',
      settings: 'userId',
      sessions: '++id, userId, lastActive',
      knowledgeFiles: '++id, userId, fileName, uploadedAt',
    });
  }
}
```

### OPFS — Binary/Large Files

The Origin Private File System (part of the File System Access API) is ideal for:

- **Knowledge files** (PDFs, DOCs, TXTs uploaded by the user)
- **Avatars** and images
- **Audio recordings** (ambient conversation bed, voice samples)
- **Generated documents** (HTML artifacts from document generation)

OPFS is accessible via `navigator.storage.getDirectory()` in secure contexts (HTTPS). It provides a virtual filesystem with async file handles.

---

## Recommended Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Browser                                        │
│                                                                          │
│  ┌──────────────────────┐   ┌────────────────────────────────────────┐  │
│  │   Firebase Auth      │   │       Local Storage Layer              │  │
│  │   (identity only)    │   │                                        │  │
│  │                      │   │  ┌──────────────────────────────────┐  │  │
│  │  onAuthStateChanged  │   │  │  IndexedDB (Dexie.js)            │  │  │
│  │  ─────► uid, email   │──┼──│  ┌────────────────────────────┐   │  │  │
│  └──────────────────────┘   │  │  │ messages                   │   │  │  │
│                             │  │  │  • All chat history        │   │  │  │
│                             │  │  │  • Indexed by userId + sid │   │  │  │
│                             │  │  ├────────────────────────────┤   │  │  │
│                             │  │  │ settings                   │   │  │  │
│                             │  │  │  • Permissions, persona    │   │  │  │
│                             │  │  │  • Voice, language, title  │   │  │  │
│                             │  │  ├────────────────────────────┤   │  │  │
│                             │  │  │ sessions                   │   │  │  │
│                             │  │  │  • Session grouping        │   │  │  │
│                             │  │  │  • Last active timestamp   │   │  │  │
│                             │  │  ├────────────────────────────┤   │  │  │
│                             │  │  │ knowledgeFilesMeta         │   │  │  │
│                             │  │  │  • File metadata + OPFS ref│   │  │  │
│                             │  │  └────────────────────────────┘   │  │  │
│                             │  └──────────────────────────────────┘  │  │
│                             │                                         │  │
│                             │  ┌──────────────────────────────────┐  │  │
│                             │  │  OPFS (Origin Private FS)        │  │  │
│                             │  │  ┌────────────────────────────┐   │  │  │
│                             │  │  │ /knowledge/                 │   │  │  │
│                             │  │  │   • <fileId>.pdf           │   │  │  │
│                             │  │  │   • <fileId>.docx          │   │  │  │
│                             │  │  ├────────────────────────────┤   │  │  │
│                             │  │  │ /avatars/                   │   │  │  │
│                             │  │  │   • <userId>.jpg           │   │  │  │
│                             │  │  ├────────────────────────────┤   │  │  │
│                             │  │  │ /documents/                 │   │  │  │
│                             │  │  │   • generated HTML files   │   │  │  │
│                             │  │  └────────────────────────────┘   │  │  │
│                             │  └──────────────────────────────────┘  │  │
│                             └────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────┐             │
│  │  Background Sync Layer (optional, online only)          │             │
│  │                                                         │             │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │             │
│  │  │ Push local   │  │ Pull remote  │  │ Conflict     │   │             │
│  │  │ changes to   │  │ changes from │  │ resolution   │   │             │
│  │  │ Supabase     │  │ Supabase     │  │ (LWW)        │   │             │
│  │  └─────────────┘  └──────────────┘  └──────────────┘   │             │
│  └────────────────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Core Principle: Local-First

1. **Read from local** — Every query hits IndexedDB first. Zero network required.
2. **Write to local first** — Every insert/update goes to IndexedDB immediately. User sees results instantly.
3. **Sync to cloud lazily** — When online, push local changes to Supabase in the background. Never block the UI for a network request.
4. **Auth is separate** — Firebase Authentication remains the identity layer. It needs network for sign-in, but after that, all data operations are local.

---

## How Firebase Auth Fits In

```
onAuthStateChanged(user) {
  if (!user) { showAuthPage(); return; }

  // Open IndexedDB database scoped to this user
  const db = await openUserDatabase(user.uid);

  // Read local data immediately (zero network)
  const messages = await db.messages.where({ userId: user.uid }).toArray();
  const settings = await db.settings.get(user.uid);

  // Kick off optional background sync
  syncInBackground(user.uid, db);

  // Render app with local data
  renderApp({ messages, settings });
}
```

- **Firebase Auth is only needed once** (at login). After that, the app works fully offline.
- The **user's `uid`** becomes the partition key for IndexedDB stores.
- A **single IndexedDB database** (`BeatriceDB`) can serve all users by filtering on `userId`, or use **separate database names** per user (`BeatriceDB_<uid>`).

---

## Data Migration Strategy

### Phase 1: Add Local Read (safe, additive)

```typescript
// Current pattern (cloud-only):
const { data } = await supabase.from('messages')
  .select('*').eq('user_id', uid);

// New pattern (local-first, cloud as backup):
const localMessages = await db.messages
  .where({ userId: uid })
  .toArray();

if (localMessages.length > 0) {
  return localMessages; // Instant. Zero network.
}

// Fallback to cloud on first load (migration seed):
const { data } = await supabase.from('messages')
  .select('*').eq('user_id', uid);
if (data) {
  await db.messages.bulkAdd(data.map(mapToLocal));
  return data;
}
```

### Phase 2: Write Local First

```typescript
// Current pattern (cloud-only):
await supabase.from('messages').insert({ ... });

// New pattern (local-first):
await db.messages.add(localMessage); // Instant

// Fire-and-forget background sync:
if (navigator.onLine) {
  syncQueue.push({ table: 'messages', action: 'insert', data });
}
```

### Phase 3: Background Sync

```typescript
class SyncService {
  private queue: SyncOperation[] = [];
  private processing = false;

  push(op: SyncOperation) {
    this.queue.push(op);
    this.flush();
  }

  private async flush() {
    if (this.processing || !navigator.onLine) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const op = this.queue.shift()!;
      try {
        await this.executeOp(op);
      } catch (e) {
        // Retry later
        this.queue.unshift(op);
        break;
      }
    }
    this.processing = false;
  }
}
```

### Phase 4: Offline-First Complete

At this point, the app works entirely offline. The cloud is just a backup/sync target. New users get instant load times from day one.

---

## Implementation Recommendations

### 1. Messages

**Current**: `supabase.from('messages').select('*')` on init, real-time subscription, `supabase.from('messages').insert()` per message.

**Recommended**:

```typescript
const DB_NAME = 'BeatriceDB';
const DB_VERSION = 1;

// Schema
db.version(1).stores({
  messages: '++localId, userId, sessionId, role, createdAt, syncedAt',
  settings: 'userId',
  sessions: '++id, userId, lastActive',
  syncQueue: '++id, table, action, createdAt',
});

// Read
async function getMessages(userId: string, sessionId?: string) {
  let query = db.messages.where({ userId });
  if (sessionId) query = query.filter(m => m.sessionId === sessionId);
  return query.sortBy('createdAt');
}

// Write
async function addMessage(msg: ChatMessage, userId: string) {
  const local = {
    ...msg,
    userId,
    localId: undefined, // auto-increment
    syncedAt: null,
  };
  const localId = await db.messages.add(local);

  // Background sync
  syncQueue.push({
    table: 'messages',
    action: 'insert',
    data: { ...msg, user_id: userId },
    localId,
  });

  return localId;
}
```

**Key design decisions:**
- Use `localId` as auto-increment primary key (not the Supabase UUID) — this avoids blocking on a server-generated ID
- Store `syncedAt` timestamp to track what has been pushed to the cloud
- Index by `userId` + `sessionId` for the two most common query patterns

### 2. User Settings

**Current**: `supabase.from('user_settings').select('*').eq('user_id', uid)` on init, `supabase.from('user_settings').upsert()` on change.

**Recommended**: Store in IndexedDB directly, sync on change. Settings are small and change infrequently — make them instantly available locally.

```typescript
async function getSettings(userId: string): Promise<UserSettings> {
  const local = await db.settings.get(userId);
  if (local) return local;

  // First load: try cloud
  const { data } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (data) {
    const mapped = mapSettings(data);
    await db.settings.put({ ...mapped, userId });
    return mapped;
  }

  // Absolute first time: return defaults
  return DEFAULT_SETTINGS;
}

async function saveSettings(userId: string, settings: Partial<UserSettings>) {
  await db.settings.put({ ...settings, userId }); // Instant

  // Background sync
  syncQueue.push({ table: 'settings', action: 'upsert', data: { user_id: userId, ...settings } });
}
```

### 3. Knowledge Files

**Current**: Uploaded to Supabase Storage, metadata in `knowledge_files` table, content fetched via `download()`.

**Recommended**: Store file contents in OPFS, metadata in IndexedDB.

```typescript
async function saveKnowledgeFile(
  userId: string,
  file: File,
  db: BeatriceDatabase,
  opfsRoot: FileSystemDirectoryHandle
) {
  // 1. Store binary content in OPFS
  const fileId = crypto.randomUUID();
  const knowledgeDir = await opfsRoot.getDirectoryHandle('knowledge', { create: true });
  const fileHandle = await knowledgeDir.getFileHandle(fileId, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(await file.arrayBuffer());
  await writable.close();

  // 2. Store metadata in IndexedDB
  const localId = await db.knowledgeFiles.add({
    id: fileId,
    userId,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
    opfsPath: `knowledge/${fileId}`,
  });

  // 3. Background sync to Supabase
  syncQueue.push({
    table: 'knowledge_files',
    action: 'insert',
    data: { user_id: userId, file_name: file.name, /* ... */ },
  });

  return localId;
}
```

### 4. Google OAuth Tokens

**Current**: Stored in `localStorage` (`beatrice_google_token`, `beatrice_google_refresh_token`, etc.). Fragile, lost on browser clear, synchronous access.

**Recommended**: Move to IndexedDB.

```typescript
// Add a tokens table
db.version(2).stores({
  // ... existing stores
  tokens: 'userId, service',
});

// Store tokens
await db.tokens.put({
  userId: auth.currentUser!.uid,
  service: 'google',
  accessToken: token,
  refreshToken: refreshToken,
  expiresAt: expiryDate.getTime(),
  updatedAt: Date.now(),
});

// Retrieve tokens (zero network, instant)
const token = await db.tokens.get([userId, 'google']);
```

### 5. Request Persistent Storage

The browser may evict IndexedDB data under storage pressure. Requesting persistent storage prevents this:

```typescript
async function ensurePersistentStorage() {
  if (!navigator.storage?.persist) return false;

  const isPersisted = await navigator.storage.persisted();
  if (isPersisted) return true;

  // Request persistence (user may be prompted)
  return await navigator.storage.persist();
}
```

Call this once on app init (after Firebase auth resolves). Even if the request fails, IndexedDB still works — it just may be evicted if the browser needs space.

---

## Sync Strategy: Detailed Design

### What to Sync
| Data | Direction | Frequency | Priority |
|---|---|---|---|
| Messages | Local → Cloud | On each write (fire-and-forget) | High |
| User Settings | Local → Cloud | On each change | Medium |
| Knowledge Files | Local → Cloud | On upload | Medium |
| Session metadata | Local → Cloud | On session end | Low |

### How to Handle Conflicts
Use **Last-Writer-Wins (LWW)** with server timestamps:

```typescript
async function syncMessages(userId: string, db: BeatriceDatabase) {
  // Push local unsynced messages
  const unsynced = await db.messages
    .where({ userId })
    .filter(m => !m.syncedAt)
    .toArray();

  for (const msg of unsynced) {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        role: msg.role,
        text: msg.text,
        session_id: msg.sessionId,
        created_at: msg.createdAt,
      })
      .select('id')
      .single();

    if (!error && data) {
      await db.messages.update(msg.localId, {
        syncedAt: Date.now(),
        remoteId: data.id,
      });
    }
  }

  // Pull remote messages newer than last sync
  const lastSync = await db.syncMeta.get(userId);
  const { data: remoteMessages } = await supabase
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .gt('created_at', lastSync?.lastPullAt || 0)
    .order('created_at');

  if (remoteMessages?.length) {
    const existing = await db.messages
      .where({ userId })
      .toArray();

    for (const remote of remoteMessages) {
      const exists = existing.some(e => e.createdAt === remote.created_at && e.text === remote.text);
      if (!exists) {
        await db.messages.add({
          userId,
          role: remote.role,
          text: remote.text,
          sessionId: remote.session_id,
          createdAt: remote.created_at,
          syncedAt: Date.now(),
          remoteId: remote.id,
        });
      }
    }
  }

  // Update last pull timestamp
  await db.syncMeta.put({ userId, lastPullAt: Date.now() });
}
```

### Real-time Subscriptions Alternative (Optional)

Instead of polling/pushing, you can keep the Supabase Realtime subscription for cross-device sync:

```typescript
// On app start (after loading local data):
const channel = supabase
  .channel('messages_sync')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `user_id=eq.${uid}`
  }, async (payload) => {
    // Check if we already have this locally
    const exists = await db.messages
      .where({ remoteId: payload.new.id })
      .first();

    if (!exists) {
      await db.messages.add({
        userId: uid,
        role: payload.new.role,
        text: payload.new.text,
        // ... full mapping
        syncedAt: Date.now(),
        remoteId: payload.new.id,
      });
    }
  })
  .subscribe();
```

This gives **multi-device sync** for free — when the user chats on their phone, the desktop gets the new messages via Supabase Realtime, which writes them into the local IndexedDB.

---

## Migration Path

### Phase 0 — No changes (current state)
All data lives in Supabase. App requires network for every operation.

### Phase 1 — Dexie.js setup + local read cache
- Install `dexie` package
- Create `src/lib/localDb.ts` with schema
- Wrap all Supabase SELECT calls to check IndexedDB first
- On first load, seed IndexedDB from Supabase

**Risk**: Low. Additive change. All existing code paths still work.

**Estimated effort**: 1–2 days

### Phase 2 — Local writes + background sync
- Wrap all Supabase INSERT/UPSERT calls to write to IndexedDB first
- Add sync queue table + background sync service
- Show optimistic UI instantly

**Risk**: Medium. Need to handle sync failures gracefully.

**Estimated effort**: 2–3 days

### Phase 3 — OPFS for knowledge files
- Migrate knowledge file storage from Supabase Storage to OPFS
- Keep IndexedDB metadata pointing to OPFS paths
- Background sync file contents to Supabase Storage

**Risk**: Medium. OPFS API is newer, browser support is good but not universal (Chrome 86+, Firefox 111+, Edge 86+).

**Estimated effort**: 1–2 days

### Phase 4 — Google tokens to IndexedDB
- Move token storage from `localStorage` to IndexedDB `tokens` table
- Update all Google API calls to read from IndexedDB

**Risk**: Low. Straightforward migration.

**Estimated effort**: 0.5 days

### Phase 5 — Persistent storage request
- Add `navigator.storage.persist()` call on app init
- Show storage usage in settings UI
- Optional: add "Clear local data" button in settings

**Risk**: Very low. Two lines of code.

**Estimated effort**: 0.5 days

---

## New Dependencies

### Required
- **`dexie`** — IndexedDB wrapper (~15KB gzipped)

```bash
npm install dexie
npm install --save-dev @types/dexie  # if needed
```

### Optional but Recommended
- **`idb`** — Lightweight IndexedDB wrapper (alternative to Dexie, smaller at ~2KB)

---

## File Structure for Local Storage Layer

```
src/
├── lib/
│   ├── localDb.ts          # Dexie schema + database instance
│   ├── syncService.ts      # Background sync queue + execution
│   ├── opfsStorage.ts      # OPFS wrappers (read/write/delete files)
│   └── persistentStorage.ts # navigator.storage.persist() helper
```

### `src/lib/localDb.ts` — Full Schema

```typescript
import Dexie, { type EntityTable } from 'dexie';

export interface LocalMessage {
  localId?: number;        // auto-increment PK
  userId: string;          // Firebase UID
  remoteId?: string;       // Supabase row ID (set after sync)
  role: 'user' | 'model';
  text: string;
  sessionId?: string;
  createdAt: string;
  attachmentUrl?: string;
  attachmentName?: string;
  syncedAt: number | null;  // null = not yet synced
}

export interface LocalSettings {
  userId: string;
  personaName?: string;
  customPrompt?: string;
  selectedVoice?: string;
  contextSize?: number;
  userTitle?: string;
  language?: string;
  permissions: Record<string, boolean>;
  syncedAt: number | null;
}

export interface LocalKnowledgeFile {
  localId?: number;
  id: string;               // UUID
  userId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  opfsPath: string;         // e.g. "knowledge/<uuid>"
  syncedAt: number | null;
}

export interface SyncOperation {
  id?: number;
  table: string;
  action: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  localRef?: string | number;
  createdAt: number;
  retries: number;
}

export interface SyncMeta {
  userId: string;
  lastPullAt: number;
}

const db = new Dexie('BeatriceDB') as Dexie & {
  messages: EntityTable<LocalMessage, 'localId'>;
  settings: EntityTable<LocalSettings, 'userId'>;
  knowledgeFiles: EntityTable<LocalKnowledgeFile, 'localId'>;
  syncQueue: EntityTable<SyncOperation, 'id'>;
  syncMeta: EntityTable<SyncMeta, 'userId'>;
};

db.version(1).stores({
  messages: '++localId, userId, sessionId, role, createdAt, syncedAt',
  settings: 'userId',
  knowledgeFiles: '++localId, userId, fileName, syncedAt',
  syncQueue: '++id, table, createdAt',
  syncMeta: 'userId',
});

export default db;
```

---

## Trade-offs & Risks

### Pros
| Benefit | Detail |
|---|---|
| **Instant load** | Messages render from IndexedDB — zero network wait |
| **Full offline support** | App works without internet after first load |
| **Reduced Supabase costs** | Fewer database reads = lower bills |
| **Better UX** | No loading spinners for data that's already local |
| **Privacy** | Sensitive data stays on-device, user controls what syncs |
| **Cross-tab sync** | IndexedDB events fire across tabs automatically |
| **Auditable** | Sync queue provides a clear record of what was/wasn't synced |

### Cons & Mitigations

| Risk | Mitigation |
|---|---|
| **Browser may evict IndexedDB** | Request `navigator.storage.persist()` on init |
| **Data loss if user clears browser data** | Cloud backup always available. Sync ensures nothing lost. |
| **Conflict between local & remote edits** | LWW with server timestamps. Rare in single-user app. |
| **Larger local storage footprint** | Set message cap (e.g., keep last 10,000 messages locally) |
| **Multi-device staleness** | Keep Supabase Realtime subscription active for cross-device sync |
| **Dexie.js bundle size (~15KB gzipped)** | Acceptable for the capability gained |
| **OPFS browser support gaps** | Graceful fallback to IndexedDB blob storage for unsupported browsers |

### Browser Support for OPFS
| Browser | Support |
|---|---|
| Chrome 86+ | ✅ Full |
| Edge 86+ | ✅ Full |
| Firefox 111+ | ✅ Full |
| Safari 15.2+ | ⚠️ Partial (no `createWritable` in all versions) |

For Safari fallback, store file blobs directly in IndexedDB instead of OPFS.

---

## Summary

**Recommended approach: IndexedDB (via Dexie.js) as the primary data store, OPFS for binary files, with background sync to Supabase as the cloud fallback.**

This gives Beatrice:
- **Instant load** — no network wait for messages, settings, or history
- **Full offline resilience** — the app is usable without any internet
- **Firebase Auth identity** — unchanged, still the gatekeeper for who the user is
- **Gradual migration** — each phase is safe, additive, and independently deployable
- **Multi-device support** — Supabase Realtime pushes cross-device changes into local IndexedDB

### Quick Start

```bash
npm install dexie

# Create the local storage layer:
touch src/lib/localDb.ts
touch src/lib/syncService.ts
touch src/lib/opfsStorage.ts
touch src/lib/persistentStorage.ts
```

Then implement Phase 1: wrap the existing Supabase reads in BeatriceAgent.tsx to check IndexedDB first. This is the highest-ROI change — it makes message loading instant while touching the fewest lines of existing code.
