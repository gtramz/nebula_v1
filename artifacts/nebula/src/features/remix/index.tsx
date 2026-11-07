import { Link, useParams } from 'wouter';
import { isServerMode } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { usePublication } from '@/features/discovery/publication-api';
import { ProjectOffers } from '@/features/collaborations';
import { Studio } from './studio';


export function RemixPage({ proposal = false }: { proposal?: boolean }) {
  const { id } = useParams<{ id: string }>(), { user } = useAuth(), query = usePublication(Number(id), proposal, proposal);
  if (!isServerMode() || user?.role !== 'artist') return <section className="p-8 space-y-4"><h1 className="text-3xl">Remix studio</h1><p>Log in as an artist on the local server to create a remix.</p><Link className="underline" href="/login">Log in</Link></section>;
  if (query.isLoading) return <p className="p-8" role="status">Loading the original…</p>;
  if (query.error || !query.data) return <section className="p-8 space-y-4"><p role="alert">{query.error?.message ?? 'Publication not found.'}</p><Link className="underline" href="/discovery">Back to Discovery</Link></section>;
  const post = query.data;
  if (proposal) return <section className="mx-auto w-full max-w-3xl p-6 space-y-6"><Link href="/studio" className="underline">Your publications</Link><h1 className="text-3xl font-bold">Propose your remix</h1>{post.artistId !== user.artistId || !post.remix ? <p>This remix is not yours.</p> : <><p>{post.title} · Remix of {post.remix.title} by {post.remix.artistName}</p><p className="text-muted">Choose an offer, then use your saved remix in the proposal form. The owner must review and accept it separately.</p>{post.remix.projectId ? <ProjectOffers projectId={post.remix.projectId} proposalPublicationId={post.id} /> : <p>The original has no linked project.</p>}</>}</section>;
  if (!post.allowRemix || post.status !== 'published' || !['audio','video'].includes(post.media.kind) || post.remix) return <section className="p-8 space-y-4"><h1 className="text-3xl">Remix unavailable</h1><p>Choose a published audio or video original with remix permission. Remixes of remixes are not supported yet.</p><Link className="underline" href="/discovery">Back to Discovery</Link></section>;
  return <Studio key={`${post.id}-${user.artistId}`} original={post} />;
}
