import { Link, useLocation } from "wouter";
import { useResetPreview } from "@nebula/local";

export function SiteFooter() {
  const reset = useResetPreview();
  const [, setLocation] = useLocation();
  return (
    <footer className="fixed inset-x-0 bottom-0 z-50 flex h-10 flex-col justify-center gap-1 border-t border-white/10 bg-bg px-3 text-[8px] text-muted sm:h-7 sm:flex-row sm:items-center sm:justify-start sm:gap-4 sm:px-8 sm:text-[9px]">
      <span className="voice whitespace-nowrap text-[7px] text-tertiary sm:text-[8px]">© 2026 manuellcossio</span>
      <span className="voice text-[7px] sm:text-[8px]">interface preview · data stays in this tab</span>
      <nav aria-label="preview navigation" className="flex items-center gap-3 whitespace-nowrap sm:ml-auto">
        <Link href="/" className="voice hover:text-cream">home</Link>
        <Link href="/explore" className="voice hover:text-cream">explore</Link>
        <button type="button" disabled={reset.isPending} className="voice hover:text-cream"
          onClick={() => {
            if (window.confirm("Clear all profiles and preview data in this tab?")) {
              reset.mutate(undefined, { onSuccess: () => { setLocation("/"); } });
            }
          }}>clear preview</button>
      </nav>
    </footer>
  );
}
