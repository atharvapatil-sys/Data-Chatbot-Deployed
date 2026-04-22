// ============================================================
// Shared TypeScript types for InsightStream
// ============================================================

/** A single chat message in the conversation */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Generated BigQuery SQL (assistant only) */
  sql?: string;
  /** Human-readable explanation of the SQL logic */
  explanation?: string;
  /** Rows returned by BigQuery */
  data?: Record<string, unknown>[];
  /** Visualization config suggested by the synthesizer */
  chartConfig?: ChartConfig;
  /** True while the AI is still streaming */
  loading?: boolean;
  /** True when SQL is pending user approval (review mode) */
  needsReview?: boolean;
  /** ID of the user message that triggered this assistant response */
  parentMessageId?: string;
}

/** Accumulated token usage for a session */
export interface TokenUsage {
  prompt: number;
  response: number;
  total: number;
}

/** A named chat session with its message history */
export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  tokens: TokenUsage;
  createdAt: number;
  updatedAt: number;
}

export type ChartType = 'bar' | 'line' | 'pie' | 'table';

/** Chart configuration produced by the synthesizer */
export interface ChartConfig {
  type: ChartType;
  xAxis?: string;
  yAxis?: string;
  title?: string;
}

/** Result from the synthesis step */
export interface SynthesisResult {
  text: string;
  chartConfig: ChartConfig;
}

/** A single column in a schema table */
export interface SchemaColumn {
  name: string;
  type: string;
  description?: string;
}

/** A BigQuery table as shown in the Sidebar */
export interface SchemaTable {
  /** Raw table name as it appears in BigQuery */
  name: string;
  /** Human-readable label for the UI */
  displayName: string;
  /** Tailwind color class for the indicator dot */
  color: string;
  /** Ring color class for the indicator dot halo */
  ringColor: string;
  columns: SchemaColumn[];
}

/** Streaming chunk emitted by the server-side Gemini SSE endpoint */
export interface GeminiChunk {
  type: 'text' | 'functionCall' | 'usage' | 'error';
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: string;
}
