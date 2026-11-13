import * as React from 'react';
import { cn } from '@/lib/utils';

const Table = React.forwardRef(({ className, ...props }, ref) => (
  <div className="table-scroll relative w-full overflow-x-auto overscroll-x-contain">
    <table ref={ref} className={cn('w-full caption-bottom border-collapse text-[13px]', className)} {...props} />
  </div>
));
Table.displayName = 'Table';
const TableHeader = React.forwardRef(({ className, ...props }, ref) => <thead ref={ref} className={cn('sticky top-0 z-[1] bg-[hsl(214_25%_96%)] [&_tr]:border-b', className)} {...props} />);
TableHeader.displayName = 'TableHeader';
const TableBody = React.forwardRef(({ className, ...props }, ref) => <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />);
TableBody.displayName = 'TableBody';
const TableRow = React.forwardRef(({ className, ...props }, ref) => <tr ref={ref} className={cn('border-b border-slate-200/80 transition-colors hover:bg-[hsl(213_60%_97%)] data-[state=selected]:bg-[hsl(213_70%_95%)]', className)} {...props} />);
TableRow.displayName = 'TableRow';
const TableHead = React.forwardRef(({ className, ...props }, ref) => <th ref={ref} className={cn('h-9 whitespace-nowrap px-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-slate-600', className)} {...props} />);
TableHead.displayName = 'TableHead';
const TableCell = React.forwardRef(({ className, ...props }, ref) => <td ref={ref} className={cn('px-2.5 py-2 align-middle', className)} {...props} />);
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
