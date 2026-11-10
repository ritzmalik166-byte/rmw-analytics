export function AuthCard({ title, description, children, footer }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-[hsl(var(--primary))] text-white">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4">
          <img src="/rmw-mark.png" alt="Ritz Media World" className="h-8 w-8 rounded-sm bg-white object-contain p-0.5" />
          <span className="leading-tight">
            <span className="block text-[13px] font-semibold">RMW Analytics</span>
            <span className="block text-[10px] text-white/70">Ritz Media World Group · Visitor Intelligence</span>
          </span>
        </div>
        <div className="h-[3px] bg-[hsl(var(--saffron))]" />
      </header>
      <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md">
          <div className="panel overflow-hidden">
            <div className="border-b bg-[hsl(214_25%_97%)] px-5 py-3">
              <h1 className="text-[15px] font-semibold text-slate-900">{title}</h1>
              {description && <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>}
            </div>
            <div className="p-5">{children}</div>
          </div>
          {footer && <div className="mt-3 text-center text-[12px] text-muted-foreground">{footer}</div>}
          <p className="mt-6 text-center text-[11px] text-slate-400">Authorised users only. All access is logged and monitored.</p>
        </div>
      </div>
    </div>
  );
}

export function FormError({ message }) {
  if (!message) return null;
  return <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{message}</div>;
}
