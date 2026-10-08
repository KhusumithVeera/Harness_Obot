import * as pdfjsLib from 'pdfjs-dist';
// Configure worker for Vite
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import { DocumentChunk, DocumentMeta } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'don', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'it', 'its', 'itself', 'just', 'me', 'more',
  'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 's', 'same', 'she', 'should', 'so', 'some', 'such',
  't', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your'
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length > 1 && !STOP_WORDS.has(tok));
}

export interface ParsedPage {
  pageNumber?: number;
  text: string;
}

export async function parseFileToPages(
  file: File,
  onProgress?: (progressText: string) => void
): Promise<{ pages: ParsedPage[]; totalChars: number }> {
  if (file.size === 0) {
    throw new Error('This file is empty.');
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error('File exceeds the 20 MB limit.');
  }

  const name = file.name.toLowerCase();
  const ext = name.substring(name.lastIndexOf('.'));

  if (ext === '.pdf') {
    onProgress?.('Reading PDF…');
    const arrayBuffer = await file.arrayBuffer();
    let pdfDoc: pdfjsLib.PDFDocumentProxy;

    try {
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      pdfDoc = await loadingTask.promise;
    } catch (err: any) {
      if (err?.name === 'PasswordException' || String(err?.message || '').toLowerCase().includes('password')) {
        throw new Error('This PDF is password protected.');
      }
      throw new Error(`Failed to open PDF: ${err.message || 'corrupt file'}`);
    }

    const numPages = pdfDoc.numPages;
    const pages: ParsedPage[] = [];
    let totalChars = 0;

    for (let i = 1; i <= numPages; i++) {
      onProgress?.(`Processing… page ${i}/${numPages}`);
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || '')
        .join(' ')
        .trim();

      if (pageText) {
        pages.push({ pageNumber: i, text: pageText });
        totalChars += pageText.length;
      }
    }

    if (totalChars < 50) {
      throw new Error('No readable text found. This looks like a scanned PDF (OCR isn\'t supported).');
    }

    return { pages, totalChars };
  }

  if (ext === '.docx') {
    onProgress?.('Extracting DOCX text…');
    const arrayBuffer = await file.arrayBuffer();
    try {
      const result = await mammoth.extractRawText({ arrayBuffer });
      const rawText = result.value.trim();
      if (!rawText) {
        throw new Error('This file is empty.');
      }
      return { pages: [{ text: rawText }], totalChars: rawText.length };
    } catch (err: any) {
      throw new Error(`Failed to extract DOCX: ${err.message || 'invalid file'}`);
    }
  }

  if (['.txt', '.md', '.csv'].includes(ext)) {
    onProgress?.('Reading text file…');
    const rawText = (await file.text()).trim();
    if (!rawText) {
      throw new Error('This file is empty.');
    }
    return { pages: [{ text: rawText }], totalChars: rawText.length };
  }

  throw new Error('Unsupported file type. Use PDF, DOCX, TXT, MD or CSV.');
}

export function chunkTextPages(
  docId: string,
  pages: ParsedPage[],
  chunkSize: number = 1000,
  overlap: number = 150
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const p of pages) {
    const text = p.text;
    if (text.length <= chunkSize) {
      chunks.push({
        id: `${docId}_c${chunkIndex++}`,
        docId,
        chunkIndex,
        page: p.pageNumber,
        text,
      });
      continue;
    }

    let start = 0;
    while (start < text.length) {
      let end = start + chunkSize;
      if (end >= text.length) {
        end = text.length;
      } else {
        // Try breaking at a paragraph or sentence boundary
        const sub = text.substring(start, end);
        const lastPara = sub.lastIndexOf('\n\n');
        const lastPeriod = Math.max(sub.lastIndexOf('. '), sub.lastIndexOf('? '), sub.lastIndexOf('! '));

        if (lastPara > chunkSize * 0.6) {
          end = start + lastPara + 2;
        } else if (lastPeriod > chunkSize * 0.6) {
          end = start + lastPeriod + 2;
        }
      }

      const chunkSlice = text.substring(start, end).trim();
      if (chunkSlice) {
        chunks.push({
          id: `${docId}_c${chunkIndex++}`,
          docId,
          chunkIndex,
          page: p.pageNumber,
          text: chunkSlice,
        });
      }

      if (end >= text.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}

// -------------------------------------------------------------
// BM25 Retrieval Engine
// -------------------------------------------------------------
export interface BM25ScoreResult {
  chunk: DocumentChunk;
  score: number;
}

export class BM25Index {
  private chunks: DocumentChunk[];
  private docLengths: number[];
  private avgDocLength: number;
  private docTokens: string[][];
  private docFreqs: Map<string, number>;
  private k1: number;
  private b: number;

  constructor(chunks: DocumentChunk[], k1: number = 1.5, b: number = 0.75) {
    this.chunks = chunks;
    this.k1 = k1;
    this.b = b;
    this.docTokens = [];
    this.docLengths = [];
    this.docFreqs = new Map();

    let totalLength = 0;
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text);
      this.docTokens.push(tokens);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      const seen = new Set(tokens);
      for (const tok of seen) {
        this.docFreqs.set(tok, (this.docFreqs.get(tok) || 0) + 1);
      }
    }

    this.avgDocLength = chunks.length > 0 ? totalLength / chunks.length : 1;
  }

  public search(query: string, topK: number = 6): BM25ScoreResult[] {
    const queryTokens = tokenize(query);
    if (this.chunks.length === 0) return [];
    if (queryTokens.length === 0) {
      return this.chunks.slice(0, topK).map((chunk) => ({ chunk, score: 0 }));
    }

    const N = this.chunks.length;
    const scores: { chunk: DocumentChunk; score: number }[] = [];

    for (let i = 0; i < N; i++) {
      const docTokens = this.docTokens[i];
      const docLen = this.docLengths[i];
      let score = 0;

      // Token count in doc
      const termFreqs = new Map<string, number>();
      for (const t of docTokens) {
        termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
      }

      for (const qTerm of queryTokens) {
        const tf = termFreqs.get(qTerm) || 0;
        if (tf === 0) continue;

        const df = this.docFreqs.get(qTerm) || 0;
        // Standard BM25 IDF: ln((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const num = tf * (this.k1 + 1);
        const denom = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
        score += idf * (num / denom);
      }

      scores.push({ chunk: this.chunks[i], score });
    }

    scores.sort((a, b) => b.score - a.score);

    // If best score is 0, fall back to first topK chunks
    if (scores[0]?.score === 0) {
      return this.chunks.slice(0, topK).map((chunk) => ({ chunk, score: 0 }));
    }

    return scores.slice(0, topK);
  }
}

export function buildRetrievalQuery(currentMessage: string, previousUserMessage?: string): string {
  if (!previousUserMessage) return currentMessage;
  const words = currentMessage.trim().split(/\s+/);
  // If short, ambiguous or starts with pronoun, prepend previous user message
  const startsWithPronoun = /^(it|this|that|these|those|what about|how about|and|why|who|which)\b/i.test(
    currentMessage.trim()
  );
  if (words.length <= 6 || startsWithPronoun) {
    return `${previousUserMessage} ${currentMessage}`;
  }
  return currentMessage;
}
