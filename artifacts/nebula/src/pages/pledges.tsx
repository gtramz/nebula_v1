import { useListMyInvestments, getListMyInvestmentsQueryKey } from "@nebula/local";
import { Link } from "wouter";
import { ContentWidth } from "@/components/shell/app-shell";
import { formatMoney } from "@/lib/utils";

export default function Pledges() {
  const { data: investments, isLoading } = useListMyInvestments({
    query: { queryKey: getListMyInvestmentsQueryKey() }
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <ContentWidth className="py-12 space-y-8 px-4 lg:px-0 pb-32">
        <h1 className="text-5xl font-display font-bold text-ink text-veil">your pledges</h1>

        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-24 border-t border-border animate-pulse" />)}
          </div>
        ) : investments?.length === 0 ? (
           <div className="p-12 border border-border text-center space-y-6 border-dashed">
             <p className="text-muted voice">you haven't backed any projects yet</p>
            <Link href="/explore" className="inline-block py-4 px-8 bg-cream text-bg rounded-full font-bold tracking-wide voice text-xs hover:bg-white transition shadow-lg">
               explore projects
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {investments?.map(inv => (
              <Link key={inv.id} href={`/receipt/${inv.id}`}>
                 <div className="p-6 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02] transition group">
                  <div className="space-y-1">
                    <p className="text-[10px] voice text-muted">{new Date(inv.createdAt).toLocaleDateString()}</p>
                    <h3 className="text-xl font-bold text-ink group-hover:text-cream transition">{inv.projectTitle}</h3>
                    <p className="text-sm text-muted">by {inv.artistName}</p>
                  </div>
                  <div className="flex items-center gap-4 sm:flex-col sm:items-end">
                    <span className="text-2xl font-display font-bold text-cream">{formatMoney(inv.amount)}</span>
                    <span className="text-[10px] voice text-accent glass-band-strong px-3 py-1 rounded-full border-accent/20 shadow-sm">
                      {inv.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </ContentWidth>
    </div>
  );
}
