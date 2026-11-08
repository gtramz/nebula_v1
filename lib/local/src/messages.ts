export type ConversationKind = 'collaboration' | 'general';
export type Admission = 'pending' | 'accepted' | 'rejected' | 'withdrawn';
export type ConversationMessage = { id: number; authorId: number; author: string; text: string; kind: string; createdAt: string };
export type ConversationCard = {
  kind: ConversationKind; id: number; counterpartId: number; counterpartName: string;
  context: string | null; admission: Admission; legacy: boolean; direction: 'received' | 'sent';
  workStatus: string | null; updatedAt: string; unreadCount: number; lastActivityId: number | null;
};
export type GeneralConversation = {
  id: number; senderId: number; recipientId: number; senderName: string; recipientName: string;
  admission: Admission; revision: number; projectId: number | null; projectTitle: string | null; projectAvailable: boolean;
  updatedAt: string; messages: ConversationMessage[]; nextMessageCursor: number | null;
  unreadCount: number; lastActivityId: number | null;
};
export const conversationHref = (kind: ConversationKind, id: number) => `/messages/${kind}/${id}`;
