import * as React from 'react';
import { cn } from '@/lib/utils';

const base = 'w-full rounded border border-input bg-white text-[13px] transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input type={type} className={cn('flex h-8 px-2.5 py-1', base, className)} ref={ref} {...props} />
));
Input.displayName = 'Input';

const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea className={cn('flex min-h-[72px] px-3 py-2', base, className)} ref={ref} {...props} />
));
Textarea.displayName = 'Textarea';

// Native select styled like the inputs: accessible and keyboard friendly without another dependency.
const Select = React.forwardRef(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn('flex h-8 px-2 py-1', base, className)} {...props}>{children}</select>
));
Select.displayName = 'Select';

export { Input, Textarea, Select };
