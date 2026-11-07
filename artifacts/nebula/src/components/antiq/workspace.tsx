import type { ComponentProps, ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export const controlStyles = {
  field: 'w-full min-w-0 min-h-11 rounded-field border border-border bg-surfaceAlt px-4 py-3 text-sm text-ink disabled:opacity-50',
  button: 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-border px-5 py-3 text-sm font-medium transition-colors hover:border-accent hover:bg-surfaceAlt active:bg-surface disabled:cursor-not-allowed disabled:opacity-40',
  primary: 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-cream bg-cream px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-accent hover:border-accent active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40',
};
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return <section {...props} className={cn('min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-6 space-y-4', className)} />;
}
export function StateBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex w-fit rounded-full border border-accent/30 bg-accent/5 px-3 py-1 text-xs font-medium text-accent">{children}</span>;
}
export function ReturnLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  return <Link href={href} onClick={onClick} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted transition-colors hover:text-ink active:text-accent"><ArrowLeft size={16} aria-hidden="true" />{children}</Link>;
}
