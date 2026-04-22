import React, { useCallback } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Code2,
  BarChart3,
  Download,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AnalyticsChart } from './AnalyticsChart';
import type { Message } from '../types';

// ── Sub-components ────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex items-center gap-2 py-2" aria-label="Loading response" role="status">
      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.3s]" />
      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" />
      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-600" />
      <span className="sr-only">AI is thinking…</span>
    </div>
  );
}

function ErrorCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-orange-50/50 border border-orange-200 p-4 flex items-start gap-3 shadow-sm animate-in fade-in zoom-in duration-300">
      <div className="rounded-full bg-orange-100 p-1.5 flex-shrink-0">
        <AlertCircle className="h-4 w-4 text-orange-600" aria-hidden="true" />
      </div>
      <div>
        <p className="text-[11px] font-mono font-black text-orange-800 uppercase tracking-widest mb-1">
          Response Clarification
        </p>
        <p className="text-[14px] text-orange-900/80 leading-relaxed font-medium">{text}</p>
      </div>
    </div>
  );
}

function MessageText({ content }: { content: string }) {
  // Handle embedded JSON errors from the AI
  if (content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content) as { error?: string };
      if (parsed.error) return <ErrorCard text={parsed.error} />;
    } catch { /* not JSON */ }
  }
  const errorMatch = content.match(/\{"error":\s*"([^"]+)"\}/);
  if (errorMatch) return <ErrorCard text={errorMatch[1]} />;

  return <p className="leading-relaxed text-[15px]">{content}</p>;
}

// ── CSV download helper ───────────────────────────────────────

function downloadCSV(data: Record<string, unknown>[], filename = 'insightstream-data.csv') {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const escape = (v: unknown) =>
    typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))
      ? `"${v.replace(/"/g, '""')}"`
      : String(v ?? '');

  const csv = [headers.join(','), ...data.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Main MessageBubble component ──────────────────────────────

interface MessageBubbleProps {
  message: Message;
  onApproveSQL: (messageId: string, sql: string, explanation: string, parentMessageId: string) => void;
  onCancelReview: (messageId: string) => void;
}

export function MessageBubble({ message, onApproveSQL, onCancelReview }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  const handleDownload = useCallback(() => {
    if (message.data?.length) {
      downloadCSV(message.data, `insightstream-${Date.now()}.csv`);
    }
  }, [message.data]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`flex max-w-[85%] flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}
      >
        {/* Main bubble */}
        <div
          className={`message-bubble shadow-lg transition-all ${
            isUser
              ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm shadow-blue-100'
              : 'bg-white/80 backdrop-blur-sm border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm'
          }`}
        >
          <div className="px-5 py-3.5">
            {message.loading ? (
              <LoadingDots />
            ) : (
              <MessageText content={message.content} />
            )}
          </div>
        </div>

        {/* SQL explanation + accordion */}
        {message.sql && (
          <div className="w-full mt-2 space-y-2">
            {message.explanation && (
              <div className="rounded-xl bg-amber-50/50 p-4 border border-amber-100 shadow-sm">
                <div className="flex items-center gap-2 mb-2 text-[10px] font-mono text-amber-600 uppercase tracking-widest font-semibold">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Thought Process
                </div>
                <p className="text-sm text-amber-900/80 leading-relaxed">{message.explanation}</p>
              </div>
            )}
            <Accordion className="w-full">
              <AccordionItem value="sql" className="border-none">
                <AccordionTrigger className="flex h-9 items-center gap-2 rounded-xl bg-slate-100 px-4 py-0 text-[11px] font-mono text-slate-600 hover:bg-slate-200 hover:no-underline transition-colors">
                  <Code2 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  VIEW GENERATED SQL
                </AccordionTrigger>
                <AccordionContent className="mt-2">
                  <div
                    className="rounded-xl bg-slate-800 p-5 font-mono text-xs text-blue-300 overflow-x-auto shadow-inner"
                    aria-label="Generated SQL query"
                  >
                    <pre className="whitespace-pre-wrap break-all leading-relaxed">{message.sql}</pre>
                  </div>

                  {/* Review mode action buttons */}
                  {message.needsReview && message.parentMessageId && (
                    <div className="mt-4 flex gap-3" role="group" aria-label="Review SQL actions">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() =>
                          onApproveSQL(
                            message.id,
                            message.sql!,
                            message.explanation ?? '',
                            message.parentMessageId!,
                          )
                        }
                        aria-label="Approve and execute this SQL query"
                      >
                        Execute Query
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onCancelReview(message.id)}
                        aria-label="Cancel query review"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        {/* Chart / table visualization */}
        {message.data && message.data.length > 0 && message.chartConfig && (
          <div className="w-full mt-4 space-y-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 uppercase tracking-wider font-semibold">
                <BarChart3 className="h-4 w-4 text-blue-500" aria-hidden="true" />
                <span>Visualization: {message.chartConfig.type}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full"
                onClick={handleDownload}
                aria-label={`Download ${message.data.length} rows as CSV`}
                title="Download as CSV"
                disabled={!message.data.length}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <AnalyticsChart data={message.data} config={message.chartConfig} />
            <p className="text-[10px] text-slate-400 font-mono">
              {message.data.length} row{message.data.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
