import { Link } from "wouter";
import { AntiqLogo } from "@/components/antiq-logo";
import { ContentWidth } from "@/components/shell/app-shell";

export default function Home() {
  return (
    <div className="relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[min(72vw,760px)] w-[min(82vw,900px)] -translate-x-1/2 -translate-y-1/2 animate-nebula-drift rounded-full blur-[90px]"
        style={{
          background:
            "radial-gradient(ellipse at 42% 48%, rgba(43,60,255,0.16) 0%, rgba(20,42,100,0.09) 34%, transparent 68%), radial-gradient(ellipse at 65% 58%, rgba(36,76,150,0.11) 0%, transparent 58%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[min(42vw,460px)] w-[min(60vw,660px)] -translate-x-1/2 -translate-y-1/2 animate-nebula-drift-reverse rounded-full blur-[70px]"
        style={{
          background:
            "radial-gradient(ellipse at 55% 42%, rgba(58,84,180,0.08) 0%, transparent 64%)",
        }}
      />
      <ContentWidth className="relative z-10 flex flex-col items-center gap-8">
        <AntiqLogo
          className="mb-2 h-32 w-20"
          imageScaleClass="h-[225%] w-auto"
          testId="img-antiq-logo"
        />
        <h1 className="text-7xl font-display font-bold tracking-tighter text-ink text-veil md:text-9xl">nebula</h1>
        <p className="max-w-[400px] text-lg text-muted">music gets made by people who believe in it.</p>
        <div className="flex flex-col gap-4 w-full max-w-[280px] mt-8">
          <Link href="/explore" className="w-full text-center py-4 bg-cream text-bg rounded-full font-bold tracking-wide voice text-xs hover:bg-white transition-colors">
            explore projects
          </Link>
          <Link href="/login" className="w-full text-center py-4 glass-band text-ink rounded-full font-bold tracking-wide voice text-xs hover:border-white/20 transition-colors">
            log in
          </Link>
        </div>
      </ContentWidth>
    </div>
  );
}
