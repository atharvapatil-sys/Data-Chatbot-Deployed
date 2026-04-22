import React from 'react';
import { Send, Database, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

interface ComposerProps {
  input: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isTyping: boolean;
  messageCount: number;
  maxMessages: number;
  reviewBeforeExecuting: boolean;
  onToggleReview: (checked: boolean) => void;
}

/**
 * User input component for the chat interface.
 * Handles message submission, SQL review toggling, and input rate/limit state.
 */
export function Composer({
  input,
  onChange,
  onSend,
  isTyping,
  messageCount,
  maxMessages,
  reviewBeforeExecuting,
  onToggleReview,
}: ComposerProps) {
  const atLimit = messageCount >= maxMessages;
  const canSend = !isTyping && !!input.trim() && !atLimit;

  return (
    <div className="bg-white/90 p-6 backdrop-blur-lg border-t border-slate-200 z-10 relative">
      <div className="mx-auto max-w-3xl relative">
        {/* Subtle glow background */}
        <div className="absolute inset-0 bg-blue-500/5 rounded-2xl blur-2xl -z-10" aria-hidden="true" />

        {/* Text input */}
        <div className="relative">
          <label htmlFor="query-input" className="sr-only">
            Ask a data question
          </label>
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true">
            <Database className="h-5 w-5" />
          </div>
          <Input
            id="query-input"
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder={
              atLimit
                ? `Message limit reached (${maxMessages}). Start a new session.`
                : 'Ask about marketing spend, ROI, sales trends…'
            }
            disabled={atLimit}
            className="h-14 border-slate-200 bg-white/80 pl-12 pr-16 text-[15px] shadow-sm rounded-2xl focus-visible:ring-blue-500/10 focus-visible:border-blue-500 transition-all border-none ring-1 ring-slate-200"
            aria-label="Data query input"
            aria-describedby="composer-status"
          />
          <Button
            onClick={onSend}
            disabled={!canSend}
            className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 bg-blue-600 p-0 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 rounded-xl shadow-lg shadow-blue-200 transition-all"
            aria-label="Send query"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Options bar */}
      <div className="mt-4 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
          <Checkbox
            id="review-query"
            checked={reviewBeforeExecuting}
            onCheckedChange={(checked) => onToggleReview(checked === true)}
            aria-label="Review generated SQL before executing"
          />
          <label
            htmlFor="review-query"
            className="text-[13px] font-medium text-slate-600 cursor-pointer select-none"
          >
            Review query before executing
          </label>
        </div>

        <p
          id="composer-status"
          className="text-[10px] text-slate-400 uppercase tracking-widest font-medium flex items-center gap-1.5"
        >
          <Shield className="h-3 w-3" aria-hidden="true" />
          {messageCount} / {maxMessages} messages — Read-only BigQuery access · GDPR active
        </p>
      </div>
    </div>
  );
}
