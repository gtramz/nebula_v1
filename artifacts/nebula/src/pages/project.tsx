import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetProject, getGetProjectQueryKey, useCreateInvestment, useToggleProjectSupport } from "@nebula/local";
import { useQueryClient } from "@tanstack/react-query";
import { ContentWidth } from "@/components/shell/app-shell";
import { formatMoney } from "@/lib/utils";
import { ArrowLeft, Loader2, Heart, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import * as Dialog from "@radix-ui/react-dialog";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();

  const { data: detail, isLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) }
  });

  const createInvestment = useCreateInvestment();
  const toggleSupport = useToggleProjectSupport();

  const [fundAmount, setFundAmount] = useState<number>(500);
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);

  if (isLoading) return <div className="flex-1 p-8 text-center text-muted voice animate-pulse">LOADING PROJECT...</div>;
  if (!detail) return <div className="flex-1 p-8 text-center text-muted voice">PROJECT NOT FOUND</div>;

  const { project, artist, backers, supporters, viewerHasSupported } = detail;
  const percent = Math.min(100, Math.round((project.raisedAmount / project.goalAmount) * 100));

  const isArtist = user?.role === 'artist';

  const handleFund = (e: React.FormEvent) => {
    e.preventDefault();
    createInvestment.mutate({ data: { projectId, amount: fundAmount } }, {
      onSuccess: (investment) => {
        setIsFundModalOpen(false);
        setLocation(`/receipt/${investment.id}`);
      }
    });
  };

  const handleSupport = () => {
    if (!isAuthenticated) return setLocation("/login");
    toggleSupport.mutate({ id: projectId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      }
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="relative h-72 lg:h-[400px] w-full bg-surfaceAlt overflow-hidden">
        {project.coverUrl ? (
          <img src={project.coverUrl} alt={project.title} className="object-cover w-full h-full opacity-50 mix-blend-luminosity" />
        ) : (
          <div className="absolute inset-0 bg-surfaceAlt" />
        )}
        <div className="absolute inset-0 bg-black/60" />

        <button onClick={() => history.back()} className="absolute top-6 left-6 text-cream hover:text-white glass-band p-2 rounded-full cursor-pointer z-20">
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      <ContentWidth className="-mt-32 relative z-10 space-y-12 pb-32">
        <div className="flex flex-col gap-6 px-4 lg:px-0">
          <div className="inline-flex self-start rounded-full px-4 py-1.5 text-[10px] voice text-cream border border-white/20">
            {project.status.toUpperCase()} • {project.category.toUpperCase()}
          </div>
          <h1 className="text-4xl lg:text-6xl font-display font-bold text-ink tracking-tight text-veil leading-tight">
            {project.title}
          </h1>

          <Link href={`/artist/${artist.id}`} className="flex items-center gap-4 group inline-flex self-start">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/10 group-hover:border-accent transition">
              {artist.picture ? (
                <img src={artist.picture} alt={artist.name} className="object-cover w-full h-full" />
              ) : (
                <div className="w-full h-full bg-accent/20 flex items-center justify-center text-accent font-bold">{artist.name.charAt(0)}</div>
              )}
            </div>
            <span className="font-bold text-lg text-cream group-hover:text-accent transition">{artist.name}</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12 px-4 lg:px-0">
          <div className="lg:col-span-2 space-y-12">
            {project.pitch && (
              <section className="text-xl lg:text-2xl font-display text-ink/90 leading-relaxed text-veil">
                {project.pitch}
              </section>
            )}

            {project.story && (
              <section className="space-y-6">
                <h2 className="voice text-[10px] text-muted">THE STORY</h2>
                <div className="max-w-none text-ink/80 leading-relaxed space-y-4">
                  {project.story.split('\n').map((p, i) => p ? <p key={i}>{p}</p> : <br key={i} />)}
                </div>
              </section>
            )}

            {(backers.length > 0 || supporters.length > 0) && (
              <section className="space-y-6 pt-8 border-t border-white/10">
                <h2 className="voice text-[10px] text-muted">COMMUNITY</h2>
                <div className="flex flex-wrap gap-4">
                  {supporters.map((s, i) => (
                    <Link key={i} href={`/artist/${s.artistId}`}>
                      <div className="w-10 h-10 rounded-full border border-accent overflow-hidden" title={s.name}>
                        {s.picture ? <img src={s.picture} alt={s.name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-accent/20 flex items-center justify-center text-xs text-accent font-bold">{s.name.charAt(0)}</div>}
                      </div>
                    </Link>
                  ))}
                </div>
                <div className="space-y-3">
                  {backers.map((b, i) => (
                    <div key={i} className="flex justify-between items-center py-3 border-b border-white/5 last:border-0">
                      <span className="text-ink font-medium">{b.name}</span>
                      <span className="text-cream font-bold">{formatMoney(b.amount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-6">
             <div className="p-6 border border-border space-y-8 sticky top-24">
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <span className="font-display font-bold text-4xl text-cream leading-none">{formatMoney(project.raisedAmount)}</span>
                  <span className="text-muted voice text-xs pb-1">{percent}% RAISED</span>
                </div>
                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-1000 ease-out" style={{ width: `${percent}%` }} />
                </div>
                <div className="flex justify-between text-[10px] voice text-muted">
                  <span>GOAL {formatMoney(project.goalAmount)}</span>
                  <span>{project.backersCount} BACKERS</span>
                </div>
              </div>

              {project.status === 'funding' ? (
                isArtist ? (
                  <button onClick={handleSupport} className={`w-full py-4 rounded-full font-bold tracking-wide voice text-xs flex items-center justify-center gap-2 transition cursor-pointer ${viewerHasSupported ? 'glass-band-strong text-accent border-accent/20' : 'bg-surfaceAlt text-ink hover:bg-white/10'}`}>
                    <Heart className={`w-4 h-4 ${viewerHasSupported ? 'fill-accent' : ''}`} />
                    {viewerHasSupported ? 'SUPPORTED' : 'SUPPORT SYMBOLICALLY'}
                  </button>
                ) : (
                  <Dialog.Root open={isFundModalOpen} onOpenChange={setIsFundModalOpen}>
                    <Dialog.Trigger asChild>
                      <button className="w-full py-4 bg-cream text-bg rounded-full font-bold tracking-wide voice text-xs hover:bg-white transition shadow-lg cursor-pointer">
                        BACK THIS PROJECT
                      </button>
                    </Dialog.Trigger>

                    <Dialog.Portal>
                         <Dialog.Overlay className="fixed inset-0 bg-bg/90 z-50 animate-fade-in" />
                       <Dialog.Content className="fixed bottom-0 left-0 right-0 lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 w-full lg:max-w-md bg-surface border border-border p-6 z-50 animate-sheet-up lg:animate-expand-in">
                        <Dialog.Title className="text-2xl font-display font-bold text-ink mb-3 text-center text-veil">Select Amount</Dialog.Title>
                        <Dialog.Description className="mb-6 text-center text-sm text-muted">Preview a contribution. No money moves.</Dialog.Description>

                        {!isAuthenticated ? (
                          <div className="text-center space-y-6">
                            <p className="text-muted">You need an investor account to back projects.</p>
                            <Link href="/login" className="block w-full py-4 bg-cream text-bg rounded-full font-bold tracking-wide voice text-xs">
                              Sign In
                            </Link>
                          </div>
                        ) : (
                          <form onSubmit={handleFund} className="space-y-8">
                            <div className="grid grid-cols-2 gap-3">
                              {[250, 500, 1000, 2500].map(amt => (
                                <button
                                  key={amt}
                                  type="button"
                                  onClick={() => setFundAmount(amt)}
                                  className={`py-4 rounded-2xl font-bold transition cursor-pointer ${fundAmount === amt ? 'glass-band-strong text-accent border-accent/30' : 'bg-surfaceAlt text-muted hover:text-ink'}`}
                                >
                                  {formatMoney(amt)}
                                </button>
                              ))}
                            </div>

                            <div className="space-y-2">
                              <label htmlFor="pledge-amount" className="voice text-[10px] text-muted">CUSTOM AMOUNT ({project.currency})</label>
                              <input
                                id="pledge-amount"
                                type="number"
                                min="100"
                                value={fundAmount}
                                onChange={(e) => setFundAmount(Number(e.target.value))}
                                className="w-full bg-surfaceAlt border border-white/5 rounded-2xl px-6 py-4 text-ink font-display text-xl focus:outline-none focus:border-accent transition"
                              />
                            </div>

                            <button
                              type="submit"
                              disabled={createInvestment.isPending}
                              className="w-full py-4 bg-cream text-bg rounded-full font-bold tracking-wide voice text-xs flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-white transition cursor-pointer"
                            >
                              {createInvestment.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                              PREVIEW {formatMoney(fundAmount)}
                            </button>
                            {createInvestment.error && <p role="alert" className="text-sm text-danger">{createInvestment.error.message}</p>}
                          </form>
                        )}
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>
                )
              ) : (
                <div className="w-full py-4 bg-surfaceAlt text-muted text-center rounded-full font-bold tracking-wide voice text-xs border border-white/5">
                  {project.status.toUpperCase()}
                </div>
              )}
              {toggleSupport.error && <p role="alert" className="text-sm text-danger">{toggleSupport.error.message}</p>}
            </div>

            {project.useOfFunds && project.useOfFunds.length > 0 && (
             <div className="p-6 border border-border space-y-6">
                <h2 className="voice text-[10px] text-muted">USE OF FUNDS</h2>
                <div className="space-y-3">
                  {project.useOfFunds.map((uof, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-bold text-ink">
                        <span>{uof.label}</span>
                        <span className="text-muted">{uof.percentage}%</span>
                      </div>
                      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-accent/60 rounded-full" style={{ width: `${uof.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </ContentWidth>
    </div>
  );
}
