import { get, set, del, clear } from 'idb-keyval';
import { AppSettings, Conversation, DocumentChunk, DocumentMeta, ProviderKeyConfig } from '../types';
import { decryptWithPassphrase, EncryptedPayload, encryptWithPassphrase } from './crypto';

const PREFIX = 'harness:';
const SETTINGS_KEY = `${PREFIX}settings`;
const ENCRYPTED_KEYS_KEY = `${PREFIX}encrypted_keys`;
const RAW_KEYS_KEY = `${PREFIX}keys`;
const GMAIL_KEY = `${PREFIX}gmail`;
const SCHEMA_VERSION_KEY = `${PREFIX}schema_version`;
const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  keys: {},
  encryptKeys: false,
  theme: 'system',
  defaultModelId: '',
  alwaysWebSearch: false,
  useGeminiSearch: false,
  modelPrices: {
    'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    'claude-3-5-sonnet-20241022': { inputPerMillion: 3, outputPerMillion: 15 },
    'claude-3-5-haiku-20241022': { inputPerMillion: 0.8, outputPerMillion: 4 },
    'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
    'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
    'gemini-2.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
    'grok-2-1212': { inputPerMillion: 2, outputPerMillion: 10 },
  },
};

// In-memory fallback if IndexedDB or localStorage is unavailable
let inMemoryConversations: Conversation[] = [];
let inMemoryDocs: DocumentMeta[] = [];
let inMemoryChunks: Record<string, DocumentChunk[]> = {};
let storageUnavailableMessage: string | null = null;

export function getStorageBanner(): string | null {
  return storageUnavailableMessage;
}

export function cleanApiKey(val?: string): string {
  if (!val) return '';
  let cleaned = val.trim();
  // Strip Bearer prefix
  if (cleaned.toLowerCase().startsWith('bearer ')) {
    cleaned = cleaned.substring(7).trim();
  }
  // Strip outer quotes
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  return cleaned;
}

// Memory-only passphrase
let activePassphrase: string | null = null;

export function getActivePassphrase(): string | null {
  return activePassphrase;
}

export function setActivePassphrase(pass: string | null) {
  activePassphrase = pass;
}

export function hasEncryptedKeys(): boolean {
  try {
    return !!localStorage.getItem(ENCRYPTED_KEYS_KEY);
  } catch {
    return false;
  }
}

export async function unlockKeys(passphrase: string): Promise<ProviderKeyConfig> {
  const rawPayload = localStorage.getItem(ENCRYPTED_KEYS_KEY);
  if (!rawPayload) return {};
  const payload: EncryptedPayload = JSON.parse(rawPayload);
  const decryptedJson = await decryptWithPassphrase(payload, passphrase);
  activePassphrase = passphrase;
  return JSON.parse(decryptedJson);
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...parsed };

    if (hasEncryptedKeys()) {
      settings.encryptKeys = true;
      settings.keys = {};
    } else {
      const keysRaw = localStorage.getItem(RAW_KEYS_KEY);
      if (keysRaw) {
        settings.keys = JSON.parse(keysRaw);
      }
    }

    return settings;
  } catch (err) {
    console.warn('Failed to load settings from localStorage, using defaults:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    const { keys, ...restSettings } = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(restSettings));

    if (settings.encryptKeys) {
      if (activePassphrase) {
        const payload = await encryptWithPassphrase(JSON.stringify(keys), activePassphrase);
        localStorage.setItem(ENCRYPTED_KEYS_KEY, JSON.stringify(payload));
        localStorage.removeItem(RAW_KEYS_KEY);
      }
    } else {
      localStorage.setItem(RAW_KEYS_KEY, JSON.stringify(keys));
      localStorage.removeItem(ENCRYPTED_KEYS_KEY);
    }
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError') {
      storageUnavailableMessage = 'Storage full. Export and delete old chats.';
    } else {
      storageUnavailableMessage = "Storage unavailable: chats won't be saved after you close this tab";
    }
  }
}

export function resetKeys(): void {
  try {
    localStorage.removeItem(RAW_KEYS_KEY);
    localStorage.removeItem(ENCRYPTED_KEYS_KEY);
    activePassphrase = null;
  } catch (err) {
    console.error('Reset keys error:', err);
  }
}

