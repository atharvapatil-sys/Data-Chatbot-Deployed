import React from 'react';
import { Sparkles, Cpu, Activity, User, LogIn, LogOut, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface HeaderProps {
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  tokenUsage: { prompt: number; response: number; total: number };
  schema: string;
  onLogin: () => void;
  onLogout: () => void;
}

export function Header({
  isAuthenticated,
  isCheckingAuth,
  tokenUsage,
  schema,
  onLogin,
  onLogout,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur-md z-20">
      {/* Left — branding + token monitor */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-200">
            <Sparkles className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800 leading-none">
              InsightStream
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <div
                className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
                aria-hidden="true"
              />
              <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-black">
                Enterprise Data Engine
              </p>
            </div>
          </div>
        </div>

        <div className="h-8 w-px bg-slate-200" aria-hidden="true" />

        {/* Token usage monitor */}
        <div
          className="flex items-center gap-4 text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider"
          aria-label="Token usage"
        >
          <div className="flex items-center gap-1.5" title="Prompt tokens used this session">
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Prompt: {tokenUsage.prompt.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5" title="Response tokens generated this session">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Response: {tokenUsage.response.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Right — auth + connection status + schema viewer */}
      <div className="flex items-center gap-4">
        {isAuthenticated ? (
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
              aria-label="Google account connected"
            >
              <User className="h-3 w-3 text-slate-400" aria-hidden="true" />
              Active Account
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-slate-500 hover:text-slate-900 transition-colors"
              aria-label="Log out"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              Logout
            </Button>
          </div>
        ) : (
          <Button
            onClick={onLogin}
            className="bg-blue-600 hover:bg-blue-700 transition-all shadow-md active:scale-95"
            aria-label="Connect your Google account"
          >
            <LogIn className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Connect Google
          </Button>
        )}

        {/* Connection status badge */}
        <div
          className={`flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-mono ring-1 shadow-sm transition-all ${isCheckingAuth
            ? 'bg-slate-50 text-slate-400 ring-slate-100'
            : isAuthenticated
              ? 'bg-green-50 text-green-700 ring-green-200'
              : 'bg-slate-50 text-slate-500 ring-slate-200'
            }`}
          role="status"
          aria-live="polite"
          aria-label={
            isCheckingAuth ? 'Verifying connection' : isAuthenticated ? 'Connected' : 'Disconnected'
          }
        >
          <div
            className={`h-1.5 w-1.5 rounded-full ${isCheckingAuth
              ? 'bg-slate-200 animate-pulse'
              : isAuthenticated
                ? 'bg-green-500 animate-pulse'
                : 'bg-slate-300'
              }`}
            aria-hidden="true"
          />
          <span>
            {isCheckingAuth ? 'VERIFYING…' : isAuthenticated ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>

        {/* Semantic layer / schema viewer */}
        <Dialog>
          <DialogTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-slate-200 bg-white text-slate-700 text-xs hover:bg-slate-50 hover:text-slate-900 shadow-sm"
                aria-label="View semantic layer schema"
              >
                <Database className="mr-2 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                Semantic Layer
              </Button>
            }
          />
          <DialogContent className="max-w-2xl bg-white border-slate-200 text-slate-900 shadow-xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold flex items-center gap-2 text-slate-900">
                <Database className="h-5 w-5 text-blue-500" aria-hidden="true" />
                Enterprise Semantic Layer
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] mt-4 pr-4">
              <pre className="font-mono text-xs text-slate-600 whitespace-pre-wrap leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
                {schema}
              </pre>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </header>
  );
}
