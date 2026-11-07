import { ReturnLink } from '@/components/antiq/workspace';
import { useParams, Link } from "wouter";
import { useGetArtist, getGetArtistQueryKey } from "@nebula/local";
import { ContentWidth } from "@/components/shell/app-shell";
import { ProjectCard } from "@/components/project-card";
import { formatMoney } from "@/lib/utils";
import { MapPin, Music } from "lucide-react";

export default function ArtistProfile() {
  const { id } = useParams<{ id: string }>();
  const { data: artistDetail, isLoading } = useGetArtist(Number(id), {
    query: { enabled: !!id, queryKey: getGetArtistQueryKey(Number(id)) }
  });

  if (isLoading) {
    return <div className="flex-1 p-8 text-center text-muted voice animate-pulse">LOADING ARTIST...</div>;
  }

  if (!artistDetail) {
    return <div className="flex-1 p-8 text-center text-muted voice">ARTIST NOT FOUND<ReturnLink contextual href="/explore" className="mx-auto mt-4" /></div>;
  }

  const { artist, projects, totalRaised, backersCount } = artistDetail;

  return (
    <div data-page-scroll className="flex-1 overflow-y-auto">
      <div className="relative h-64 lg:h-80 w-full bg-surfaceAlt overflow-hidden">
        {artist.picture ? (
          <img src={artist.picture} alt={artist.name} className="object-cover w-full h-full opacity-60 mix-blend-luminosity" />
        ) : (
          <div className="absolute inset-0 bg-surfaceAlt" />
        )}
        <div className="absolute inset-0 bg-black/70" />

        <ReturnLink contextual href="/explore" className="absolute top-6 left-6 z-20 text-cream" />
      </div>

      <ContentWidth className="-mt-20 relative z-10 space-y-12 pb-24">
        <div className="flex flex-col md:flex-row gap-8 items-start md:items-end px-4 lg:px-0">
          <div className="w-32 h-32 lg:w-40 lg:h-40 rounded-full border-4 border-bg bg-surface overflow-hidden shrink-0 shadow-xl">
            {artist.picture ? (
              <img src={artist.picture} alt={artist.name} className="object-cover w-full h-full" />
            ) : (
              <div className="w-full h-full bg-accent/20 flex items-center justify-center text-4xl font-bold text-accent">{artist.name.charAt(0)}</div>
            )}
          </div>

          <div className="flex-1 space-y-2">
            <h1 className="text-4xl lg:text-5xl font-display font-bold text-ink tracking-tight text-veil">{artist.name}</h1>
            <div className="flex flex-wrap gap-4 text-sm text-muted voice">
              {artist.genre && <span className="flex items-center gap-1.5"><Music className="w-4 h-4" /> {artist.genre}</span>}
              {artist.basedIn && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {artist.basedIn}</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12 px-4 lg:px-0">
          <div className="lg:col-span-2 space-y-10">
            {artist.bio && (
              <section className="space-y-4">
                <h2 className="voice text-[10px] text-muted">ABOUT</h2>
                <p className="text-ink/80 leading-relaxed whitespace-pre-wrap">{artist.bio}</p>
              </section>
            )}

            <section className="space-y-4">
              <h2 className="voice text-[10px] text-muted">PROJECTS</h2>
              {projects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projects.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              ) : (
                <div className="p-8 border border-border text-center text-muted voice border-dashed">no active projects</div>
              )}
            </section>
          </div>

          <div className="space-y-8">
           <section className="p-6 border border-border space-y-6">
              <h2 className="voice text-[10px] text-muted">FUNDING SUMMARY</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-3xl font-display font-bold text-cream">{formatMoney(totalRaised)}</p>
                  <p className="text-xs text-muted voice mt-1">TOTAL RAISED</p>
                </div>
                <div className="h-px w-full bg-white/10" />
                <div>
                  <p className="text-xl font-display font-bold text-ink">{backersCount}</p>
                  <p className="text-xs text-muted voice mt-1">TOTAL BACKERS</p>
                </div>
              </div>
            </section>


          </div>
        </div>
      </ContentWidth>
    </div>
  );
}
