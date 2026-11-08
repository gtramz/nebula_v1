export type CollaborationNotificationKind = 'contact' | 'message' | 'submit' | 'request_changes' | 'accept' | 'reject' | 'withdraw' | 'deliver' | 'complete' | 'offer_updated' | 'offer_closed';
export type ConversationNotificationKind = 'conversation.requested' | 'conversation.accepted' | 'conversation.rejected' | 'conversation.message';
export type NotificationKind = CollaborationNotificationKind | ConversationNotificationKind | 'artist.followed';
type NotificationBase = {
  id: number;
  actorId: number;
  actorName: string;
  createdAt: string;
  readAt: string | null;
};
export type NotificationTarget = { type: 'collaboration' | 'artist' | 'conversation'; id: number; available: boolean };
export type ArtistNotification = NotificationBase & (
  { kind: CollaborationNotificationKind; target: NotificationTarget & { type: 'collaboration' }; collaborationId: number; projectTitle: string; need: string } |
  { kind: ConversationNotificationKind; target: NotificationTarget & { type: 'conversation' }; conversationId: number } |
  { kind: 'artist.followed'; target: NotificationTarget & { type: 'artist' } }
);
export type NotificationSummary = { unreadCount: number; latestId: number | null };
export type NotificationPage = NotificationSummary & { items: ArtistNotification[]; nextCursor: number | null };

/** References originate on the server; never accept arbitrary navigation URLs. */
export function notificationHref(item: ArtistNotification): string | null {
  // Previous collaboration responses/cached fixtures do not include a target yet.
  if ('conversationId' in item) return item.target?.type === 'conversation' && item.target.available && Number.isSafeInteger(item.conversationId) && item.conversationId > 0 && item.target.id === item.conversationId ? `/messages/general/${item.conversationId}` : null;
  const target = item.target ?? (item.kind !== 'artist.followed' ? { type: 'collaboration', id: item.collaborationId, available: true } : null);
  if (!target?.available || !Number.isSafeInteger(target.id) || target.id <= 0) return null;
  if (item.kind === 'artist.followed') return target.type === 'artist' && target.id === item.actorId ? `/artist/${target.id}` : null;
  return target.type === 'collaboration' && target.id === item.collaborationId ? `/collaborations/${target.id}` : null;
}
