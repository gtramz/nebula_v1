import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ProjectOffers } from '@/features/collaborations';
import { apiRequest } from '@nebula/local';
import { useQueryClient } from '@tanstack/react-query';
import { LiveComments, refreshSocial } from '@/features/discovery/social';
import { Link, useLocation } from 'wouter';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, Copy, Disc3, GitBranch, MessageCircle, Send, Star, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { DEMO_POSTS, formatDemoUSD, type DemoPost, type DemoProject } from '@/features/discovery/demo-posts';
import '@/features/discovery/discovery.css';
import { DiscoveryMedia } from '@/features/discovery/media-player';

type Panel = { kind: 'project' | 'comments' | 'send' | 'login' | 'description'; postId: string };
type PostActivity = { starred: boolean; saved: boolean; comments: { id: string; author: string; text: string }[] };
const initialActivity = (posts: DemoPost[]) => Object.fromEntries(posts.map(post => [post.id, { starred: false, saved: false, comments: [] }])) as Record<string, PostActivity>;

function Action({ label, icon, onClick, pressed, detail, disabled }: {
  label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; detail: string | number; disabled?: boolean;
}) {
  return <button type="button" className="discovery-action" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
    {icon}<span>{detail}</span>
  </button>;
}

function DiscoveryPostInfo({ children }: { children: ReactNode }) {
  return <div className="discovery-post-info">{children}</div>;
}
function DiscoveryActionRail({ title, reason, children }: { title: string; reason: string; children: ReactNode }) {
  return <div className="discovery-action-rail"><div className="discovery-actions" aria-label={`Actions for ${title}`}>{children}</div>{reason && <p className="discovery-remix-reason">{reason}.</p>}</div>;
}

function ProjectPanel({ project, live = false, projectId, ownerId }: { project: DemoProject; live?: boolean; projectId?: number; ownerId?: number }) {
  return <div className="discovery-project-info">
    <div><p className="discovery-eyebrow">{project.stage}</p><h3>{project.title}</h3><p className="discovery-byline">by {project.artist}</p></div>
    <p>{project.description}</p>
    <section aria-label="Project funding" className="discovery-funding">
      <div><strong>{formatDemoUSD(project.raised)}</strong><span>of {formatDemoUSD(project.goal)}</span></div>
      <progress value={project.raised} max={project.goal} aria-label="Funding progress" />
      <p className="discovery-eyebrow">use of funds</p>
      {project.useOfFunds.map(item => <div key={item.label}><span>{item.label}</span><span>{item.percent}%</span></div>)}
    </section>
    {live && projectId && <Link className="discovery-primary" href={`/project/${projectId}`}>Open full project</Link>}
    {live && projectId && <ProjectOffers projectId={projectId} ownerId={ownerId} compact />}
    {!live && <section aria-label="Collaboration offers">
      <p className="discovery-eyebrow">open calls · {project.offers.length}</p><h3>Make it together.</h3>
      {project.offers.map(offer => <article key={offer.id} className="discovery-offer">
        <h4>{offer.need}</h4>
        <p className="discovery-compensation">{offer.compensation.kind === 'split' ? `${offer.compensation.percent}% royalty split offered` : `${formatDemoUSD(offer.compensation.amount)} fixed fee`}</p>
        <p>{offer.deliverable}</p>
        <div className="discovery-offer-actions"><button disabled>Contact artist · soon</button><button disabled>Submit work · soon</button></div>
      </article>)}
      <p className="discovery-note">Sample terms only. Messaging, submissions and agreements are not available in this prototype. A remix does not grant collaboration approval or royalties.</p>
    </section>}
  </div>;
}

