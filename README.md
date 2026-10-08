# Harness

A private, multi-model AI workspace (BYOK - Bring Your Own Key) with grounded knowledge retrieval (RAG), smart email drafting with optional Gmail IMAP inbox, and real-time web search.

## What it is

Harness lets you chat with any AI model using your own API keys. Supported providers:
- **OpenAI** (GPT-4o, GPT-4o Mini, o1, o3, etc.)
- **Anthropic** (Claude 3.7 Sonnet, Claude 3.5 Sonnet, Haiku, etc.)
- **Google Gemini** (Gemini 2.5 Flash, 2.0 Flash, 1.5 Pro, etc.)
- **xAI** (Grok 2, Grok 2 Vision, etc.)
- **Tavily** (Optional 1,000 free searches/month for live web citations)

### Key Features
1. **Multi-Model Chat**: Switch models mid-conversation while keeping full context. Real-time token usage and custom cost breakdown.
2. **Knowledge Base (RAG)**: Upload PDF, DOCX, TXT, MD, or CSV files. Uses zero-dependency client-side BM25 search for precise citations with document snippets and page numbers.
3. **Smart Email Assistant**:
   - **Paste email**: Drop `.eml` or paste email text with anti-prompt-injection safeguards. Select tone (Concise, Friendly, Formal) and refine with Shorter/Longer.
   - **Gmail via App Password**: Direct IMAP connection to browse inbox and save drafts directly into Gmail. **Never sends email automatically.**
4. **Free Web Search**: Ground responses in real-time web search results via Tavily or Gemini Google Search. Free monthly quota tracking included.
5. **Security & Privacy**: Optional WebCrypto AES-GCM passphrase encryption for all stored keys.

## Privacy Statement

- **API Keys**: Stored exclusively in your browser's `localStorage`. If passphrase encryption is enabled, keys are encrypted using WebCrypto AES-GCM with PBKDF2 derivation. The passphrase is never stored on disk.
- **Conversations & Documents**: Stored in your browser's `IndexedDB` on your device.
- **Network Calls**: Browser connects directly to provider endpoints whenever possible. If the browser blocks direct calls (CORS), requests pass through the lightweight fallback proxy `/api/proxy` to reach upstream providers. The server **never logs or stores** headers, bodies, or API keys.
- **No Accounts, No Tracking**: No database, no tracking pixels, no telemetry.

## Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment to Render

You can deploy Harness to Render in 2 minutes:

1. In Render Dashboard, click **New** → **Web Service**.
2. Connect your GitHub repository.
3. Configure the service:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
   - **Environment Variables**: None required (port is automatically set by Render).
4. Click **Deploy**.

> **Notes on Render Free Tier**:
> - Free instances sleep after periods of inactivity. The first request after a sleep period may take ~30–60 seconds to wake up.
> - Gmail inbox browsing and draft saving uses a Google App Password over IMAP and works seamlessly on the deployed server (no Google Cloud Project or OAuth setup required).
