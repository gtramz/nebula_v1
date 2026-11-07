import { Link } from 'wouter';
import { useListMyInvestments, useReceivedInvestments } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { ContentWidth } from '@/components/shell/app-shell';
import { ContributionHistory } from '@/components/contribution-history';

export default function Pledges({ received = false }: { received?: boolean }) {
  const { user } = useAuth();
  const permitted = user?.role === (received ? 'artist' : 'investor');
  return (
    <ContentWidth className="py-10 pb-32 space-y-6 w-full">
      <h1 className="text-3xl sm:text-5xl font-bold">{received ? 'contributions received' : 'your pledges'}</h1>
      <p className="text-sm text-muted">{received ? 'Your private history across all your projects, including removed projects.' : 'Your private history and receipts, grouped by project. Control what the public can see.'}</p>
      {permitted && user ? (received ? <ReceivedHistory key={user.artistId} /> : <InvestorHistory key={user.investorId} />) : (
        <div className="border border-border p-8 space-y-4">
          <p className="text-muted">{user ? 'This history belongs to a different profile type.' : 'Log in to view your private history.'}</p>
          <Link href={user ? (user.role === 'artist' ? '/received' : '/pledges') : '/login'} className="underline">{user ? 'Go to my history' : 'Log in'}</Link>
        </div>
      )}
    </ContentWidth>
  );
}

function InvestorHistory() {
  const { data, isLoading, error } = useListMyInvestments();
  if (isLoading) return <p className="text-muted">Loading history…</p>;
  if (error) return <p role="alert" className="text-danger">{error.message}</p>;
  return <ContributionHistory entries={data ?? []} />;
}

function ReceivedHistory() {
  const { data, isLoading, error } = useReceivedInvestments();
  if (isLoading) return <p className="text-muted">Loading history…</p>;
  if (error) return <p role="alert" className="text-danger">{error.message}</p>;
  return <ContributionHistory entries={data ?? []} received />;
}
