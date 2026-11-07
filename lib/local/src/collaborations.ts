import type { UploadedMedia } from './publications.js';
export type Compensation = { kind: 'split'; percent: number } | { kind: 'fee'; amount: number; currency: 'USD' };
export type OfferInput = { need: 'Verse' | 'Feature' | 'Production' | 'Mix' | 'Master'; deliverable: string; requirements: string; deadline: string | null; compensation: Compensation; status: 'open' | 'closed' };
export type CollaborationOffer = OfferInput & { id: number; projectId: number; ownerId: number; projectTitle: string; revision: number; createdAt: string; available: boolean };
export type CollaborationStatus = 'discussion' | 'submitted' | 'changes_requested' | 'accepted' | 'delivered' | 'completed' | 'rejected' | 'withdrawn';
export type Collaboration = { id: number; offerId: number; ownerId: number; applicantId: number; ownerName: string; applicantName: string; projectTitle: string; terms: CollaborationOffer; status: CollaborationStatus; revision: number; updatedAt: string };
export type CollaborationDetail = Collaboration & {
  currentOffer: CollaborationOffer;
  submissions: { id: number; kind: 'proposal' | 'delivery'; text: string; media: UploadedMedia; files: UploadedMedia[]; createdAt: string; terms: CollaborationOffer | null; remix?: { publicationId?: number; draftId?: string; draftRevision?: number; title: string; originalTitle: string; originalArtist: string } | null }[];
  messages: { id: number; authorId: number; author: string; text: string; createdAt: string }[];
  nextMessageCursor: number | null;
};
