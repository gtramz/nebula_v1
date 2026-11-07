import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Project, SessionUser } from '../lib/local/src/types.js';
import type { CollaborationOffer, OfferInput, Collaboration, CollaborationStatus } from '../lib/local/src/collaborations.js';
import { isMoney } from '../lib/local/src/money.js';
import { ensure, id, object, text, HttpError } from './validation.js';
import { notifications } from './notifications.js';
import type { NotificationKind } from '../lib/local/src/notifications.js';

type OfferRow = { id: number; project: number; owner: number; title: string; data: string; revision: number; created: string };
type ThreadRow = { id: number; offer: number; owner: number; applicant: number; terms: string; status: CollaborationStatus; revision: number; updated: string };
type Dependencies = {
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
  const alerts = notifications(db, d.name);
  function transaction<T>(write: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = write(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function offerRow(offerId: number) { const row = db.prepare('SELECT * FROM collaboration_offers WHERE id=?').get(offerId) as OfferRow | undefined; ensure(row, 'Offer not found.', 404); return row; }
  function offerDto(row: OfferRow): CollaborationOffer {
    const data = JSON.parse(row.data) as OfferInput, project = d.project(row.project, null);
    return { ...data, id: row.id, projectId: row.project, ownerId: row.owner, projectTitle: project?.title ?? row.title, revision: row.revision, createdAt: row.created,
      available: !!project && project.status !== 'closed' && data.status === 'open' && (!data.deadline || data.deadline >= new Date().toISOString().slice(0,10)) };
  }
  function publicOffers(project: number, viewer: number | null) {
    const visible = d.project(project, viewer); if (!visible) return [];
    return (db.prepare('SELECT * FROM collaboration_offers WHERE project=? ORDER BY id DESC').all(project) as OfferRow[]).map(offerDto).filter(offer => visible.artistId === viewer || offer.available);
  }
  function ownedProject(project: number, viewer: number) { const value = d.project(project, viewer); ensure(value && value.artistId === viewer, 'Project not found.', 404); return value; }
  function input(value: unknown): OfferInput {
    const v = object(value), compensation = object(v.compensation);
    ensure(['Verse','Feature','Production','Mix','Master'].includes(String(v.need)), 'Choose a collaboration need.');
    ensure(v.status === 'open' || v.status === 'closed', 'Choose an offer status.');
    const deadline = v.deadline == null || v.deadline === '' ? null : text(v.deadline, 'Deadline', 10, 10);
    if (deadline) ensure(/^\d{4}-\d{2}-\d{2}$/.test(deadline) && Number.isFinite(Date.parse(deadline)) && new Date(deadline).toISOString().slice(0,10) === deadline && deadline >= new Date().toISOString().slice(0,10), 'Choose today or a future deadline (UTC).');
    ensure(compensation.kind === 'split' || compensation.kind === 'fee', 'Choose compensation.');
    if (compensation.kind === 'split') ensure(isMoney(compensation.percent, .01, 100), 'Royalty percentage must be 0.01–100 with at most two decimals.');
    else ensure(compensation.currency === 'USD' && isMoney(compensation.amount, .01, 1_000_000), 'Enter a USD fee of 0.01–1,000,000 with at most two decimals.');
    return { need: v.need as OfferInput['need'], deliverable: text(v.deliverable, 'Deliverable', 2000, 1), requirements: text(v.requirements, 'Requirements', 4000), deadline, status: v.status,
      compensation: compensation.kind === 'split' ? { kind: 'split', percent: compensation.percent as number } : { kind: 'fee', amount: compensation.amount as number, currency: 'USD' } };
  }
  function threadRow(threadId: number, viewer: number) {
    const row = db.prepare('SELECT * FROM collaborations WHERE id=? AND (owner=? OR applicant=?)').get(threadId, viewer, viewer) as ThreadRow | undefined;
    ensure(row, 'Collaboration not found.', 404); return row;
  }
  function threadDto(row: ThreadRow): Collaboration {
    const terms = JSON.parse(row.terms) as CollaborationOffer;
    return { id: row.id, offerId: row.offer, ownerId: row.owner, applicantId: row.applicant, ownerName: d.name(row.owner), applicantName: d.name(row.applicant), projectTitle: terms.projectTitle, terms, status: row.status, revision: row.revision, updatedAt: row.updated };
  }
  function mediaUsed(media: string) { return !!db.prepare('SELECT 1 FROM collaboration_submissions WHERE media=? UNION ALL SELECT 1 FROM collaboration_files WHERE media=? LIMIT 1').get(media, media); }
  function canReadMedia(media: string, viewer: number | null) { return viewer !== null && !!db.prepare('SELECT 1 FROM collaboration_submissions s JOIN collaborations c ON c.id=s.thread WHERE (s.media=? OR EXISTS (SELECT 1 FROM collaboration_files f WHERE f.submission=s.id AND f.media=?)) AND (c.owner=? OR c.applicant=?)').get(media, media, viewer, viewer); }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const projects = /^\/api\/projects\/(\d+)\/offers$/.exec(url.pathname), offer = /^\/api\/offers\/(\d+)(\/conversations)?$/.exec(url.pathname), thread = /^\/api\/collaborations\/(\d+)(\/messages)?$/.exec(url.pathname);
    const notification = /^\/api\/notifications(?:\/(summary|read))?$/.exec(url.pathname);
    if (!projects && !offer && !thread && !notification && url.pathname !== '/api/collaborations') return false;
    if (projects && req.method === 'GET') { const projectId = id(Number(projects[1])); ensure(d.project(projectId, d.viewer(req)), 'Project not found.', 404); d.json(res, publicOffers(projectId, d.viewer(req))); return true; }
    const viewer = d.current(req, true).artistId!;
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
      d.json(res, { items: rows.slice(0,30).map(threadDto), nextCursor: rows.length > 30 ? rows[29].id : null }); return true;
    }
    if (thread && req.method === 'GET' && !thread[2]) {
      const row = threadRow(id(Number(thread[1])), viewer), before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER); id(before);
      const messages = db.prepare('SELECT * FROM collaboration_messages WHERE thread=? AND id<? ORDER BY id DESC LIMIT 51').all(row.id, before) as { id: number; author: number; text: string; created: string }[];
      const submissions = db.prepare('SELECT * FROM collaboration_submissions WHERE thread=? ORDER BY id DESC').all(row.id) as { id: number; media: string; text: string; kind: string; created: string; terms: string | null; remix: string | null }[];
      d.json(res, { ...threadDto(row), currentOffer: offerDto(offerRow(row.offer)), messages: messages.slice(0,50).reverse().map(m => ({ id: m.id, authorId: m.author, author: d.name(m.author), text: m.text, createdAt: m.created })), nextMessageCursor: messages.length > 50 ? messages[49].id : null,
        submissions: submissions.map(s => { const dto = (media: string) => { const m = d.media(media)!; return { id: m.id, name: m.name ?? `${m.kind}-${m.id}`, kind: m.kind, mime: m.mime, size: m.size, url: `/media/${m.id}` }; };
          const attached = db.prepare('SELECT media FROM collaboration_files WHERE submission=? ORDER BY position').all(s.id) as { media: string }[];
          const files = (attached.length ? attached : [{ media: s.media }]).map(file => dto(file.media)); return { id: s.id, text: s.text, kind: s.kind, createdAt: s.created, terms: s.terms ? JSON.parse(s.terms) : null, remix: s.remix ? JSON.parse(s.remix) : null, media: dto(s.media), files }; }) }); return true;
    }
    const data = await d.body(req);
    d.rate(req, 'collaborations', 60, 60, String(viewer));
    const now = new Date().toISOString();
    if (projects && req.method === 'POST') {
      const projectId = id(Number(projects[1])), project = ownedProject(projectId, viewer), value = input(data);
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
        const value = data.action === 'close' ? { ...current, status: 'closed' } : input(data);
        ensure(value.status !== 'open' || !db.prepare("SELECT 1 FROM collaborations WHERE offer=? AND status IN ('accepted','delivered','completed')").get(row.id), 'This offer already has an accepted collaborator. Create a separate offer.', 409);
        transaction(() => {
          db.prepare('UPDATE collaboration_offers SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(value), row.id);
          const pending = db.prepare("SELECT * FROM collaborations WHERE offer=? AND status IN ('discussion','submitted','changes_requested')").all(row.id) as ThreadRow[];
          for (const item of pending) alerts.record(item.applicant, viewer, item.id, value.status === 'closed' ? 'offer_closed' : 'offer_updated', now);
        });
        d.json(res, offerDto(offerRow(row.id))); return true;
      }
      if (offer[2] && req.method === 'POST') {
        ensure(row.owner !== viewer, 'You cannot apply to your own offer.');
        const existing = db.prepare('SELECT * FROM collaborations WHERE offer=? AND applicant=?').get(row.id, viewer) as ThreadRow | undefined;
        if (existing) { d.json(res, threadDto(existing)); return true; }
        const terms = offerDto(row); ensure(terms.available, 'This offer is not accepting collaborators.', 409);
        const threadId = transaction(() => {
          const result = db.prepare('INSERT INTO collaborations(offer,owner,applicant,terms,updated) VALUES(?,?,?,?,?)').run(row.id, row.owner, viewer, JSON.stringify(terms), now);
          const threadId = Number(result.lastInsertRowid);
          alerts.record(row.owner, viewer, threadId, 'contact', now); return threadId;
        });
        d.json(res, threadDto(threadRow(threadId, viewer)), 201); return true;
      }
    }
    if (thread) {
      const row = threadRow(id(Number(thread[1])), viewer);
      if (thread[2] && req.method === 'POST') {
        const value = text(data.text, 'Message', 4000, 1);
        transaction(() => {
          db.prepare('INSERT INTO collaboration_messages(thread,author,text,created) VALUES(?,?,?,?)').run(row.id, viewer, value, now);
          db.prepare('UPDATE collaborations SET updated=? WHERE id=?').run(now, row.id);
          alerts.record(viewer === row.owner ? row.applicant : row.owner, viewer, row.id, 'message', now);
        });
        d.json(res, { ok: true }, 201); return true;
      }
      if (!thread[2] && req.method === 'PATCH') {
        ensure(row.revision === data.revision, 'Collaboration changed. Reload before continuing.', 409);
        const action = text(data.action, 'Action', 30, 1), owner = row.owner === viewer, currentOffer = offerDto(offerRow(row.offer));
        let status: CollaborationStatus, terms = row.terms, submission: { files: string[]; media: string; text: string; kind: string; remix: string | null } | null = null;
        if (action === 'submit' || action === 'deliver') {
          ensure(!owner, 'Only the applicant can submit work.', 403);
          ensure(action === 'submit' ? ['discussion','changes_requested'].includes(row.status) : row.status === 'accepted', 'Work cannot be submitted at this stage.', 409);
          if (action === 'submit') { ensure(currentOffer.available, 'This offer is no longer open.', 409); ensure(data.offerRevision === currentOffer.revision, 'Terms changed. Review the current offer before submitting.', 409); ensure(data.acceptTerms === true, 'Confirm you have reviewed the offer terms.'); terms = JSON.stringify(currentOffer); }
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
          if (data.publicationId != null) {
            const publicationId = id(data.publicationId);
            const post = db.prepare('SELECT data FROM posts WHERE id=? AND owner=?').get(publicationId, viewer) as { data: string } | undefined;
            const value = post ? JSON.parse(post.data) : null;
            ensure(value?.remix && value.mediaId === mediaId && value.remix.projectId === currentOffer.projectId, 'Choose your own remix of this project.');
            remix = JSON.stringify({ publicationId, title: value.title, originalTitle: value.remix.title, originalArtist: value.remix.artistName });
          }
          submission = { files, media: mediaId, text: text(data.text, 'Submission', 4000, 1), kind: action === 'submit' ? 'proposal' : 'delivery', remix };
          status = action === 'submit' ? 'submitted' : 'delivered';
        } else if (action === 'withdraw') { ensure(!owner, 'Only the applicant can withdraw.', 403); ensure(['discussion','submitted','changes_requested'].includes(row.status), 'Accepted work cannot be withdrawn here.', 409); status = 'withdrawn'; }
        else {
          ensure(owner, 'Only the project owner can review work.', 403);
          if (action === 'accept') { ensure(row.status === 'submitted' && currentOffer.available, 'This proposal cannot be accepted.', 409); status = 'accepted'; }
          else if (action === 'reject') { ensure(['discussion','submitted','changes_requested'].includes(row.status), 'This proposal cannot be declined.', 409); status = 'rejected'; }
          else if (action === 'request_changes') { ensure(['submitted','delivered'].includes(row.status), 'There is no submission to revise.', 409); status = row.status === 'submitted' ? 'changes_requested' : 'accepted'; text(data.feedback, 'Revision feedback', 4000, 1); }
          else if (action === 'complete') { ensure(row.status === 'delivered', 'Review a delivery first.', 409); status = 'completed'; }
          else throw new HttpError(400, 'Unknown collaboration action.');
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          if (action === 'accept') {
            ensure(!db.prepare("SELECT 1 FROM collaborations WHERE offer=? AND status IN ('accepted','delivered','completed')").get(row.offer), 'Another collaborator was already accepted.', 409);
            const offerData = JSON.parse(offerRow(row.offer).data); offerData.status = 'closed';
            db.prepare('UPDATE collaboration_offers SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(offerData), row.offer);
            const others = db.prepare("SELECT * FROM collaborations WHERE offer=? AND id<>? AND status IN ('discussion','submitted','changes_requested')").all(row.offer, row.id) as ThreadRow[];
            for (const other of others) alerts.record(other.applicant, viewer, other.id, 'reject', now);
            db.prepare("UPDATE collaborations SET status='rejected',revision=revision+1,updated=? WHERE offer=? AND id<>? AND status IN ('discussion','submitted','changes_requested')").run(now, row.offer, row.id);
          }
          if (submission) {
            const saved = db.prepare('INSERT INTO collaboration_submissions(thread,media,text,kind,created,terms,remix) VALUES(?,?,?,?,?,?,?)').run(row.id, submission.media, submission.text, submission.kind, now, terms, submission.remix);
            submission.files.forEach((file, position) => db.prepare('INSERT INTO collaboration_files(submission,media,position) VALUES(?,?,?)').run(saved.lastInsertRowid, file, position));
          }
          if (action === 'request_changes') db.prepare('INSERT INTO collaboration_messages(thread,author,text,created) VALUES(?,?,?,?)').run(row.id, viewer, text(data.feedback, 'Revision feedback', 4000, 1), now);
          db.prepare('UPDATE collaborations SET status=?,terms=?,revision=revision+1,updated=? WHERE id=?').run(status, terms, now, row.id);
          alerts.record(owner ? row.applicant : row.owner, viewer, row.id, action as NotificationKind, now);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        d.json(res, threadDto(threadRow(row.id, viewer))); return true;
      }
    }
    throw new HttpError(405, 'Method not allowed.');
  }
  return { handle, publicOffers, mediaUsed, canReadMedia };
}
