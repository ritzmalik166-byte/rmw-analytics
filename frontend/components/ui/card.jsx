import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn('rounded-md border bg-card text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)} {...props} />);
Card.displayName = 'Card';
const CardHeader = React.forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn('flex flex-col space-y-1 border-b bg-[hsl(214_25%_97%)] px-4 py-2.5', className)} {...props} />);
CardHeader.displayName = 'CardHeader';
const CardTitle = React.forwardRef(({ className, ...props }, ref) => <h3 ref={ref} className={cn('text-[12px] font-semibold uppercase tracking-wide text-slate-600 leading-none', className)} {...props} />);
CardTitle.displayName = 'CardTitle';
const CardDescription = React.forwardRef(({ className, ...props }, ref) => <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />);
CardDescription.displayName = 'CardDescription';
const CardContent = React.forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn('p-4', className)} {...props} />);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
