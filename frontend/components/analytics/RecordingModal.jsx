'use client';
/**
 * "Watch" opens the recording right where you are, in a standard modal. Ctrl/Cmd/middle-click still open the full page in a new tab.
 */
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ExternalLink, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RecordingView } from '@/components/analytics/RecordingView';

const Ctx = createContext(null);

export function useRecordingModal() {
  return useContext(Ctx);
}

const isPlainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function RecordingModalProvider({ children }) {
  const [rec, setRec] = useState(null); // { websiteId, sessionId, dx, dy }
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const show = useCallback((websiteId, sessionId, el) => {
    let dx = 0;
    let dy = 0;
    if (el && typeof window !== 'undefined') {
      const r = el.getBoundingClientRect();
      dx = r.left + r.width / 2 - window.innerWidth / 2;
      dy = r.top + r.height / 2 - window.innerHeight / 2;
    }
    setRec({ websiteId, sessionId, dx, dy, key: Date.now() });
    setOpen(true);
  }, []);

  // Navigating away (e.g. "Visitor profile" inside the modal) closes it.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          {rec && (
            <DialogPrimitive.Content
              key={rec.key}
              aria-describedby={undefined}
              className="fixed inset-0 z-[60] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 flex flex-col overflow-hidden bg-[hsl(var(--page))] shadow-2xl outline-none sm:inset-[2.5vh_2.5vw] sm:rounded-lg sm:border"
            >
              <div className="flex shrink-0 items-center gap-2 border-b bg-[hsl(var(--primary))] px-3 py-2 text-white sm:px-4">
                <DialogPrimitive.Title className="text-[13px] font-semibold">Session recording</DialogPrimitive.Title>
                <span className="hidden h-[3px] w-8 rounded bg-[hsl(var(--saffron))] sm:block" />
                <Link href={`/recordings/${rec.websiteId}/${rec.sessionId}`} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-white/85 hover:bg-white/10 hover:text-white">
                  <ExternalLink className="h-3.5 w-3.5" /><span className="hidden sm:inline">Open full page</span>
                </Link>
                <DialogPrimitive.Close className="rounded p-1.5 hover:bg-white/10" aria-label="Close recording"><X className="h-5 w-5" /></DialogPrimitive.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                <RecordingView websiteId={rec.websiteId} sessionId={rec.sessionId} inModal onDeleted={() => setOpen(false)} onNavigate={() => setOpen(false)} />
              </div>
            </DialogPrimitive.Content>
          )}
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Ctx.Provider>
  );
}

/** Link to a recording that opens the modal on a plain click. */
export function WatchLink({ websiteId, sessionId, className, children, ...props }) {
  const modal = useRecordingModal();
  const href = `/recordings/${websiteId}/${sessionId}`;
  return (
    <Link
      href={href}
      className={cn(className)}
      onClick={(e) => {
        if (!modal || !isPlainClick(e)) return;
        e.preventDefault();
        modal.show(websiteId, sessionId, e.currentTarget);
      }}
      {...props}
    >
      {children}
    </Link>
  );
}
