import { useLeaveGuard } from '@/components/shell/navigation-guard';
import { useRef, useState } from "react";
import { ImageUpload } from "@/components/image-upload";
import { useAuth } from "@/context/AuthContext";
import {
  useLogout,
  isServerMode,
  useAuthEvents,
  useUpdateArtistProfile,
  type ArtistProfileInput,
  useListProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  type Project,
  type ProjectInput,
  ProjectInputStatus,
  ProjectInputCurrency,
} from "@nebula/local";
import { ContentWidth } from "@/components/shell/app-shell";
import { LogOut, Plus, Edit2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ProjectCard } from "@/components/project-card";

export default function Profile() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const logout = useLogout();

  if (isLoading) return null;
  if (!isAuthenticated || !user) {
    return (
      <ContentWidth className="py-16 space-y-6">
        <h1 className="text-4xl font-bold text-ink">your profile</h1>
        <p className="text-muted">choose a profile to try the artist or investor experience.</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/login" className="bg-cream px-6 py-3 text-sm font-bold text-bg">log in</Link>
          <Link href="/register" className="border border-border px-6 py-3 text-sm text-ink">create profile</Link>
        </div>
      </ContentWidth>
    );
  }

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/");
      },
    });
  };

  return (
    <div data-page-scroll className="flex-1 overflow-y-auto">
      <ContentWidth className="py-12 space-y-12 px-4 lg:px-0">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-display font-bold text-ink text-veil">
            Profile
          </h1>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-muted hover:text-danger transition voice text-xs cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> LOGOUT
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-6 p-8 glass-band rounded-[32px] text-center sm:text-left shadow-lg">
          <div className="w-24 h-24 rounded-full bg-surface border-4 border-bg overflow-hidden shadow-xl shrink-0">
            {user.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-accent/20 flex items-center justify-center text-3xl font-bold text-accent">
                {user.name.charAt(0)}
              </div>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-ink">{user.name}</h2>
            <div className="inline-flex items-center gap-2 mt-2">
              <span className="voice text-[10px] text-bg bg-cream px-2 py-0.5 rounded-sm font-bold">
                {user.role.toUpperCase()}
              </span>
              {user.email && (
                <span className="text-muted text-sm">{user.email}</span>
              )}
            </div>
          </div>
        </div>

        {isServerMode() && <Link href="/saved" className="block border border-border p-6 hover:bg-surfaceAlt"><h2 className="text-xl font-bold">Saved publications</h2><p className="text-sm text-muted mt-2">Your private collection of sounds and videos.</p></Link>}
        {user.role === "artist" ? <ArtistDashboard /> : <InvestorDashboard />}
        <AccountActivity />
      </ContentWidth>
    </div>
  );
}

function AccountActivity() {
  const { data: events = [] } = useAuthEvents();
  const labels = { registered: 'Account created', login: 'Successful login', login_failed: 'Failed login', logout: 'Logged out', demo_cleared: 'Demo projects and pledges cleared' };
  return <section aria-label="Account activity" className="space-y-4 pb-16">
    <h2 className="text-xl font-bold">Account activity</h2>
    <p className="text-sm text-muted">{isServerMode() ? 'Recent sign-ins and account activity on this server.' : 'Your recent activity in this browser. Earlier activity cannot be reconstructed.'}</p>
    {!events.length ? <p>No activity recorded yet.</p> : <ul className="space-y-3">{events.map((event, index) =>
      <li key={`${event.at}-${index}`} className="border-b border-border pb-3 text-sm flex flex-wrap justify-between gap-2">
        <span>{labels[event.type]}</span><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
      </li>)}</ul>}
  </section>;
}

