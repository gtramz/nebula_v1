import { Link } from "wouter";
import { type Project } from "@nebula/local";
import { formatMoney } from "@/lib/utils";

export function ProjectCard({ project }: { project: Project }) {
  const percent = Math.min(100, Math.round((project.raisedAmount / project.goalAmount) * 100));

  return (
    <Link href={`/project/${project.id}`}>
      <div className="group relative flex flex-col gap-5 border-t border-white/[0.15] pt-5 overflow-hidden hover:bg-white/[0.02] transition-colors">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-surfaceAlt border border-border">
          {project.coverUrl ? (
            <img src={project.coverUrl} alt={project.title} className="object-cover w-full h-full" />
          ) : (
            <div className="absolute inset-0 bg-surfaceAlt" />
          )}

          <div className="absolute top-4 left-4 rounded-full bg-black px-3 py-1 text-[10px] voice text-cream border border-white/20">
            {project.status}
          </div>
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface border border-white/20 overflow-hidden shrink-0">
              {project.artistPicture ? (
                <img src={project.artistPicture} alt={project.artistName} className="object-cover w-full h-full" />
              ) : (
                <div className="w-full h-full bg-accent flex items-center justify-center text-xs font-bold text-bg">{project.artistName.charAt(0)}</div>
              )}
            </div>
            <div className="flex-1 bg-black px-3 py-1.5 border border-white/20">
              <p className="text-xs text-cream font-bold truncate">{project.artistName}</p>
              <p className="text-[10px] voice text-muted">{project.category}</p>
            </div>
          </div>
        </div>

        <div className="px-2 pb-2 space-y-4">
           <h3 className="text-2xl font-display font-bold leading-tight line-clamp-2 text-ink">{project.title}</h3>

          <div className="space-y-2">
            <div className="flex justify-between text-sm items-end">
              <span className="font-bold text-cream text-lg leading-none">{formatMoney(project.raisedAmount)}</span>
              <span className="text-muted text-xs voice leading-none">{percent}%</span>
            </div>
             <div className="h-px w-full bg-white/20 overflow-hidden">
               <div className="h-full bg-accent transition-all duration-500 ease-out" style={{ width: `${percent}%` }} />
            </div>
            <div className="flex justify-between text-[10px] voice text-muted">
              <span>GOAL {formatMoney(project.goalAmount)}</span>
              <span>{project.backersCount} BACKERS</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
