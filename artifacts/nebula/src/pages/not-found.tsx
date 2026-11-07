import { ReturnLink } from '@/components/antiq/workspace';
import { ContentWidth } from "@/components/shell/app-shell";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center p-8 gap-6">
      <ContentWidth className="flex flex-col items-center">
        <h1 className="text-[120px] font-display font-bold text-ink/10 leading-none">404</h1>
        <p className="text-muted voice mt-4">Lost in the void</p>
        <ReturnLink href="/explore" className="mt-10">Back to Explore</ReturnLink>
      </ContentWidth>
    </div>
  );
}
