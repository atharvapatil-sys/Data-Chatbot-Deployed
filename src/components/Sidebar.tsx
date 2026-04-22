import React from 'react';
import { PlusCircle, MessageSquare, Trash2, Database, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { SCHEMA_TABLES } from '../constants/schema';
import type { ChatSession } from '../types';

const SUGGESTED_QUERIES = [
  'Show me total spend by channel last month',
  'Which product had the highest revenue in Asia?',
  'Compare ROI across all marketing campaigns',
  'Top 5 regions by units sold this quarter',
];

interface SidebarProps {
  isAuthenticated: boolean;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (e: React.MouseEvent, id: string) => void;
  onSuggestedQuery: (query: string) => void;
}

/**
 * Application sidebar containing session history, data schema exploration,
 * and suggested queries.
 */
export function Sidebar({
  isAuthenticated,
  sessions,
  activeSessionId,
  onNewSession,
  onSwitchSession,
  onDeleteSession,
  onSuggestedQuery,
}: SidebarProps) {
  return (
    <aside
      className="hidden w-80 flex-col bg-slate-50 p-6 lg:flex overflow-y-auto z-10 border-l border-slate-200"
      aria-label="Sidebar"
    >
      <div className="space-y-8">
        {/* New session button */}
        {isAuthenticated && (
          <Button
            onClick={onNewSession}
            className="w-full bg-white border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-600 hover:text-blue-700 shadow-none h-12 rounded-xl group transition-all"
            aria-label="Start a new analysis session"
          >
            <PlusCircle
              className="mr-2 h-4 w-4 group-hover:rotate-90 transition-transform"
              aria-hidden="true"
            />
            New Analysis Session
          </Button>
        )}

        {/* Recent sessions */}
        {isAuthenticated && sessions.length > 0 && (
          <section>
            <h2 className="mb-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest font-semibold flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Recent History
            </h2>
            <ul className="space-y-2" role="list">
              {sessions.slice(0, 5).map((s) => (
                <li key={s.id} role="listitem">
                  <div
                    onClick={() => onSwitchSession(s.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onSwitchSession(s.id)}
                    aria-current={activeSessionId === s.id ? 'true' : undefined}
                    aria-label={`Switch to session: ${s.title}`}
                    className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${activeSessionId === s.id
                        ? 'border-blue-200 bg-blue-50/50 shadow-sm'
                        : 'border-transparent hover:bg-white hover:border-slate-200'
                      }`}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p
                        className={`text-[13px] font-medium truncate ${activeSessionId === s.id ? 'text-blue-700' : 'text-slate-600'
                          }`}
                      >
                        {s.title}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                      onClick={(e) => onDeleteSession(e, s.id)}
                      aria-label={`Delete session: ${s.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Data domains — driven by SCHEMA_TABLES, no hardcoded columns */}
        <section>
          <h2 className="mb-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest font-semibold flex items-center gap-2">
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            Data Domains
          </h2>
          <Accordion className="space-y-3">
            {SCHEMA_TABLES.map((table, idx) => (
              <AccordionItem
                key={table.name}
                value={table.name}
                className="border-none bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
              >
                <AccordionTrigger className="group flex items-center justify-between p-3.5 transition-colors hover:bg-slate-50 hover:no-underline py-0">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2 w-2 rounded-full ${table.color} ring-4 ${table.ringColor}`}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium text-slate-700">{table.displayName}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-1 bg-slate-50/50 border-t border-slate-100">
                  <ul className="space-y-2 text-[11px] font-mono text-slate-500 mt-2" role="list">
                    {table.columns.map((col) => (
                      <li key={col.name} className="flex items-center gap-2">
                        <div
                          className="w-1 h-1 rounded-full bg-slate-300 flex-shrink-0"
                          aria-hidden="true"
                        />
                        <span>{col.name}</span>
                        <span className="text-slate-400">({col.type})</span>
                        {col.description && (
                          <span className="text-slate-300 truncate hidden xl:block">
                            — {col.description}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Suggested queries */}
        <section>
          <h2 className="mb-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest font-semibold flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Suggested Queries
          </h2>
          <ul className="space-y-2.5" role="list">
            {SUGGESTED_QUERIES.map((query) => (
              <li key={query}>
                <button
                  onClick={() => onSuggestedQuery(query)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-left text-[13px] text-slate-600 shadow-sm transition-all hover:border-blue-300 hover:shadow-md hover:text-blue-700 active:scale-[0.98]"
                  aria-label={`Run suggested query: ${query}`}
                >
                  {query}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Semantic layer notice */}
        <div
          className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 shadow-sm"
          role="note"
          aria-label="Semantic layer active"
        >
          <div className="flex items-center gap-2 text-blue-600">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <span className="text-[11px] font-bold uppercase tracking-wider">
              Semantic Layer Active
            </span>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
            AI is grounded in your company's specific metric definitions for ROI, CPA, CTR, and AOV.
            Read-only access enforced.
          </p>
        </div>
      </div>
    </aside>
  );
}
