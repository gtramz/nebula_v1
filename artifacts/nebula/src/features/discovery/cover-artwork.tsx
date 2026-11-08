import { useState } from 'react';
import { Link } from 'wouter';
import { Disc3 } from 'lucide-react';
import type { DemoPost } from './demo-posts';

/** Artwork is presentation-only: it never manufactures a project destination. */
export function DiscoveryArtwork({ post, compact = false, useProjectCover = true }: {
  post: DemoPost;
  compact?: boolean;
  useProjectCover?: boolean;
}) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const src = [post.coverUrl, useProjectCover ? post.projectCoverUrl : undefined]
    .find((url): url is string => !!url && !failed.has(url));

  return src
    ? <img key={src} src={src} loading="lazy" decoding="async" alt={`${post.title} cover artwork`}
      onError={() => setFailed(previous => new Set(previous).add(src))} />
    : <div className="discovery-cover-fallback" aria-label="No cover artwork">
      <Disc3 strokeWidth={.6} aria-hidden="true" />
      {!compact && <><span>{post.initials}</span><small>NEBULA / AUDIO</small></>}
    </div>;
}

export function DiscoveryProjectArtwork({ post, onNavigate }: { post: DemoPost; onNavigate?: () => void }) {
  if (!post.project || !Number.isInteger(post.projectId) || !post.projectId || post.projectId < 1) return null;
  return <Link className="discovery-project-artwork" href={`/project/${post.projectId}${post.workId ? `?song=${post.workId}` : ''}`}
    aria-label={`View project: ${post.project.title}`} onClick={onNavigate}>
    <DiscoveryArtwork post={post} compact />
  </Link>;
}
