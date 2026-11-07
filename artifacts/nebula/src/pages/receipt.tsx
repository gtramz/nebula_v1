import { ReturnLink } from '@/components/antiq/workspace';
import { useParams } from "wouter";
import { useGetInvestment, getGetInvestmentQueryKey } from "@nebula/local";
import { ContentWidth } from "@/components/shell/app-shell";
import { formatMoney } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const investmentId = Number(id);

  const { data: receipt, isLoading } = useGetInvestment(investmentId, {
    query: { enabled: !!investmentId, queryKey: getGetInvestmentQueryKey(investmentId) }
  });

  if (isLoading) return <div className="flex-1 p-8 text-center text-muted voice animate-pulse flex items-center justify-center">LOADING RECEIPT...</div>;
  if (!receipt) return <div className="flex-1 p-8 text-center text-muted voice flex items-center justify-center">RECEIPT NOT FOUND</div>;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <ContentWidth className="max-w-md w-full">
        <div className="border border-border bg-surface p-8 lg:p-12 space-y-10 relative overflow-hidden text-center flex flex-col items-center">

          <div className="relative z-10 w-20 h-20 rounded-full bg-success/10 flex items-center justify-center text-success border border-success/20">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="relative z-10 space-y-4">
             <h1 className="text-3xl font-display font-bold text-ink text-veil">pledge preview saved</h1>
             <p className="text-muted leading-relaxed">you previewed support for <br/><strong className="text-cream">{receipt.projectTitle}</strong> by {receipt.artistName}.</p>
          </div>

           <p className="text-xs text-muted">This is a preview. No payment was made.</p>

           <div className="relative z-10 w-full bg-surfaceAlt/50 p-6 border border-border space-y-4 text-left">
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <span className="text-[10px] voice text-muted">AMOUNT</span>
              <span className="font-bold text-xl text-cream">{formatMoney(receipt.amount)}</span>
            </div>
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <span className="text-[10px] voice text-muted">DATE</span>
              <span className="text-sm text-ink font-medium">{new Date(receipt.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] voice text-muted">STATUS</span>
              <span className="text-[10px] voice text-success glass-band-strong px-3 py-1 rounded-full border-success/20 shadow-sm">PREVIEW</span>
            </div>
          </div>

          {receipt.projectArchived && <p className="text-sm text-muted">This project has been removed. Your pledge and receipt are preserved.</p>}
          <ReturnLink href={receipt.projectArchived ? '/pledges' : `/project/${receipt.projectId}`} className="relative z-10">
            {receipt.projectArchived ? 'Back to pledges' : 'Back to project'}
          </ReturnLink>
        </div>
      </ContentWidth>
    </div>
  );
}
