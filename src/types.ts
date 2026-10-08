export type ProviderId = 'openai' | 'anthropic' | 'google' | 'xai';

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
  supportsImages?: boolean;
}

export interface ProviderKeyConfig {
  openai?: string;
  anthropic?: string;
  google?: string;
  xai?: string;
  tavily?: string;
  [key: string]: string | undefined;
}

export interface GmailConfig {
  email: string;
  appPassword?: string; // stored in memory or encrypted localStorage if remember=true
  remember: boolean;
}

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface AppSettings {
  keys: ProviderKeyConfig;
  encryptKeys: boolean;
  theme: 'light' | 'dark' | 'system';
  defaultModelId: string;
  alwaysWebSearch: boolean;
  useGeminiSearch: boolean;
  modelPrices: Record<string, ModelPrice>;
}

export interface SourceCitation {
  type: 'doc' | 'web' | 'email';
  title: string;
  url?: string;
  docId?: string;
  page?: number;
  snippet: string;
}

export interface MessageImage {
  mime: string;
  base64: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: MessageImage[];
  modelId?: string;
  provider?: ProviderId;
  sources?: SourceCitation[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  status?: 'complete' | 'stopped' | 'error';
  errorMessage?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  knowledgeIds: string[];
  knowledgeMode?: 'retrieval' | 'full';
  webSearch: boolean;
  gmailSearch?: boolean;
}

export interface DocumentChunk {
  id: string;
  docId: string;
  chunkIndex: number;
  page?: number;
  text: string;
}

export interface DocumentMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  pages?: number;
  charCount: number;
  chunkCount: number;
  createdAt: number;
  status: 'ready' | 'processing' | 'failed';
  error?: string;
}

export interface EmailDraftRequest {
  from?: string;
  to?: string;
  subject?: string;
  originalEmail: string;
  instructions?: string;
  tone: 'concise' | 'friendly' | 'formal';
  modelId: string;
}

export interface GmailMessageSummary {
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
}

export interface GmailMessageDetail {
  from: string;
  replyTo?: string;
  subject: string;
  date: string;
  messageId?: string;
  references?: string;
  text: string;
}
