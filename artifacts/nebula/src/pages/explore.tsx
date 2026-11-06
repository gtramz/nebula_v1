import { useState } from "react";
import { useListProjects } from "@nebula/local";
import { ContentWidth } from "@/components/shell/app-shell";
import { ProjectCard } from "@/components/project-card";

const CATEGORIES = ["all", "album", "ep", "single", "tour", "video"];

export default function Explore() {
  const [category, setCategory] = useState("all");

  const { data: projects, isLoading: projectsLoading } = useListProjects(
    category === "all" ? {} : { category: category.toLowerCase() },
    { query: { queryKey: ['projects', category] } }
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <ContentWidth className="py-8 space-y-10">
        <div className="border-b border-white/[0.15] flex gap-2 overflow-x-auto pb-4 scrollbar-hide px-4 lg:px-0">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`shrink-0 rounded-full px-5 py-2 text-[11px] voice transition-colors ${
                category === cat ? "bg-cream text-bg font-bold" : "border border-border text-muted hover:text-ink"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="px-4 lg:px-0">
          {projectsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
              {[1,2,3].map((i) => (
                <div key={i} className="h-[400px] border-t border-border animate-pulse" />
              ))}
            </div>
          ) : projects?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-border p-8">
              <p className="text-muted voice">no projects found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
              {projects?.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>
      </ContentWidth>
    </div>
  );
}
