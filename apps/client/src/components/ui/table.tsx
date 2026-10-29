import * as React from 'react';
import { cn } from '@/lib/utils';

export const Table = ({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="relative w-full overflow-auto">
    <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
);
export const THead = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn('[&_tr]:border-b', className)} {...props} />
);
export const TBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
);
export const TR = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b transition-colors hover:bg-muted/50', className)} {...props} />
);
export const TH = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-9 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground', className)} {...props} />
);
export const TD = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('px-3 py-2 align-middle', className)} {...props} />
);

export const EmptyRow = ({ cols, text = 'Nothing here yet' }: { cols: number; text?: string }) => (
  <TR>
    <TD colSpan={cols} className="py-8 text-center text-muted-foreground">
      {text}
    </TD>
  </TR>
);
