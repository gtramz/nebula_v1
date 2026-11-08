import type { UploadedMedia } from './publications.js';
export const opportunityNeeds = ['Verse', 'Feature', 'Production', 'Mix', 'Master'] as const;
export type Compensation = { kind: 'split'; percent: number } | { kind: 'fee'; amount: number; currency: 'USD' };
export type OfferInput = { workId?: number | null; workTitle?: string; need: typeof opportunityNeeds[number]; deliverable: string; requirements: string; deadline: string | null; compensation: Compensation; status: 'open' | 'closed' };
export type CollaborationOffer = OfferInput & { id: number; projectId: number; ownerId: number; projectTitle: string; revision: number; createdAt: string; available: boolean };
export type CollaborationStatus = 'discussion' | 'submitted' | 'changes_requested' | 'accepted' | 'delivered' | 'completed' | 'rejected' | 'withdrawn';
export type Collaboration = { admission: import('./messages.js').Admission; requestPolicy: number; unreadCount: number; lastActivityId: number | null; id: number; offerId: number; ownerId: number; applicantId: number; ownerName: string; applicantName: string; projectTitle: string; terms: CollaborationOffer; status: CollaborationStatus; revision: number; updatedAt: string };
export type CollaborationDetail = Collaboration & {
  currentOffer: CollaborationOffer;
  submissions: { id: number; kind: 'proposal' | 'delivery'; text: string; media: UploadedMedia; files: UploadedMedia[]; createdAt: string; terms: CollaborationOffer | null; remix?: { publicationId?: number; draftId?: string; draftRevision?: number; title: string; originalTitle: string; originalArtist: string } | null }[];
  messages: { id: number; authorId: number; author: string; text: string; kind?: string; createdAt: string }[];
  nextMessageCursor: number | null;
};
