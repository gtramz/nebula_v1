import { useState } from "react";
import { Link } from "wouter";
import { useListArtists, useListProjects } from "@nebula/local";
import { ContentWidth } from "@/components/shell/app-shell";
import { Search as SearchIcon, X } from "lucide-react";
import { ProjectCard } from "@/components/project-card";

export default function Search() {
  const [query, setQuery] = useState("");
  const debouncedQuery = query;

  const { data: artists } = useListArtists({ search: debouncedQuery }, { query: { queryKey: ['artists', debouncedQuery], enabled: debouncedQuery.length > 1 } });
  const { data: projects } = useListProjects({ search: debouncedQuery }, { query: { queryKey: ['projects', debouncedQuery], enabled: debouncedQuery.length > 1 } });

  return (
    <div className="flex-1 overflow-y-auto">
      <ContentWidth className="py-8 px-4 lg:px-0 space-y-8">
        <div className="group relative border-b border-white/[0.15] pb-6">
          <label htmlFor="site-search" className="sr-only">search artists and projects</label>
          <div className="pointer-events-none absolute left-5 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-muted transition-colors group-focus-within:text-[#18d9ff]">
            <SearchIcon className="h-[18px] w-[18px] stroke-[1.8]" aria-hidden="true" />
          </div>
          <input
            id="site-search"
            type="search"
            placeholder="search artists, projects..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            className="h-14 w-full appearance-none border border-white/[0.15] bg-surfaceAlt/40 pl-14 pr-14 text-sm text-ink placeholder-muted outline-none transition-[border-color,background-color,box-shadow] duration-200 focus:border-[#18d9ff] focus:bg-surfaceAlt/70 focus:shadow-[0_0_0_3px_rgba(24,217,255,0.08)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="clear search"
              className="absolute right-4 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {debouncedQuery.length > 1 ? (
          <div className="space-y-12 pb-24">
            {artists && artists.length > 0 && (
              <section className="space-y-4">
                <h2 className="voice text-[10px] text-muted ml-2">artists</h2>
                <div className="flex flex-col gap-2">
                  {artists.map((artist) => (
                    <Link key={artist.id} href={`/artist/${artist.id}`}>
                      <div className="flex items-center gap-4 border-t border-border p-4 hover:bg-white/[0.02] transition">
                        <div className="w-12 h-12 rounded-full bg-surface border border-white/10 overflow-hidden shrink-0">
                          {artist.picture ? (
                            <img src={artist.picture} alt={artist.name} className="object-cover w-full h-full" />
                          ) : (
                            <div className="w-full h-full bg-accent/20 flex items-center justify-center text-sm font-bold text-accent">{artist.name.charAt(0)}</div>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-ink">{artist.name}</p>
                          <p className="text-[10px] voice text-muted mt-0.5">{artist.genre || "Artist"} • {artist.projectCount} Projects</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {projects && projects.length > 0 && (
              <section className="space-y-4">
                <h2 className="voice text-[10px] text-muted ml-2">projects</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projects.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              </section>
            )}

            {(!artists || artists.length === 0) && (!projects || projects.length === 0) && (
               <div className="py-20 text-center text-muted voice">no results found</div>
            )}
          </div>
        ) : (
           <div className="py-20 text-center text-muted/50 voice">type to search</div>
        )}
      </ContentWidth>
    </div>
  );
}
