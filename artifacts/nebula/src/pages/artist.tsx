import { useParams, Link } from 'wouter';
import { usePublicArtist } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { ContentWidth } from '@/components/shell/app-shell';
import { ReturnLink, Panel, controlStyles } from '@/components/antiq/workspace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArtistProfileHeader, ArtistPublications, ArtistProjects, ArtistAbout } from '@/features/artist-identity/public-profile';

export default function ArtistProfile() {
  const { id } = useParams<{ id: string }>(), artistId = Number(id);
  const query = usePublicArtist(artistId), { user } = useAuth();
  if (query.isLoading) return <ContentWidth className="py-12"><p role="status">Loading artist…</p></ContentWidth>;
  if (query.isError) return <ContentWidth className="py-12 space-y-4"><p role="alert">{query.error.message}</p><button className={controlStyles.button} onClick={() => void query.refetch()}>Retry profile</button><ReturnLink contextual href="/explore" /></ContentWidth>;
  if (!query.data) return <ContentWidth className="py-12 space-y-4"><h1 className="text-3xl font-bold">Artist not found</h1><ReturnLink contextual href="/explore" /></ContentWidth>;
  const detail = query.data, owner = user?.role === 'artist' && user.artistId === artistId;
  return <div data-page-scroll className="flex-1 overflow-y-auto"><ContentWidth className="py-6 md:py-10 space-y-8 pb-16">
    <ReturnLink contextual href="/explore" />
    <ArtistProfileHeader artist={detail.artist} projectCount={detail.projects.length} owner={owner} capabilities={!owner && (!user || user.role === "artist") ? {message:{href:user ? `/messages/new/${artistId}` : "/login"}} : undefined} />
    <Tabs key={artistId} defaultValue="music" className="space-y-6">
      <TabsList aria-label="Artist profile sections" className="grid h-auto w-full grid-cols-2 sm:grid-cols-5 gap-1 rounded-none border-y border-border bg-transparent p-2 text-muted">
        {([['music','Music'],['posts','Discovery Posts'],['projects','Projects'],['collaborations','Collaborations'],['about','About']] as const).map(([value,label]) => <TabsTrigger key={value} value={value} className="min-h-11 min-w-0 whitespace-normal rounded-full px-3 py-2 data-[state=active]:bg-surfaceAlt data-[state=active]:text-accent focus-visible:ring-accent">{label}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="music"><ArtistPublications artistId={artistId} music owner={owner} /></TabsContent>
      <TabsContent value="posts"><h2 className="text-2xl font-bold mb-5">Discovery Posts</h2><ArtistPublications artistId={artistId} owner={owner} /></TabsContent>
      <TabsContent value="projects"><ArtistProjects detail={detail} /></TabsContent>
      <TabsContent value="collaborations"><Panel><h2 className="text-2xl font-bold">Collaboration credits</h2><p>No public credits to display.</p><p className="text-sm text-muted">Private collaboration activity stays in its workspace. Completing a collaboration does not automatically create a public credit.</p>{owner && <Link className={controlStyles.button} href="/collaborations">Manage collaborations</Link>}</Panel></TabsContent>
      <TabsContent value="about"><ArtistAbout artist={detail.artist} /></TabsContent>
    </Tabs>
  </ContentWidth></div>;
}