// Conversations (IndexedDB)
export async function loadConversations(): Promise<Conversation[]> {
  try {
    const stored = await get<any>('conversations');
    if (!stored) return inMemoryConversations;
    if (!Array.isArray(stored)) {
      console.warn('Malformed conversations array in storage, skipping bad records.');
      return [];
    }
    // Filter and sanitize records
    const valid: Conversation[] = [];
    for (const item of stored) {
      if (item && typeof item === 'object' && item.id && item.messages) {
        valid.push(item as Conversation);
      }
    }
    inMemoryConversations = valid;
    return valid;
  } catch (err: any) {
    console.warn('IndexedDB unavailable for conversations, falling back to in-memory:', err);
    storageUnavailableMessage = "Storage unavailable: chats won't be saved after you close this tab";
    return inMemoryConversations;
  }
}

export async function saveConversations(convs: Conversation[]): Promise<void> {
  inMemoryConversations = convs;
  try {
    await set('conversations', convs);
  } catch (err: any) {
    console.warn('Failed to persist conversations to IndexedDB:', err);
    if (err?.name === 'QuotaExceededError') {
      storageUnavailableMessage = 'Storage full. Export and delete old chats.';
    } else {
      storageUnavailableMessage = "Storage unavailable: chats won't be saved after you close this tab";
    }
  }
}

// Documents & Chunks (IndexedDB)
export async function loadDocuments(): Promise<DocumentMeta[]> {
  try {
    const docs = await get<DocumentMeta[]>('documents');
    if (Array.isArray(docs)) {
      inMemoryDocs = docs;
      return docs;
    }
    return inMemoryDocs;
  } catch (err) {
    console.warn('IndexedDB loadDocuments failed:', err);
    return inMemoryDocs;
  }
}

export async function saveDocuments(docs: DocumentMeta[]): Promise<void> {
  inMemoryDocs = docs;
  try {
    await set('documents', docs);
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError') {
      storageUnavailableMessage = 'Storage full. Export and delete old chats.';
    }
  }
}

export async function loadChunksForDocs(docIds: string[]): Promise<DocumentChunk[]> {
  const allChunks: DocumentChunk[] = [];
  try {
    for (const docId of docIds) {
      const chunks = await get<DocumentChunk[]>(`chunks:${docId}`);
      if (Array.isArray(chunks)) {
        allChunks.push(...chunks);
      } else if (inMemoryChunks[docId]) {
        allChunks.push(...inMemoryChunks[docId]);
      }
    }
  } catch (err) {
    for (const docId of docIds) {
      if (inMemoryChunks[docId]) {
        allChunks.push(...inMemoryChunks[docId]);
      }
    }
  }
  return allChunks;
}

export async function saveChunksForDoc(docId: string, chunks: DocumentChunk[]): Promise<void> {
  inMemoryChunks[docId] = chunks;
  try {
    await set(`chunks:${docId}`, chunks);
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError') {
      storageUnavailableMessage = 'Storage full. Export and delete old chats.';
    }
  }
}

export async function deleteChunksForDoc(docId: string): Promise<void> {
  delete inMemoryChunks[docId];
  try {
    await del(`chunks:${docId}`);
  } catch (err) {
    console.warn('Error deleting chunks:', err);
  }
}

// Delete all local data
export async function deleteAllLocalData(): Promise<void> {
  try {
    localStorage.clear();
    await clear();
    inMemoryConversations = [];
    inMemoryDocs = [];
    inMemoryChunks = {};
    activePassphrase = null;
    storageUnavailableMessage = null;
  } catch (err) {
    console.error('Delete all local data error:', err);
  }
}

// Export / Import
export function exportDataAsJson(conversations: Conversation[], docs: DocumentMeta[]): string {
  const data = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    conversations,
    documents: docs,
  };
  return JSON.stringify(data, null, 2);
}

export function validateAndParseImport(jsonString: string): { conversations: Conversation[]; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { conversations: [], error: 'Invalid JSON format.' };
    }
    if (!Array.isArray(parsed.conversations)) {
      return { conversations: [], error: 'Missing or invalid "conversations" array.' };
    }

    const validConversations: Conversation[] = [];
    for (const c of parsed.conversations) {
      if (c && typeof c === 'object' && c.id && Array.isArray(c.messages)) {
        validConversations.push({
          id: String(c.id),
          title: String(c.title || 'Untitled chat'),
          createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
          updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
          messages: c.messages,
          knowledgeIds: Array.isArray(c.knowledgeIds) ? c.knowledgeIds : [],
          knowledgeMode: c.knowledgeMode === 'full' ? 'full' : 'retrieval',
          webSearch: !!c.webSearch,
        });
      }
    }

    if (validConversations.length === 0 && parsed.conversations.length > 0) {
      return { conversations: [], error: 'Could not find any valid conversation records in the file.' };
    }

    return { conversations: validConversations };
  } catch (err: any) {
    return { conversations: [], error: `Failed to parse file: ${err.message || 'invalid JSON'}` };
  }
}
