import { ArtistFollowControls } from '@/features/following';
import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { apiRequest, isServerMode, creativeRoleTaxonomy, musicalGenreTaxonomy, type Artist, type Publication, type PublicArtistProfile } from '@nebula/local';
import { Disc3, Film, ArrowUpRight, MapPin } from 'lucide-react';
import { controlStyles, Panel, StateBadge } from '@/components/antiq/workspace';
import { ProjectCard } from '@/components/project-card';
import { DiscoveryMedia } from '@/features/discovery/media-player';
import type { DemoPost } from '@/features/discovery/demo-posts';
import { availabilityLabels } from './fields';
import './public-profile.css';

// Future adapters supply real relationships/actions. Absent capabilities render no controls.
export type ArtistSocialCapabilities = {
  following?: { followers: number; following: number; isFollowing: boolean; onToggle: () => void; pending: boolean };
  message?: { href: string };
};
export function ArtistProfileHeader({ artist, projectCount, owner, capabilities }: { artist: Artist; projectCount: number; owner: boolean; capabilities?: ArtistSocialCapabilities }) {
  const roles = artist.creativeRoles?.map(id => creativeRoleTaxonomy.find(r => r.id === id)?.label ?? id) ?? [];
  return <header className="grid gap-4 md:gap-6 md:grid-cols-[168px_1fr] items-start">
    <div className="h-24 w-24 md:h-40 md:w-40 overflow-hidden rounded-full border border-border bg-surfaceAlt">{artist.picture ? <img className="h-full w-full object-cover" src={artist.picture} alt={`${artist.name} profile`} /> : <div className="flex h-full items-center justify-center text-4xl font-semibold text-accent">{artist.name.slice(0, 1)}</div>}</div>
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-4"><div className="min-w-0"><p className="voice text-[10px] text-muted mb-2">ARTIST / NEBULA</p><h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight break-words">{artist.name}</h1>{artist.username && <p className="text-muted mt-2 break-words">{artist.username.startsWith('@') ? artist.username : `@${artist.username}`}</p>}</div>{owner && <Link className={controlStyles.button} href="/profile?edit=1">Edit Profile</Link>}</div>
      {!!roles.length && <p className="text-sm text-ink/90 break-words" aria-label="Creative roles">{roles.slice(0, 4).join(' · ')}{roles.length > 4 ? ` · +${roles.length - 4} more in About` : ''}</p>}
      {!!artist.genreIds?.length && <div className="flex flex-wrap items-center gap-2" aria-label="Musical genres">{artist.genreIds.slice(0, 6).map(id => <span className="rounded-full border border-border px-3 py-1 text-xs text-muted" key={id}>{musicalGenreTaxonomy.find(g => g.id === id)?.label ?? id}</span>)}{artist.genreIds.length > 6 && <span className="text-xs text-muted">+{artist.genreIds.length - 6} more in About</span>}</div>}
      {artist.bio && <p className="text-sm leading-relaxed text-muted whitespace-pre-wrap break-words line-clamp-3">{artist.bio}</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm"><span><strong>{projectCount}</strong> public {projectCount === 1 ? 'project' : 'projects'}</span>{artist.basedIn && <span className="flex gap-1.5 items-center text-muted break-words"><MapPin size={16} aria-hidden />{artist.basedIn}</span>}{artist.collaborationAvailability && artist.collaborationAvailability !== 'unspecified' && <StateBadge>{availabilityLabels[artist.collaborationAvailability]}</StateBadge>}</div>
      <ArtistFollowControls artistId={artist.id} />
      {capabilities?.following && <div className="flex flex-wrap gap-4 items-center text-sm"><span>{capabilities.following.followers} followers</span><span>{capabilities.following.following} following</span>{!owner && <button className={controlStyles.button} onClick={capabilities.following.onToggle} disabled={capabilities.following.pending}>{capabilities.following.isFollowing ? 'Unfollow' : 'Follow'}</button>}</div>}
      {!owner && capabilities?.message && <Link href={capabilities.message.href} className={controlStyles.button}>Message</Link>}
    </div>
  </header>;
}
function useArtistPosts(artistId: number, music: boolean) {
  return useInfiniteQuery({ queryKey: ['public-artist-posts', artistId, music], initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => apiRequest<{ items: Publication[]; nextCursor: number | null }>(`/api/publications?artistId=${artistId}${music ? '&projectAudio=1' : ''}${pageParam ? `&before=${pageParam}` : ''}`, { signal }),
    getNextPageParam: page => page.nextCursor ?? undefined, enabled: isServerMode(), refetchOnWindowFocus: true, refetchInterval: 15000,
  });
}
function publicPost(post: Publication): DemoPost {
  return { id: `post-${post.id}`, title: post.title, author: post.artistName, artistId: post.artistId, initials: post.artistName.slice(0, 2).toUpperCase(), genre: 'Project audio', description: post.description, media: { kind: 'audio', src: post.media.url, durationSeconds: 0 }, coverUrl: post.coverUrl ?? post.project?.coverUrl, tone: 'amber', stars: post.social.stars, remixAllowed: post.allowRemix, comments: [] };
}
export function ArtistPublications({ artistId, music = false, owner }: { artistId: number; music?: boolean; owner: boolean }) {
  const query = useArtistPosts(artistId, music), [selected, setSelected] = useState<number>();
  const posts = query.data?.pages.flatMap(p => p.items) ?? [];
  const current = posts.find(p => p.id === selected) ?? posts[0];
  const presentation = useMemo(() => current ? publicPost(current) : undefined, [current]);
  if (!isServerMode()) return <Panel><h3 className="font-semibold">{music ? 'No project audio to display.' : 'No publications to display.'}</h3><p className="text-sm text-muted">Public audio and video are available in the connected local review environment.</p></Panel>;
  if (query.isLoading) return <p role="status" className="py-8 text-muted">Loading {music ? 'music' : 'publications'}…</p>;
  if (query.isError) return <Panel><p role="alert">{query.error.message}</p><button className={controlStyles.button} onClick={() => void query.refetch()}>Retry publications</button></Panel>;
  return <div className="space-y-6">
    {music && <div><h2 className="text-2xl font-bold">Music</h2><p className="text-sm text-muted mt-2">Published audio from this artist’s Single, EP and Album projects. These are project posts, not a verified release catalog.</p></div>}
    {!posts.length ? <Panel><Disc3 className="text-accent" size={32} aria-hidden /><h3 className="text-xl font-bold">{music ? 'The music starts here.' : 'No Discovery posts yet.'}</h3><p className="text-sm text-muted">{music ? 'No published audio is linked to a public music project yet. Independent audio and videos appear in Discovery Posts.' : 'Published audio and video will appear here. Drafts stay private.'}</p>{owner && <Link href="/publish" className={controlStyles.button}>Create publication</Link>}</Panel>
      : music ? <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(240px,.8fr)] gap-6">
        <Panel className="artist-profile-player min-w-0"><DiscoveryMedia key={current.id} post={presentation!} active nearby blocked={false} waveformAccess={false} info={<div className="py-4 space-y-2"><h3 className="text-xl font-semibold break-words">{current.title}</h3>{current.project && <Link href={`/project/${current.project.id}`} className="text-sm text-accent underline">{current.project.title} · {current.project.category}</Link>}<p className="text-sm text-muted break-words whitespace-pre-wrap">{current.description}</p><Link href={`/discovery?post=post-${current.id}`} className="inline-flex min-h-11 items-center text-sm underline">Open original post</Link></div>} /></Panel>
        <div className="space-y-2" aria-label="Project audio selection">{posts.map(post => <button key={post.id} className={`w-full min-h-16 flex gap-3 items-center text-left p-3 border rounded-field ${current.id === post.id ? 'border-accent bg-surfaceAlt' : 'border-border'}`} aria-pressed={current.id === post.id} aria-label={`Select audio: ${post.title}`} onClick={() => setSelected(post.id)}>
          <Artwork post={post} compact /><span className="min-w-0"><span className="block font-semibold break-words">{post.title}</span><span className="text-xs text-muted">Project audio · {post.project?.category}</span></span>
        </button>)}</div>
      </div> : <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-5">{posts.map(post => <Link key={post.id} className="min-w-0 border border-border rounded-field overflow-hidden hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label={`Open publication: ${post.title}`} href={`/discovery?post=post-${post.id}`}><Artwork post={post} /><div className="p-3 space-y-2"><p className="voice text-[9px] text-muted">{post.media.kind} / DISCOVERY</p><h3 className="font-semibold break-words">{post.title}</h3>{post.project && <p className="text-xs text-muted break-words">Project: {post.project.title}</p>}{post.remix && <p className="text-xs text-muted">Remix of {post.remix.title} · {post.remix.artistName}</p>}</div></Link>)}</div>}
    {query.hasNextPage && <button className={controlStyles.button} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}
  </div>;
}
function Artwork({ post, compact = false }: { post: Publication; compact?: boolean }) {
  const source = post.coverUrl ?? post.project?.coverUrl;
  const [failed, setFailed] = useState(false);
  return <span className={`${compact ? 'w-12 h-12 shrink-0 rounded-field' : 'aspect-square w-full'} flex items-center justify-center overflow-hidden bg-surfaceAlt`}>
    {source && !failed ? <img src={source} onError={() => setFailed(true)} alt="" loading="lazy" className="w-full h-full object-cover" /> : post.media.kind === 'video' ? <Film size={compact ? 24 : 40} className="text-muted" aria-hidden /> : <Disc3 size={compact ? 24 : 40} className="text-accent" aria-hidden />}
  </span>;
}
export function ArtistProjects({ detail }: { detail: PublicArtistProfile }) {
  const active = new Set(detail.opportunityProjectIds);
  const groups = [
    { title: 'Open opportunities', projects: detail.projects.filter(p => active.has(p.id)) },
    { title: 'Other public projects', projects: detail.projects.filter(p => !active.has(p.id) && p.status !== 'closed') },
    { title: 'Closed projects', projects: detail.projects.filter(p => !active.has(p.id) && p.status === 'closed') },
  ];
  if (!detail.projects.length) return <Panel><h2 className="text-xl font-bold">No public projects yet.</h2><p className="text-sm text-muted">An artist can collaborate and explore before creating a project.</p></Panel>;
  return <div className="space-y-10">{groups.filter(group => group.projects.length).map(group => <section key={group.title} className="space-y-4"><h2 className="text-2xl font-bold">{group.title}</h2><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">{group.projects.map(project => <ProjectCard key={project.id} project={project} />)}</div></section>)}</div>;
}
export function ArtistAbout({ artist }: { artist: Artist }) {
  return <div className="grid md:grid-cols-2 gap-6">
    <Panel><h2 className="text-2xl font-bold">About</h2><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{artist.bio || 'No biography added yet.'}</p><dl className="space-y-4 text-sm">
      <div><dt className="text-muted mb-1">Creative roles</dt><dd>{artist.creativeRoles?.map(id => creativeRoleTaxonomy.find(r => r.id === id)?.label).join(' · ') || 'Not specified'}</dd></div>
      <div><dt className="text-muted mb-1">Musical genres</dt><dd>{artist.genreIds?.map(id => musicalGenreTaxonomy.find(g => g.id === id)?.label).join(' · ') || 'Not specified'}</dd></div>
      {artist.basedIn && <div><dt className="text-muted mb-1">Based in</dt><dd className="break-words">{artist.basedIn}</dd></div>}{artist.recordLabel && <div><dt className="text-muted mb-1">Record label</dt><dd className="break-words">{artist.recordLabel}</dd></div>}
      <div><dt className="text-muted mb-1">Collaboration availability</dt><dd>{availabilityLabels[artist.collaborationAvailability ?? 'unspecified']}</dd></div>
      {!!artist.publicInterests?.length && <div><dt className="text-muted mb-1">Public professional interests</dt><dd>{artist.publicInterests.join(' · ')}</dd></div>}
    </dl></Panel>
    <Panel><h2 className="text-2xl font-bold">Around the web</h2>{artist.externalLinks?.length ? <ul className="space-y-2">{artist.externalLinks.map(link => <li key={link.url}><a href={link.url} rel="noopener noreferrer" target="_blank" className={`${controlStyles.button} w-full justify-between break-words`}><span className="min-w-0">{link.label}</span><ArrowUpRight size={18} aria-hidden /></a></li>)}</ul> : <p className="text-sm text-muted">No public links added yet.</p>}</Panel>
  </div>;
}
