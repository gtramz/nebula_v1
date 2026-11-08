import { expect, test } from 'vitest';
import { notificationHref, type ArtistNotification } from './notifications';
const base = { id: 1, actorId: 2, actorName: 'Actor', readAt: null, createdAt: '2026-01-01T00:00:00.000Z' };
test('typed notification destinations preserve work routes and reject unavailable or forged references', () => {
 const follow: ArtistNotification = { ...base, kind: 'artist.followed', target: { type: 'artist', id: 2, available: true } };
 const work: ArtistNotification = { ...base, kind: 'message', collaborationId: 7, projectTitle: 'Work', need: 'Verse', target: { type: 'collaboration', id: 7, available: true } };
 expect(notificationHref(follow)).toBe('/artist/2'); expect(notificationHref(work)).toBe('/collaborations/7');
 expect(notificationHref({ ...follow, target: { ...follow.target, available: false } })).toBeNull();
 expect(notificationHref({ ...follow, target: { ...follow.target, id: 3 } })).toBeNull();
 expect(notificationHref({ ...work, target: { ...work.target, id: 8 } })).toBeNull();
 expect(notificationHref({ ...work, target: { ...work.target, available: false } })).toBeNull();
 expect(notificationHref({ ...follow, target: { ...follow.target, id: NaN } })).toBeNull();
 expect(notificationHref({ ...follow, target: undefined } as unknown as ArtistNotification)).toBeNull();
 expect(notificationHref({ ...work, target: undefined } as unknown as ArtistNotification)).toBe('/collaborations/7');
});

test('general message notifications use only verified conversation references',()=>{
 const item:ArtistNotification={...base,kind:'conversation.requested',conversationId:12,target:{type:'conversation',id:12,available:true}};
 expect(notificationHref(item)).toBe('/messages/general/12');
 expect(notificationHref({...item,target:{...item.target,id:13}})).toBeNull();
 expect(notificationHref({...item,target:{...item.target,available:false}})).toBeNull();
 expect(notificationHref({...item,conversationId:NaN})).toBeNull();
});
