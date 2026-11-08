import type { CollaborationOffer } from './collaborations.js';
import type { Project } from './types.js';

export type PublicationInput = {
  workId?: number | null;
  remix?: RemixInput | null;
  title: string;
  description: string;
  mediaId: string;
  coverId: string | null;
  projectId: number | null;
  allowRemix: boolean;
  status: 'draft' | 'published' | 'withdrawn';
};
export type RemixInput = { contributionKind?: 'audio' | 'video'; sourceId: number; sourceRevision: number; startSeconds: number; endSeconds: number; baseGain: number; voiceGain: number; voiceOffset: number };
export type RemixAttribution = RemixInput & { artistId: number; artistName: string; title: string; projectId: number | null; grantedAt: string; available: boolean };
export type UploadedMedia = { id: string; name?: string; kind: 'audio' | 'video' | 'image' | 'document' | 'archive'; mime: string; size: number; url: string };
export type Publication = PublicationInput & {
  song?: import('./works.js').Song | null;
  remix?: RemixAttribution | null;
  id: number;
  artistId: number;
  artistName: string;
  artistPicture: string | null;
  media: UploadedMedia;
  coverUrl: string | null;
  project: Project | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  offers: CollaborationOffer[];
  social: { stars: number; comments: number; starred: boolean; saved: boolean };
};

export type Waveform = { version: number; mediaId: string; duration: number; hasAudio: boolean; pointsPerSecond: number; peaks: number[] };
