export type NotificationKind = 'contact' | 'message' | 'submit' | 'request_changes' | 'accept' | 'reject' | 'withdraw' | 'deliver' | 'complete' | 'offer_updated' | 'offer_closed';
export type ArtistNotification = {
  id: number;
  collaborationId: number;
  actorName: string;
  projectTitle: string;
  need: string;
  kind: NotificationKind;
  createdAt: string;
  readAt: string | null;
};
export type NotificationSummary = { unreadCount: number; latestId: number | null };
export type NotificationPage = NotificationSummary & { items: ArtistNotification[]; nextCursor: number | null };
