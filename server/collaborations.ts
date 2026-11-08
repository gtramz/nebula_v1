import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Project, SessionUser } from '../lib/local/src/types.js';
import type { CollaborationOffer, OfferInput, Collaboration, CollaborationStatus } from '../lib/local/src/collaborations.js';
import { isMoney } from '../lib/local/src/money.js';
import { ensure, id, object, text, HttpError } from './validation.js';
import { mayReceiveRequest, type MessageStorage } from './message-storage.js';
import type { NotificationService } from './notifications.js';
import { transaction as transact } from './transaction.js';
import type { CollaborationNotificationKind } from '../lib/local/src/notifications.js';

type OfferRow = { id: number; project: number; owner: number; title: string; data: string; revision: number; created: string };
type ThreadRow = { request_policy: number; admission: import('../lib/local/src/messages.js').Admission; id: number; offer: number; owner: number; applicant: number; terms: string; status: CollaborationStatus; revision: number; updated: string };
type Dependencies = {
  songs: ReturnType<typeof import('./works.js').works>;
  alerts: NotificationService; messages: MessageStorage; isArtist: (id: number) => boolean;
  privateMedia: (id: string) => boolean;
  remixProposal: (draftId: string, owner: number, mediaId: string, projectId: number) => object;
  db: DatabaseSync; current: (req: IncomingMessage, artistOnly?: boolean) => SessionUser; viewer: (req: IncomingMessage) => number | null;
  project: (id: number, viewer: number | null) => Project | null; name: (id: number) => string;
  body: (req: IncomingMessage) => Promise<Record<string, unknown>>; json: (res: ServerResponse, value: unknown, status?: number) => void;
  rate: (req: IncomingMessage, name: string, limit: number, seconds: number, identity?: string) => void;
  media: (id: string) => { id: string; owner: number; kind: string; mime: string; size: number; name?: string } | undefined;
};
export function collaborations(d: Dependencies) {
  const { db } = d;
  db.exec(`CREATE TABLE IF NOT EXISTS collaboration_offers(id INTEGER PRIMARY KEY AUTOINCREMENT, project INTEGER NOT NULL, owner INTEGER NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS offers_project ON collaboration_offers(project);
    CREATE TABLE IF NOT EXISTS collaborations(id INTEGER PRIMARY KEY AUTOINCREMENT, offer INTEGER NOT NULL, owner INTEGER NOT NULL, applicant INTEGER NOT NULL, terms TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discussion', revision INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL, UNIQUE(offer,applicant));
    CREATE INDEX IF NOT EXISTS collaborations_owner ON collaborations(owner,id);
    CREATE INDEX IF NOT EXISTS collaborations_applicant ON collaborations(applicant,id);
    CREATE TABLE IF NOT EXISTS collaboration_submissions(id INTEGER PRIMARY KEY AUTOINCREMENT, thread INTEGER NOT NULL, media TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collaboration_files(submission INTEGER NOT NULL, media TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(submission,media));
    CREATE INDEX IF NOT EXISTS collaboration_files_media ON collaboration_files(media);
    CREATE INDEX IF NOT EXISTS submissions_media ON collaboration_submissions(media);
    CREATE TABLE IF NOT EXISTS collaboration_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, thread INTEGER NOT NULL, author INTEGER NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_thread ON collaboration_messages(thread,id);`);
  // Preserve the terms of every submission revision, not just the latest proposal.
  if (!(db.prepare('PRAGMA table_info(collaboration_submissions)').all() as { name: string }[]).some(column => column.name === 'terms')) db.exec('ALTER TABLE collaboration_submissions ADD COLUMN terms TEXT');
  if (!(db.prepare('PRAGMA table_info(collaboration_submissions)').all() as { name: string }[]).some(column => column.name === 'remix')) db.exec('ALTER TABLE collaboration_submissions ADD COLUMN remix TEXT');
  transact(db, () => {
    const columns = db.prepare('PRAGMA table_info(collaborations)').all() as {name:string}[];
    if (!columns.some(c=>c.name==='request_policy')) db.exec("ALTER TABLE collaborations ADD COLUMN request_policy INTEGER NOT NULL DEFAULT 0");
    if (!columns.some(c=>c.name==='admission')) db.exec("ALTER TABLE collaborations ADD COLUMN admission TEXT NOT NULL DEFAULT 'accepted'");
    if (!(db.prepare('PRAGMA table_info(collaboration_messages)').all() as {name:string}[]).some(c=>c.name==='kind')) db.exec("ALTER TABLE collaboration_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message'");
  });
  const alerts = d.alerts;
  const transaction = <T>(write: () => T): T => transact(db, write);
  function offerRow(offerId: number) { const row = db.prepare('SELECT * FROM collaboration_offers WHERE id=?').get(offerId) as OfferRow | undefined; ensure(row, 'Offer not found.', 404); return row; }
  function offerDto(row: OfferRow, project = d.project(row.project, null)): CollaborationOffer {
    const data = JSON.parse(row.data) as OfferInput;
    const song = data.workId ? d.songs.linked(row.project,data.workId,row.owner) : null;
    return { ...data, ...(song ? {workTitle:song.title} : {}), id: row.id, projectId: row.project, ownerId: row.owner, projectTitle: project?.title ?? row.title, revision: row.revision, createdAt: row.created,
      available: !!project && project.status !== 'closed' && data.status === 'open' && (!data.deadline || data.deadline >= new Date().toISOString().slice(0,10)) };
  }
  function publicOffers(project: number, viewer: number | null) {
    const visible = d.project(project, viewer); if (!visible) return [];
    return (db.prepare('SELECT * FROM collaboration_offers WHERE project=? ORDER BY id DESC').all(project) as OfferRow[]).map(row => offerDto(row)).filter(offer => visible.artistId === viewer || offer.available);
  }
  // One read for the Home aggregate. Reuse availability rules without per-card
  // HTTP requests or repeatedly parsing the project store for each offer.
  function opportunityProjects(projects: Project[]) {
    const visible = new Map(projects.filter(project => !['draft', 'closed'].includes(project.status)).map(project => [project.id, project]));
    const offers = new Map<number, CollaborationOffer[]>();
    for (const row of db.prepare('SELECT * FROM collaboration_offers ORDER BY id DESC').all() as OfferRow[]) {
      const project = visible.get(row.project); if (!project) continue;
      const offer = offerDto(row, project); if (!offer.available) continue;
      const list = offers.get(project.id) ?? []; list.push(offer); offers.set(project.id, list);
    }
    return [...visible.values()].map(project => ({ project, offers: offers.get(project.id) ?? [] }))
      .filter(item => item.project.status === 'funding' || item.offers.length > 0);
  }
  function ownedProject(project: number, viewer: number) { const value = d.project(project, viewer); ensure(value && value.artistId === viewer, 'Project not found.', 404); return value; }
  function input(value: unknown, projectId:number, owner:number): OfferInput {
    const v = object(value), compensation = object(v.compensation);
    ensure(['Verse','Feature','Production','Mix','Master'].includes(String(v.need)), 'Choose a collaboration need.');
    ensure(v.status === 'open' || v.status === 'closed', 'Choose an offer status.');
    const deadline = v.deadline == null || v.deadline === '' ? null : text(v.deadline, 'Deadline', 10, 10);
    if (deadline) ensure(/^\d{4}-\d{2}-\d{2}$/.test(deadline) && Number.isFinite(Date.parse(deadline)) && new Date(deadline).toISOString().slice(0,10) === deadline && deadline >= new Date().toISOString().slice(0,10), 'Choose today or a future deadline (UTC).');
    ensure(compensation.kind === 'split' || compensation.kind === 'fee', 'Choose compensation.');
    if (compensation.kind === 'split') ensure(isMoney(compensation.percent, .01, 100), 'Royalty percentage must be 0.01–100 with at most two decimals.');
    else ensure(compensation.currency === 'USD' && isMoney(compensation.amount, .01, 1_000_000), 'Enter a USD fee of 0.01–1,000,000 with at most two decimals.');
    const song=d.songs.validateLink(projectId,v.workId,owner);
    return { ...(song ? {workId:song.id,workTitle:song.title} : {}), need: v.need as OfferInput['need'], deliverable: text(v.deliverable, 'Deliverable', 2000, 1), requirements: text(v.requirements, 'Requirements', 4000), deadline, status: v.status,
      compensation: compensation.kind === 'split' ? { kind: 'split', percent: compensation.percent as number } : { kind: 'fee', amount: compensation.amount as number, currency: 'USD' } };
  }
  function threadRow(threadId: number, viewer: number) {
    const row = db.prepare('SELECT * FROM collaborations WHERE id=? AND (owner=? OR applicant=?)').get(threadId, viewer, viewer) as ThreadRow | undefined;
    ensure(row, 'Collaboration not found.', 404); return row;
  }
  function threadDto(row: ThreadRow, viewer: number): Collaboration {
    const terms = JSON.parse(row.terms) as CollaborationOffer;
    return { admission: row.admission, requestPolicy: row.request_policy, ...d.messages.reading('collaboration',row.id,viewer), id: row.id, offerId: row.offer, ownerId: row.owner, applicantId: row.applicant, ownerName: d.name(row.owner), applicantName: d.name(row.applicant), projectTitle: terms.projectTitle, terms, status: row.status, revision: row.revision, updatedAt: row.updated };
  }
  function submissionInput(data: Record<string,unknown>, viewer: number, offer: CollaborationOffer, kind: 'proposal'|'delivery') {
  const rawFiles = data.mediaIds ?? [data.mediaId];
  ensure(Array.isArray(rawFiles) && rawFiles.length >= 1 && rawFiles.length <= 10, 'Choose between 1 and 10 files.');
  const files = rawFiles.map(value => text(value, 'Media', 36, 36));
  ensure(new Set(files).size === files.length, 'A file cannot be attached twice.');
  let bytes = 0;
  for (const file of files) { const media = d.media(file); ensure(media && media.owner === viewer && ['audio','video','document','archive'].includes(media.kind), 'Choose your own audio, video, PDF or ZIP.'); bytes += media.size; }
  ensure(bytes <= 250 * 1024 * 1024, 'A submission can contain up to 250 MB.');
  const mediaId = data.mediaId == null ? files[0] : text(data.mediaId, 'Media', 36, 36);
  ensure(files.includes(mediaId), 'The main file must be attached.');
  let remix: string | null = null;
  if (data.remixDraftId != null) remix = JSON.stringify(d.remixProposal(text(data.remixDraftId, 'Draft',36,36), viewer, mediaId, offer.projectId));
  for (const file of files) ensure(!d.privateMedia(file) || (file === mediaId && remix !== null), 'Only the saved final remix can be shared, through its proposal.');
  if (data.publicationId != null) {
    ensure(data.remixDraftId == null, 'Choose one remix.');
    const publicationId = id(data.publicationId);
    const post = db.prepare('SELECT data FROM posts WHERE id=? AND owner=?').get(publicationId, viewer) as { data: string } | undefined;
    const value = post ? JSON.parse(post.data) : null;
    ensure(value?.remix && value.mediaId === mediaId && value.remix.projectId === offer.projectId, 'Choose your own remix of this project.');
    remix = JSON.stringify({ publicationId, title: value.title, originalTitle: value.remix.title, originalArtist: value.remix.artistName });
  }
  return { files, media: mediaId, text: text(data.text, 'Submission', 4000, 1), kind, remix };
  }
  function mediaUsed(media: string) { return !!db.prepare('SELECT 1 FROM collaboration_submissions WHERE media=? UNION ALL SELECT 1 FROM collaboration_files WHERE media=? LIMIT 1').get(media, media); }
  function canReadMedia(media: string, viewer: number | null) { return viewer !== null && !!db.prepare('SELECT 1 FROM collaboration_submissions s JOIN collaborations c ON c.id=s.thread WHERE (s.media=? OR EXISTS (SELECT 1 FROM collaboration_files f WHERE f.submission=s.id AND f.media=?)) AND (c.owner=? OR c.applicant=?)').get(media, media, viewer, viewer); }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const projects = /^\/api\/projects\/(\d+)\/offers$/.exec(url.pathname), offer = /^\/api\/offers\/(\d+)(\/conversations)?$/.exec(url.pathname), thread = /^\/api\/collaborations\/(\d+)(\/messages)?$/.exec(url.pathname);
    const notification = /^\/api\/notifications(?:\/(summary|read))?$/.exec(url.pathname);
    if (!projects && !offer && !thread && !notification && url.pathname !== '/api/collaborations') return false;
    if (projects && req.method === 'GET') { const projectId = id(Number(projects[1])); ensure(d.project(projectId, d.viewer(req)), 'Project not found.', 404); d.json(res, publicOffers(projectId, d.viewer(req))); return true; }
    const viewer = d.current(req, true).artistId!;
    ensure(d.isArtist(viewer), 'Artist account unavailable.', 403);
    if (notification) {
      if (req.method === 'GET' && notification[1] === 'summary') { d.json(res, alerts.summary(viewer)); return true; }
      if (req.method === 'GET' && !notification[1]) {
        d.json(res, alerts.list(viewer, id(Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER)))); return true;
      }
      if (req.method === 'PATCH' && notification[1] === 'read') {
        const data = await d.body(req), now = new Date().toISOString();
        d.rate(req, 'notifications', 120, 60, String(viewer));
        ensure((data.id === undefined) !== (data.throughId === undefined), 'Choose a notification or a read-through ID.');
        if (data.id !== undefined) alerts.read(viewer, id(data.id), now);
        else alerts.readThrough(viewer, id(data.throughId), now);
        d.json(res, alerts.summary(viewer)); return true;
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (url.pathname === '/api/collaborations' && req.method === 'GET') {
      const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER); id(before);
      const rows = db.prepare('SELECT * FROM collaborations WHERE (owner=? OR applicant=?) AND id<? ORDER BY id DESC LIMIT 31').all(viewer, viewer, before) as ThreadRow[];
      d.json(res, { items: rows.slice(0,30).map(row=>threadDto(row,viewer)), nextCursor: rows.length > 30 ? rows[29].id : null }); return true;
    }
    if (thread && req.method === 'GET' && !thread[2]) {
      const row = threadRow(id(Number(thread[1])), viewer), before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER); id(before);
      const messages = db.prepare('SELECT * FROM collaboration_messages WHERE thread=? AND id<? ORDER BY id DESC LIMIT 51').all(row.id, before) as { id: number; author: number; text: string; kind: string; created: string }[];
      const submissions = db.prepare('SELECT * FROM collaboration_submissions WHERE thread=? ORDER BY id DESC').all(row.id) as { id: number; media: string; text: string; kind: string; created: string; terms: string | null; remix: string | null }[];
      d.json(res, { ...threadDto(row,viewer), currentOffer: offerDto(offerRow(row.offer)), messages: messages.slice(0,50).reverse().map(m => ({ id: m.id, authorId: m.author, author: d.name(m.author), text: m.text, kind: m.kind, createdAt: m.created })), nextMessageCursor: messages.length > 50 ? messages[49].id : null,
        submissions: submissions.map(s => { const dto = (media: string) => { const m = d.media(media)!; return { id: m.id, name: m.name ?? `${m.kind}-${m.id}`, kind: m.kind, mime: m.mime, size: m.size, url: `/media/${m.id}` }; };
          const attached = db.prepare('SELECT media FROM collaboration_files WHERE submission=? ORDER BY position').all(s.id) as { media: string }[];
          const files = (attached.length ? attached : [{ media: s.media }]).map(file => dto(file.media)); return { id: s.id, text: s.text, kind: s.kind, createdAt: s.created, terms: s.terms ? JSON.parse(s.terms) : null, remix: s.remix ? JSON.parse(s.remix) : null, media: dto(s.media), files }; }) }); return true;
    }
    if (offer && offer[2] && req.method === 'GET') {
      const row=offerRow(id(Number(offer[1])));ensure(row.owner!==viewer,'You cannot apply to your own offer.');
      const existing=db.prepare('SELECT * FROM collaborations WHERE offer=? AND applicant=?').get(row.id,viewer) as ThreadRow|undefined;
      const value=offerDto(row);ensure(existing || value.available,'This offer is not accepting collaborators.',409);
      d.json(res,{offer:value,existing:existing?threadDto(existing,viewer):null});return true;
    }
    const data = await d.body(req);
    d.rate(req, 'collaborations', 60, 60, String(viewer));
    const now = new Date().toISOString();
    if (projects && req.method === 'POST') {
      const projectId = id(Number(projects[1])), project = ownedProject(projectId, viewer), value = input(data,projectId,viewer);
      ensure((db.prepare('SELECT COUNT(*) n FROM collaboration_offers WHERE project=?').get(projectId) as { n: number }).n < 50, 'A project can have up to 50 offers.');
      const result = db.prepare('INSERT INTO collaboration_offers(project,owner,title,data,created) VALUES(?,?,?,?,?)').run(projectId, viewer, project.title, JSON.stringify(value), now);
      d.json(res, offerDto(offerRow(Number(result.lastInsertRowid))), 201); return true;
    }
    if (offer) {
      const row = offerRow(id(Number(offer[1])));
      if (!offer[2] && req.method === 'PATCH') {
        ensure(row.owner === viewer, 'Offer not found.', 404); ownedProject(row.project, viewer);
        ensure(data.revision === row.revision, 'Offer changed. Reload before saving.', 409);
        const current = JSON.parse(row.data) as OfferInput;
        // Closing must remain possible after a deadline, without changing its terms.
        const value = data.action === 'close' ? { ...current, status: 'closed' } : input({...data,workId:Object.hasOwn(data,'workId')?data.workId:current.workId},row.project,viewer);
        ensure((current.workId??null)===(value.workId??null)||!db.prepare('SELECT 1 FROM collaborations WHERE offer=?').get(row.id),'This offer already has request history. Create a new offer to change its song.',409);
        ensure(value.status !== 'open' || !db.prepare("SELECT 1 FROM collaborations WHERE offer=? AND status IN ('accepted','delivered','completed')").get(row.id), 'This offer already has an accepted collaborator. Create a separate offer.', 409);
        transaction(() => {
          db.prepare('UPDATE collaboration_offers SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(value), row.id);
          const pending = db.prepare("SELECT * FROM collaborations WHERE offer=? AND status IN ('discussion','submitted','changes_requested')").all(row.id) as ThreadRow[];
          for (const item of pending) { db.prepare('UPDATE collaborations SET updated=? WHERE id=?').run(now,item.id); alerts.record(item.applicant, viewer, item.id, value.status === 'closed' ? 'offer_closed' : 'offer_updated', now); d.messages.activity('collaboration',item.id,viewer,'offer_updated',now); }
        });
        d.json(res, offerDto(offerRow(row.id))); return true;
      }
      if (offer[2] && req.method === 'POST') {
        ensure(row.owner!==viewer,'You cannot apply to your own offer.');
        ensure(d.isArtist(row.owner) && mayReceiveRequest('collaboration'),'This artist cannot receive the request.',404);
        const threadId=d.messages.operation(viewer,data.operationId,`offer:${row.id}:request`,data,()=>{
          const existing=db.prepare('SELECT id FROM collaborations WHERE offer=? AND applicant=?').get(row.id,viewer) as {id:number}|undefined;
          if(existing) return existing.id;
          const terms=offerDto(offerRow(row.id));ensure(terms.available,'This offer is not accepting collaborators.',409);
          ensure(data.offerRevision===terms.revision,'Terms changed. Review the current offer before submitting.',409);
          ensure(data.acceptTerms===true,'Confirm you have reviewed the offer terms.');
          const intro=text(data.introduction,'Introduction',4000,1), submission=submissionInput(data,viewer,terms,'proposal');
          const result=db.prepare("INSERT INTO collaborations(offer,owner,applicant,terms,status,updated,request_policy,admission) VALUES(?,?,?,?,'submitted',?,1,'pending')").run(row.id,row.owner,viewer,JSON.stringify(terms),now);
          const threadId=Number(result.lastInsertRowid);
          const saved=db.prepare('INSERT INTO collaboration_submissions(thread,media,text,kind,created,terms,remix) VALUES(?,?,?,?,?,?,?)').run(threadId,submission.media,submission.text,'proposal',now,JSON.stringify(terms),submission.remix);
          submission.files.forEach((file,position)=>db.prepare('INSERT INTO collaboration_files VALUES(?,?,?)').run(saved.lastInsertRowid,file,position));
          db.prepare("INSERT INTO collaboration_messages(thread,author,text,created,kind) VALUES(?,?,?,?,'request')").run(threadId,viewer,intro,now);
          d.messages.activity('collaboration',threadId,viewer,'request',now);
          alerts.record(row.owner,viewer,threadId,'submit',now);
          return threadId;
        });
        d.json(res,threadDto(threadRow(threadId,viewer),viewer),201);return true;
      }
    }

    if (thread) {
      const threadId=id(Number(thread[1]));
      const existing=threadRow(threadId,viewer);
      const mutate=<T>(suffix:string,change:()=>T) => existing.request_policy || data.operationId !== undefined
        ? d.messages.operation(viewer,data.operationId,`collaboration:${threadId}:${suffix}`,data,change) : transaction(change);
      if (thread[2] && req.method === 'POST') {
        mutate('message',()=>{
          const row=threadRow(threadId,viewer);
          ensure(!row.request_policy || row.admission==='accepted','This request does not allow messages.',409);
          const value=text(data.text,'Message',4000,1);
          db.prepare('INSERT INTO collaboration_messages(thread,author,text,created) VALUES(?,?,?,?)').run(row.id,viewer,value,now);
          db.prepare('UPDATE collaborations SET updated=? WHERE id=?').run(now,row.id);
          d.messages.activity('collaboration',row.id,viewer,'message',now);
          alerts.record(viewer===row.owner?row.applicant:row.owner,viewer,row.id,'message',now);
          return {ok:true};
        });
        d.json(res,{ok:true},201);return true;
      }
      if (!thread[2] && req.method === 'PATCH') {
        mutate('work',()=>{
        const row=threadRow(threadId,viewer);
        ensure(row.revision === data.revision, 'Collaboration changed. Reload before continuing.', 409);
        const action = text(data.action, 'Action', 30, 1), owner = row.owner === viewer, currentOffer = offerDto(offerRow(row.offer));
        let status: CollaborationStatus, terms = row.terms, submission: { files: string[]; media: string; text: string; kind: string; remix: string | null } | null = null;
        if (action === 'submit' || action === 'deliver') {
          ensure(!owner, 'Only the applicant can submit work.', 403);
          ensure(action === 'submit' ? ['discussion','changes_requested'].includes(row.status) : row.status === 'accepted', 'Work cannot be submitted at this stage.', 409);
          if (action === 'submit') { ensure(currentOffer.available, 'This offer is no longer open.', 409); ensure(data.offerRevision === currentOffer.revision, 'Terms changed. Review the current offer before submitting.', 409); ensure(data.acceptTerms === true, 'Confirm you have reviewed the offer terms.'); terms = JSON.stringify(currentOffer); }
          submission = submissionInput(data,viewer,currentOffer,action === 'submit' ? 'proposal' : 'delivery');
          status = action === 'submit' ? 'submitted' : 'delivered';
        } else if (action === 'withdraw') { ensure(!owner, 'Only the applicant can withdraw.', 403); ensure(['discussion','submitted','changes_requested'].includes(row.status), 'Accepted work cannot be withdrawn here.', 409); status = 'withdrawn'; }
        else {
          ensure(owner, 'Only the project owner can review work.', 403);
          if (action === 'accept') {
            ensure(row.status==='submitted' && currentOffer.available,'This proposal cannot be accepted.',409);
            const proposal=db.prepare("SELECT id FROM collaboration_submissions WHERE thread=? AND kind='proposal' ORDER BY id DESC LIMIT 1").get(row.id) as {id:number}|undefined;
            ensure(proposal,'A complete proposal is required.',409);
            if(row.request_policy) { ensure(row.admission==='pending','This request was already decided.',409);ensure(data.submissionId===proposal.id && data.offerRevision===currentOffer.revision && JSON.parse(row.terms).revision===currentOffer.revision,'Proposal or terms changed. Review the latest revision before accepting.',409); }
            status='accepted';
          }
          else if (action === 'reject') { ensure(['discussion','submitted','changes_requested'].includes(row.status), 'This proposal cannot be declined.', 409); status = 'rejected'; }
          else if (action === 'request_changes') { ensure(['submitted','delivered'].includes(row.status), 'There is no submission to revise.', 409); status = row.status === 'submitted' ? 'changes_requested' : 'accepted'; text(data.feedback, 'Revision feedback', 4000, 1); }
          else if (action === 'complete') { ensure(row.status === 'delivered', 'Review a delivery first.', 409); status = 'completed'; }
          else throw new HttpError(400, 'Unknown collaboration action.');
        }
        const response = action==='reject' ? text(data.response ?? '', 'Decline response',4000) : '';
        {
          if (action === 'accept') {
            ensure(!db.prepare("SELECT 1 FROM collaborations WHERE offer=? AND status IN ('accepted','delivered','completed')").get(row.offer), 'Another collaborator was already accepted.', 409);
            const offerData = JSON.parse(offerRow(row.offer).data); offerData.status = 'closed';
            db.prepare('UPDATE collaboration_offers SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(offerData), row.offer);
            const others = db.prepare("SELECT * FROM collaborations WHERE offer=? AND id<>? AND status IN ('discussion','submitted','changes_requested')").all(row.offer, row.id) as ThreadRow[];
            for (const other of others) { alerts.record(other.applicant, viewer, other.id, 'reject', now);d.messages.activity('collaboration',other.id,viewer,'reject',now); }
            db.prepare("UPDATE collaborations SET status='rejected',admission=CASE WHEN request_policy=1 THEN 'rejected' ELSE admission END,revision=revision+1,updated=? WHERE offer=? AND id<>? AND status IN ('discussion','submitted','changes_requested')").run(now, row.offer, row.id);
          }
          if (submission) {
            const saved = db.prepare('INSERT INTO collaboration_submissions(thread,media,text,kind,created,terms,remix) VALUES(?,?,?,?,?,?,?)').run(row.id, submission.media, submission.text, submission.kind, now, terms, submission.remix);
            submission.files.forEach((file, position) => db.prepare('INSERT INTO collaboration_files(submission,media,position) VALUES(?,?,?)').run(saved.lastInsertRowid, file, position));
          }
          if (action === 'request_changes') db.prepare("INSERT INTO collaboration_messages(thread,author,text,created,kind) VALUES(?,?,?,?,'revision')").run(row.id, viewer, text(data.feedback, 'Revision feedback', 4000, 1), now);
          if(response) db.prepare("INSERT INTO collaboration_messages(thread,author,text,created,kind) VALUES(?,?,?,?,'reject')").run(row.id,viewer,response,now);
          const admission=row.request_policy && ['accept','reject','withdraw'].includes(action) ? (action==='accept'?'accepted':action==='reject'?'rejected':'withdrawn') : row.admission;
          db.prepare('UPDATE collaborations SET status=?,admission=?,terms=?,revision=revision+1,updated=? WHERE id=?').run(status,admission,terms,now,row.id);
          d.messages.activity('collaboration',row.id,viewer,action,now);
          alerts.record(owner ? row.applicant : row.owner, viewer, row.id, action as CollaborationNotificationKind, now);
          return {ok:true};
        }
        });
        d.json(res,threadDto(threadRow(threadId,viewer),viewer));return true;
      }
    }
    throw new HttpError(405, 'Method not allowed.');
  }
  return { handle, publicOffers, opportunityProjects, mediaUsed, canReadMedia, authorize: threadRow };
}
