import { useViewState } from '@/components/shell/return-context';
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { artistSearchGenreLabel, useCatalogSearch } from "@nebula/local";
import { ContentWidth } from "@/components/shell/app-shell";
import { Search as SearchIcon, X } from "lucide-react";
import { ProjectCard } from "@/components/project-card";

export default function Search() {
  const [query, setQuery] = useViewState('search-query', "");
  const inputRef = useRef<HTMLInputElement>(null);
  const [composing, setComposing] = useState(false);
  const [settledQuery, setSettledQuery] = useState("");
  const search = query.trim();
  const eligible = search.length >= 2;
  useEffect(() => {
    if (composing || !eligible) { setSettledQuery(""); return; }
    const timer = window.setTimeout(() => setSettledQuery(search), 300);
    return () => window.clearTimeout(timer);
  }, [query, search, composing, eligible]);
  const ready = eligible && !composing && settledQuery === search;
  const { data, isPending, isFetching, error, refetch } = useCatalogSearch(search, ready, composing);
  const waiting = eligible && (!ready || isPending || isFetching);
  const artists = data?.artists;
  const projects = data?.projects;
  const resultCount = (artists?.length ?? 0) + (projects?.length ?? 0);

  return (
    <div data-page-scroll className="flex-1 overflow-y-auto">
      <ContentWidth className="py-8 px-4 lg:px-0 space-y-8">
        <div className="border-b border-white/[0.15] pb-6">
          <label htmlFor="site-search" className="sr-only">search artists and projects</label>
          <div className="relative">
            <div className="pointer-events-none absolute left-5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-muted">
              <SearchIcon className="h-[18px] w-[18px] stroke-[1.8]" aria-hidden="true" />
            </div>
            <input
              ref={inputRef}
              id="site-search"
              type="search"
              placeholder="search artists, projects..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSettledQuery(""); }}
              onCompositionStart={() => { setComposing(true); setSettledQuery(""); }}
              onCompositionEnd={(e) => { setQuery(e.currentTarget.value); setComposing(false); }}
              autoComplete="off"
              maxLength={200}
              aria-describedby="search-status"
              aria-controls="search-results"
              className="h-14 w-full appearance-none border border-white/[0.15] bg-surfaceAlt/40 pl-14 pr-14 text-sm text-ink placeholder-muted outline-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setSettledQuery(""); setComposing(false); inputRef.current?.focus(); }}
                aria-label="clear search"
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-ink"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <p id="search-status" role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted">
          {!eligible ? (search ? "Enter at least 2 characters." : "Search artists and projects.")
            : composing ? "Finish typing to search."
            : waiting ? "Searching…"
            : error ? "Search could not be completed."
            : resultCount ? `${resultCount} ${resultCount === 1 ? "result" : "results"} for “${search}”`
            : `No results for “${search}”. Try another name or title.`}
        </p>
        <div id="search-results" aria-busy={waiting}>

        {ready && error && !isFetching ? <div role="alert" className="space-y-3"><p>{error.message}</p><button type="button" className="min-h-11 min-w-11 underline" onClick={() => { void refetch(); }}>Try again</button></div> : ready && !waiting && !error ? (
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
                        <div className="min-w-0 flex-1 break-words">
                          <p className="font-bold text-ink">{artist.name}</p>
                          <p className="text-[10px] voice text-muted mt-0.5">{artistSearchGenreLabel(artist) || "Artist"} • {artist.projectCount} Projects</p>
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

          </div>
        ) : null}
        </div>
      </ContentWidth>
    </div>
  );
}