function InvestorDashboard() {
  return (
    <div className="space-y-6 pb-24">
      <h2 className="voice text-[10px] text-muted ml-2">QUICK LINKS</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/pledges"
          className="p-6 glass-band rounded-3xl hover:bg-surface/50 hover:border-white/10 transition group"
        >
          <h3 className="font-bold text-lg text-cream group-hover:text-white transition">
            My Pledges
          </h3>
          <p className="text-sm text-muted mt-1">
            View your investment history and receipts.
          </p>
        </Link>
        <Link
          href="/explore"
          className="p-6 glass-band rounded-3xl hover:bg-surface/50 hover:border-white/10 transition group"
        >
          <h3 className="font-bold text-lg text-cream group-hover:text-white transition">
            Discover Projects
          </h3>
          <p className="text-sm text-muted mt-1">
            Find new independent artists to support.
          </p>
        </Link>
      </div>
    </div>
  );
}

function ArtistDashboard() {
  const { user } = useAuth();
  const [editingArtist, setEditingArtist] = useState(false);
  const queryClient = useQueryClient();
  const [editingProject, setEditingProject] = useState<Project | "new" | null>(
    null,
  );

  const { data: projects, isLoading } = useListProjects(
    {},
    {
      query: {
        queryKey: ["projects", "artist", user?.artistId],
        enabled: !!user?.artistId,
      },
    },
  );

  const myProjects =
    projects?.filter((p) => p.artistId === user?.artistId) || [];

  if (editingArtist) {
    return <ArtistEditor onClose={() => setEditingArtist(false)} />;
  }

  if (editingProject) {
    return (
      <ProjectEditor
        project={editingProject === "new" ? null : editingProject}
        onClose={() => setEditingProject(null)}
      />
    );
  }

  return (
    <div className="space-y-12 pb-24">
      {isServerMode() && <Link href="/collaborations" className="block border border-border p-6 hover:bg-surfaceAlt"><h2 className="text-xl font-bold">Collaborations</h2><p className="text-sm text-muted mt-2">Review proposals, send messages and manage deliveries.</p></Link>}
      {isServerMode() && <Link href="/studio" className="block border border-border p-6 hover:bg-surfaceAlt">
        <h2 className="text-xl font-bold">Your publications</h2><p className="text-sm text-muted mt-2">Upload audio or video, manage drafts and choose your remix permissions.</p>
      </Link>}
      <Link href="/received" className="block border border-border p-6 hover:bg-surfaceAlt">
        <h2 className="text-xl font-bold">Contributions received</h2>
        <p className="text-sm text-muted mt-2">Private history, project totals and contributions to removed projects.</p>
      </Link>
      <section className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="voice text-[10px] text-muted">ARTIST PROFILE</h2>
          <button
            onClick={() => setEditingArtist(true)}
            className="flex items-center gap-1.5 text-accent hover:text-cream transition voice text-[10px] disabled:opacity-50 cursor-pointer"
          >
            <Edit2 className="w-3 h-3" />
            EDIT PROFILE
          </button>
        </div>

        {user?.artist && (
          <div className="p-6 glass-band rounded-[32px] space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="voice text-[10px] text-muted mb-1.5">GENRE</p>
                <p className="text-ink font-medium">
                  {user.artist.genre || "—"}
                </p>
              </div>
              <div>
                <p className="voice text-[10px] text-muted mb-1.5">BASED IN</p>
                <p className="text-ink font-medium">
                  {user.artist.basedIn || "—"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="voice text-[10px] text-muted mb-1.5">BIO</p>
                <p className="text-sm text-ink/80 line-clamp-3 leading-relaxed">
                  {user.artist.bio || "—"}
                </p>
              </div>
            </div>
            <div className="pt-4 border-t border-white/5">
              <p className="text-[10px] voice text-muted/50">
                Your artist profile for this preview.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h2 className="voice text-[10px] text-muted">FUNDING PROJECTS</h2>
          <button
            onClick={() => setEditingProject("new")}
            className="flex items-center gap-1.5 py-2 px-4 bg-cream text-bg rounded-full voice text-[10px] hover:bg-white transition font-bold cursor-pointer shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" /> NEW PROJECT
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-64 glass-band rounded-[32px] animate-pulse"
              />
            ))}
          </div>
        ) : myProjects.length === 0 ? (
          <div className="p-12 glass-band rounded-[32px] text-center space-y-4 border-dashed border-white/5">
            <p className="text-muted voice">NO PROJECTS YET</p>
            <p className="text-sm text-muted">
              Open a funding round for your next release.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {myProjects.map((p) => (
              <div key={p.id} className="relative group">
                <ProjectCard project={p} />
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setEditingProject(p);
                  }}
                  aria-label={`edit ${p.title}`}
                  className="absolute top-4 right-4 p-3 bg-surfaceAlt/80 backdrop-blur border border-white/10 rounded-full text-cream opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100 transition shadow-lg hover:text-accent hover:border-accent/30 z-20 cursor-pointer"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectEditor({
  project,
  onClose,
}: {
  project: Project | null;
  onClose: () => void;
}) {
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<ProjectInput>({
    title: project?.title || "",
    category: project?.category || "Album",
    goalAmount: project?.goalAmount || 10000,
    currency: ProjectInputCurrency.USD,
    pitch: project?.pitch || "",
    story: project?.story || "",
    status: (project?.status as ProjectInputStatus) || ProjectInputStatus.draft,
    useOfFunds: project?.useOfFunds || [
      { label: "Production", percentage: 100 },
    ],
    coverUrl: project?.coverUrl || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (project) {
      updateProject.mutate(
        { id: project.id, data: formData },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            onClose();
          },
        },
      );
    } else {
      createProject.mutate(
        { data: formData },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            onClose();
          },
        },
      );
    }
  };

  const handleDelete = () => {
    if (project && confirm("Remove this project from discovery? Existing pledges and receipts will be kept.")) {
      deleteProject.mutate(
        { id: project.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            onClose();
          },
        },
      );
    }
  };

  const isPending = createProject.isPending || updateProject.isPending;
  const initial = useRef(JSON.stringify(formData));
  useLeaveGuard(isPending || initial.current !== JSON.stringify(formData) ? 'Leave without saving your project changes?' : null);

  return (
    <div className="glass-band rounded-[32px] p-6 lg:p-10 space-y-8 animate-fade-in relative border-accent/10 shadow-2xl">
      <button
        onClick={onClose}
        className="absolute top-6 right-8 text-muted hover:text-cream text-[10px] voice cursor-pointer p-2"
      >
        CANCEL
      </button>

      <div>
        <h2 className="text-2xl font-display font-bold text-ink text-veil">
          {project ? "Edit Project" : "New Project"}
        </h2>
        <p className="text-muted text-sm mt-1">Configure your funding round.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label htmlFor="project-title" className="voice text-[10px] text-muted ml-2">TITLE</label>
            <input
              id="project-title"
              required
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              className="w-full bg-surfaceAlt border border-white/5 rounded-2xl px-6 py-4 text-ink focus:border-accent outline-none transition"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="project-category" className="voice text-[10px] text-muted ml-2">
              CATEGORY
            </label>
            <select
              id="project-category"
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
              className="w-full bg-surfaceAlt border border-white/5 rounded-2xl px-6 py-4 text-ink focus:border-accent outline-none appearance-none transition"
            >
              <option>Album</option>
              <option>EP</option>
              <option>Single</option>
              <option>Tour</option>
              <option>Video</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="project-goal" className="voice text-[10px] text-muted ml-2">
              GOAL (USD)
            </label>
            <input
              id="project-goal"
              type="number"
              required
              min="0.01"
              max="100000000"
              step="0.01"
              value={formData.goalAmount}
              onChange={(e) =>
                setFormData({ ...formData, goalAmount: Number(e.target.value) })
              }
              className="w-full bg-surfaceAlt border border-white/5 rounded-2xl px-6 py-4 text-ink focus:border-accent outline-none transition"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="project-status" className="voice text-[10px] text-muted ml-2">STATUS</label>
            <select
              id="project-status"
              value={formData.status}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  status: e.target.value as ProjectInputStatus,
                })
              }
              className="w-full bg-surfaceAlt border border-white/5 rounded-2xl px-6 py-4 text-ink focus:border-accent outline-none appearance-none transition"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="funding">Funding (Active)</option>
              <option value="funded">Funded</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="project-pitch" className="voice text-[10px] text-muted ml-2">
            PITCH (Short description)
          </label>
          <textarea
              id="project-pitch"
            rows={2}
            value={formData.pitch || ""}
            onChange={(e) =>
              setFormData({ ...formData, pitch: e.target.value })
            }
            className="w-full bg-surfaceAlt border border-white/5 rounded-2xl px-6 py-4 text-ink focus:border-accent outline-none resize-none transition"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="project-story" className="voice text-[10px] text-muted ml-2">
            FULL STORY
          </label>
          <textarea
              id="project-story"
            rows={6}
            value={formData.story || ""}
            onChange={(e) =>
              setFormData({ ...formData, story: e.target.value })
            }
            className="w-full bg-surfaceAlt border border-white/5 rounded-2xl px-6 py-4 text-ink focus:border-accent outline-none resize-none transition"
          />
        </div>

        <ImageUpload
          label="COVER IMAGE"
          value={formData.coverUrl}
          onChange={(coverUrl) => setFormData({ ...formData, coverUrl })}
        />

        {(createProject.error || updateProject.error || deleteProject.error) && (
          <p role="alert" className="text-sm text-danger">
            {(createProject.error || updateProject.error || deleteProject.error)?.message}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-white/5">
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 py-4 bg-cream text-bg rounded-full font-bold voice text-xs hover:bg-white transition disabled:opacity-50 cursor-pointer shadow-lg"
          >
            {isPending ? "SAVING..." : "SAVE PROJECT"}
          </button>
          {project && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteProject.isPending}
              className="py-4 px-8 glass-band-strong text-danger border-danger/20 rounded-full font-bold voice text-xs hover:bg-danger/10 transition disabled:opacity-50 cursor-pointer"
            >
              DELETE
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ArtistEditor({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const updateArtist = useUpdateArtistProfile();
  const [profile, setProfile] = useState<ArtistProfileInput>({
    name: user?.artist?.name ?? '',
    genre: user?.artist?.genre ?? '',
    basedIn: user?.artist?.basedIn ?? '',
    bio: user?.artist?.bio ?? '',
    recordLabel: user?.artist?.recordLabel ?? '',
    picture: user?.artist?.picture ?? null,
  });
  const initial = useRef(JSON.stringify(profile));
  useLeaveGuard(updateArtist.isPending || initial.current !== JSON.stringify(profile) ? 'Leave without saving your profile changes?' : null);
  const fieldClass = 'w-full bg-surfaceAlt border border-border px-5 py-4 text-ink outline-none focus:border-accent';

  return (
    <section className="glass-band p-6 lg:p-10 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-ink">edit artist profile</h2>
        <button type="button" onClick={onClose} className="text-xs voice text-muted hover:text-ink">cancel</button>
      </div>
      <form className="space-y-6" onSubmit={(event) => {
        event.preventDefault();
        updateArtist.mutate({ data: profile }, { onSuccess: onClose });
      }}>
        {([
          ['name', 'artist name'], ['genre', 'genre'], ['basedIn', 'based in'], ['recordLabel', 'record label'],
        ] as const).map(([key, label]) => (
          <label key={key} className="block space-y-2">
            <span className="voice text-[10px] text-muted">{label}</span>
            <input value={profile[key] ?? ''} maxLength={120} required={key === 'name'} className={fieldClass}
              onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} />
          </label>
        ))}
        <label className="block space-y-2">
          <span className="voice text-[10px] text-muted">bio</span>
          <textarea rows={4} maxLength={4000} value={profile.bio ?? ''} className={fieldClass}
            onChange={(event) => setProfile({ ...profile, bio: event.target.value })} />
        </label>
        <ImageUpload label="PROFILE IMAGE" value={profile.picture} onChange={(picture) => setProfile({ ...profile, picture })} />
        {updateArtist.error && <p role="alert" className="text-sm text-danger">{updateArtist.error.message}</p>}
        <button type="submit" disabled={updateArtist.isPending} className="w-full bg-cream py-4 text-xs font-bold text-bg voice disabled:opacity-50">
          {updateArtist.isPending ? 'saving...' : 'save profile'}
        </button>
      </form>
    </section>
  );
}
