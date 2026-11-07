import type { RemixAttribution, RemixInput, UploadedMedia } from './publications.js';

/** Local mock contract. Antiq's production transport/auth remains to be supplied. */
export type RemixDraft = {
  id: string; ownerId: number; revision: number; createdAt: string; updatedAt: string;
  title: string; description: string; settings: RemixInput; attribution: Pick<RemixAttribution, 'sourceId' | 'sourceRevision' | 'artistId' | 'artistName' | 'title' | 'projectId' | 'grantedAt'>;
  contribution: (UploadedMedia & { duration: number }) | null;
  render: UploadedMedia | null; renderRevision: number | null;
};
export type RemixDraftUpdate = {
  revision: number; title: string; description: string; settings: RemixInput;
  contributionId: string | null; contributionDuration: number | null; renderId: string | null;
};