export default function Discovery({ posts = DEMO_POSTS, live = false, onLoadMore, loadingMore = false }: { posts?: DemoPost[]; live?: boolean; onLoadMore?: () => void; loadingMore?: boolean }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [interactionError, setInteractionError] = useState('');
  const busy = useRef(false);
  const feed = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const opener = useRef<HTMLElement | null>(null);
  const [activeId, setActiveId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('post');
    return posts.find(post => post.id === id)?.id ?? posts[0]?.id;
  });
  const activeIndex = Math.max(0, posts.findIndex(post => post.id === activeId));
  const postOrder = posts.map(post => post.id).join(',');
  const activeIndexRef = useRef(activeIndex), resizing = useRef(false);
  activeIndexRef.current = activeIndex;
  const [activity, setActivity] = useState(() => initialActivity(posts));
  const [panel, setPanel] = useState<Panel | null>(null);
  const [comment, setComment] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const panelPost = posts.find(post => post.id === panel?.postId);
  // Keep the same publication in view when server refreshes prepend new posts.
  useLayoutEffect(() => {
    if (feed.current) feed.current.scrollTop = cards.current[activeIndex]?.offsetTop ?? 0;
  }, [postOrder]);

  useLayoutEffect(() => {
    const container = feed.current; if (!container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      resizing.current = true;
      container.scrollTop = cards.current[activeIndexRef.current]?.offsetTop ?? 0;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { resizing.current = false; });
    });
    observer.observe(container);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); resizing.current = false; };
  }, []);

  useEffect(() => {
    const container = feed.current;
    if (!container) return;
    const observer = new IntersectionObserver(entries => {
      if (resizing.current) return;
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= .6) setActiveId(posts[Number((entry.target as HTMLElement).dataset.index)].id);
        else entry.target.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => media.pause());
      }
    }, { root: container, threshold: [.6] });
    cards.current.forEach(card => { if (card) observer.observe(card); });
    return () => observer.disconnect();
  }, [postOrder]);

  useEffect(() => { setActivity(initialActivity(posts)); setComment(''); }, [user?.artistId, user?.investorId, user?.role]);

  function showPanel(kind: Panel['kind'], post: DemoPost) {
    opener.current = document.activeElement as HTMLElement;
    setComment(''); setCopyStatus(''); setPanel({ kind, postId: post.id });
  }
  function requireAccount(post: DemoPost, action: () => void) {
    if (!user) showPanel('login', post); else action();
  }
  function toggle(post: DemoPost, key: 'starred' | 'saved') {
    requireAccount(post, () => {
      if (!live) { setActivity(current => ({ ...current, [post.id]: { ...current[post.id], [key]: !current[post.id][key] } })); return; }
      if (busy.current) return;
      busy.current = true; setPending(post.id); setInteractionError('');
      void (async () => {
        try {
          await apiRequest(`/api/publications/${post.id.slice(5)}/${key === 'starred' ? 'star' : 'save'}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !post.social?.[key] }) });
          await refreshSocial(client); setAnnouncement(key === 'starred' ? 'Star updated.' : 'Saved collection updated.');
        } catch (error) { setInteractionError((error as Error).message); }
        finally { busy.current = false; setPending(null); }
      })();
    });
  }
  function moveTo(index: number) {
    const container = feed.current, card = cards.current[index];
    if (!container || !card) return;
    // Pause the old media immediately; the observer confirms the visible card.
    container.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => media.pause());
    container.scrollTo({ top: card.offsetTop, behavior: 'instant' });
    setActiveId(posts[index].id);
  }
  function sharedLink(post: DemoPost) { return `${window.location.origin}${import.meta.env.BASE_URL}discovery?post=${encodeURIComponent(post.id)}${live ? '' : '&demo=1'}`; }
  const panelTitle = panel?.kind === 'description' ? 'About this publication' : panel?.kind === 'project' ? 'The project' : panel?.kind === 'comments' ? 'Conversation' : panel?.kind === 'send' ? 'Share this idea' : 'Join the conversation';

  return <section className="discovery" aria-label="Discovery">
    <header className="discovery-heading">
      <div><h1>discovery<span aria-hidden="true">✦</span></h1><p>new sounds. shared possibilities.</p></div>
      <div className="flex gap-3 items-center">{live ? <><a className="text-xs text-muted" href="/discovery?demo=1">demo</a>{user?.role === 'artist' && <Link className="discovery-demo-label" href="/publish">publish +</Link>}</> : <span className="discovery-demo-label">demo preview</span>}</div>
    </header>
    <div className="discovery-layout">
      <div ref={feed} className="discovery-feed" role="region" aria-label="Discovery feed" tabIndex={0}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (['ArrowDown', 'PageDown', 'ArrowUp', 'PageUp'].includes(event.key)) {
            event.preventDefault(); moveTo(Math.max(0, Math.min(posts.length - 1, activeIndex + (['ArrowDown', 'PageDown'].includes(event.key) ? 1 : -1))));
          }
        }}>
        {posts.map((post, index) => {
          const current = (live ? post.social : activity[post.id]) ?? { starred: false, saved: false, comments: [] };
          const remixReason = user?.role === 'investor' ? 'Remix is for artists' : post.original ? 'Remixes of remixes are unavailable' : !post.remixAllowed ? 'Remix not permitted by author' : !live ? 'Remix is unavailable for demo publications' : '';
          const remixDisabled = !!remixReason;
          return <article ref={element => { cards.current[index] = element; }} key={post.id} data-index={index} data-active={index === activeIndex} aria-label={`${post.title} by ${post.author}`} className={`discovery-post discovery-tone-${post.tone}`} inert={index !== activeIndex}>
            <div className="discovery-post-top"><span>{post.media.kind === 'video' ? 'video' : 'audio'} / {post.genre}</span><span>{index + 1} / {posts.length}</span></div>
            <div className="discovery-post-body">
              <DiscoveryMedia post={post} active={index === activeIndex} blocked={!!panel} waveformAccess={live && user?.role === 'artist' && post.remixAllowed && !post.original} />
              <DiscoveryPostInfo>
              <h2 title={post.title}>{post.title}</h2>
              <div className="discovery-author"><span className="discovery-avatar" aria-hidden="true">{post.initials}</span>{post.artistId ? <Link href={`/artist/${post.artistId}`}><strong>{post.author}</strong></Link> : <strong>{post.author}</strong>}<span>{live ? 'artist' : 'demo artist'}</span></div>
              <button className="discovery-caption" onClick={() => showPanel('description', post)} aria-label={`Read description of ${post.title}`}>{post.description}</button>
              {post.original && (live ? post.original.available ? <Link className="discovery-attribution" href={`/discovery?post=${post.original.postId}`}><GitBranch size={13} />Remix of {post.original.title} · {post.original.author}<ArrowUpRight size={13} /></Link> : <p className="discovery-attribution">Remix of {post.original.title} · {post.original.author} · original unavailable</p> : <button className="discovery-attribution" onClick={() => { moveTo(posts.findIndex(item => item.id === post.original?.postId)); feed.current?.focus({ preventScroll: true }); }}><GitBranch size={13} />Remix of {post.original.title} · {post.original.author}<ArrowUpRight size={13} /></button>)}
              {post.project && <button className="discovery-project-link" onClick={() => showPanel('project', post)}><span><small>{post.project.offers.length ? 'seeking collaborators' : 'linked project'}</small><strong>{post.project.title}</strong></span><span>view project <ArrowUpRight size={16} /></span></button>}
              </DiscoveryPostInfo>
            </div>
              <DiscoveryActionRail title={post.title} reason={remixReason}>
                <Action label="Star" disabled={pending === post.id} pressed={current.starred} icon={<Star size={21} fill={current.starred ? 'currentColor' : 'none'} />} detail={live ? post.stars : post.stars + Number(current.starred)} onClick={() => toggle(post, 'starred')} />
                <Action label="Comments" icon={<MessageCircle size={21} />} detail={live ? post.social?.comments ?? 0 : post.comments.length + (activity[post.id]?.comments.length ?? 0)} onClick={() => showPanel('comments', post)} />
                <Action label="Save" disabled={pending === post.id} pressed={current.saved} icon={<Bookmark size={21} fill={current.saved ? 'currentColor' : 'none'} />} detail={current.saved ? 'saved' : 'save'} onClick={() => toggle(post, 'saved')} />
                <Action label="Send" icon={<Send size={21} />} detail="send" onClick={() => requireAccount(post, () => showPanel('send', post))} />
                <Action label={remixReason || 'Remix'} icon={<Disc3 size={21} />} detail={remixDisabled ? user?.role === 'investor' ? 'artists only' : !live ? 'demo only' : 'no remix' : 'remix'} disabled={remixDisabled} onClick={() => requireAccount(post, () => { feed.current?.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => media.pause()); navigate('/studio/remix', { state: { sourceId: Number(post.id.slice(5)), start: true } }); })} />
              </DiscoveryActionRail>
          </article>;
        })}
      </div>
      <nav className="discovery-pagination" aria-label="Feed controls">
        <span>explore<br />a little further</span><ArrowDown size={18} aria-hidden="true" />
        <button aria-label="Previous post" disabled={activeIndex === 0} onClick={() => moveTo(activeIndex - 1)}><ChevronLeft size={20} /></button>
        <span aria-live="polite">{activeIndex + 1} / {posts.length}</span>
        <button aria-label="Next post" disabled={activeIndex === posts.length - 1} onClick={() => moveTo(activeIndex + 1)}><ChevronRight size={20} /></button>
      </nav>
    </div>
    <div className="discovery-preview-note">{live ? <>Stars + recency · new artist discovery slots · <a className="underline" href="/discovery">Refresh feed</a></> : 'Sample content · interactions reset on reload'}{onLoadMore && <button className="underline ml-3" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}</div>
    <span className="sr-only" role="status">{announcement}</span>{interactionError && <p role="alert" className="px-4 py-2 text-sm">{interactionError}</p>}
    <Dialog.Root open={!!panel} onOpenChange={open => { if (!open) setPanel(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="discovery-panel-overlay" />
        <Dialog.Content className="discovery-panel" onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); else feed.current?.focus({ preventScroll: true }); }}>
          <div className="discovery-panel-heading"><p className="discovery-eyebrow">{live ? 'discovery' : 'discovery / demo'}</p><Dialog.Title>{panelTitle}</Dialog.Title><Dialog.Description>{panelPost?.title} · {panelPost?.author}</Dialog.Description></div>
          <Dialog.Close className="discovery-panel-close" aria-label="Close panel"><X size={20} /></Dialog.Close>
          {panelPost && panel?.kind === 'description' && <p className="whitespace-pre-wrap break-words">{panelPost.description}</p>}
          {panelPost && panel?.kind === 'project' && panelPost.project && <ProjectPanel project={panelPost.project} live={live} projectId={panelPost.projectId} ownerId={panelPost.artistId} />}
          {panelPost && panel?.kind === 'comments' && live && <LiveComments key={panelPost.id} postId={Number(panelPost.id.slice(5))} />}
          {panelPost && panel?.kind === 'comments' && !live && <>
            <div className="discovery-comments" aria-label="Comments">
              {[...panelPost.comments, ...activity[panelPost.id].comments].map(item => <article key={item.id}><strong>{item.author}</strong><p>{item.text}</p></article>)}
              {!panelPost.comments.length && !activity[panelPost.id].comments.length && <p>No comments yet. Start the conversation.</p>}
            </div>
            {user ? <form className="discovery-comment-form" onSubmit={event => {
              event.preventDefault(); const text = comment.trim(); if (!text) return;
              setActivity(current => ({ ...current, [panelPost.id]: { ...current[panelPost.id], comments: [...current[panelPost.id].comments, { id: crypto.randomUUID(), author: user.name, text }] } }));
              setComment(''); setAnnouncement('Comment added for this preview.');
            }}><label htmlFor="discovery-comment">Add a comment</label><textarea id="discovery-comment" value={comment} maxLength={500} rows={3} placeholder="What do you hear in this?" onChange={event => setComment(event.target.value)} /><button className="discovery-primary" disabled={!comment.trim()}>Post comment</button><p className="discovery-note">Visible in this preview only. Clears on reload.</p></form>
              : <div className="discovery-auth-prompt"><p>Log in to leave a comment.</p><Link href="/login">log in</Link><Link href="/register">sign up</Link></div>}
          </>}
          {panelPost && panel?.kind === 'send' && <div className="discovery-share"><p>Share a link to this {live ? 'publication' : 'sample publication'}.</p><label htmlFor="discovery-share-url">Publication link</label><input id="discovery-share-url" readOnly value={sharedLink(panelPost)} onFocus={event => event.target.select()} /><button className="discovery-primary" onClick={async () => {
            try { await navigator.clipboard.writeText(sharedLink(panelPost)); setCopyStatus('Link copied.'); }
            catch { setCopyStatus('Copy is unavailable here. Select and copy the link above.'); }
          }}>{copyStatus === 'Link copied.' ? <Check size={16} /> : <Copy size={16} />}Copy link</button><p role="status">{copyStatus}</p><p className="discovery-note">The recipient needs access to this server. Localhost links only work on this computer. No message is sent.</p></div>}
          {panel?.kind === 'login' && <div className="discovery-auth-prompt"><p>Artists and investors can star, comment, save and share. Artists can also remix when the author allows it.</p><Link href="/login">log in</Link><Link href="/register">sign up</Link></div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
