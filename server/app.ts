import { works } from './works.js';
import { musicalProject } from '../lib/local/src/works.js';
import { messageStorage } from './message-storage.js';
import { messages } from './messages.js';
import { notifications } from './notifications.js';
import { transaction } from './transaction.js';
import { follows } from './follows.js';
import { createHomeCursorCodec, pageHomeProjects } from './project-browser.js';
import { buildHomeAffinitySignals, rankHomeProjects } from './home-affinity.js';
import type { HomeForYouSummary } from '../lib/local/src/opportunities.js';
import { filterOpportunityProjects, opportunitySuggestions, homeFacetOptions, normalizeHomeFilters, emptyHomeFilters, opportunityNeeds, projectTypes, type HomeSearch } from '../lib/local/src/opportunity-search.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, readdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { createLocalStore } from '../lib/local/src/store.js';
import { parseState } from '../lib/local/src/state.js';
import type { ProjectInput, SessionUser } from '../lib/local/src/types.js';
import type { Publication, PublicationInput, UploadedMedia } from '../lib/local/src/publications.js';
import { waveforms } from './waveforms.js';
import { remixDrafts } from './remix-drafts.js';
import { remixes, type StoredPublication } from './remixes.js';
import { collaborations } from './collaborations.js';
import { rankPosts, type RankCandidate } from './ranking.js';
import { ensure, HttpError, object, text, id, bool, credentials, profile, project, sniffMedia } from './validation.js';

type MediaRow = { id: string; owner: number; name?: string; kind: UploadedMedia['kind']; mime: string; size: number; created: number };
type PostRow = { id: number; owner: number; data: string; revision: number; created: string; updated: string };
const SESSION_AGE = 7 * 24 * 60 * 60;
const LIMIT = 100 * 1024 * 1024;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function createNebulaServer(options: { dataDir: string; publicDir: string; origin?: string; maxStorageBytes?: number }) {
  const homeCursors = createHomeCursorCodec();
  const directory = resolve(options.dataDir), mediaDirectory = join(directory, 'media');
  await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'nebula.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS posts_owner ON posts(owner);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS stars (post INTEGER NOT NULL, account INTEGER NOT NULL, PRIMARY KEY(post,account));
    CREATE TABLE IF NOT EXISTS saves (post INTEGER NOT NULL, account INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(post,account));
    CREATE INDEX IF NOT EXISTS saves_account ON saves(account,created);
    CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post INTEGER NOT NULL, account INTEGER NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS comments_post ON comments(post,id);
    CREATE TABLE IF NOT EXISTS feed_snapshots (token TEXT PRIMARY KEY, ids TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset INTEGER NOT NULL);`);
  if (!(db.prepare('PRAGMA table_info(media)').all() as { name: string }[]).some(column => column.name === 'name')) db.exec('ALTER TABLE media ADD COLUMN name TEXT');
  const stored = db.prepare('SELECT value FROM state WHERE id=1').get() as { value: string } | undefined;
  if (stored) parseState(stored.value); // Never replace a damaged database with an empty one.
  // Recover uploads interrupted before their metadata committed. Keep referenced files.
  for (const file of await readdir(mediaDirectory)) {
    if ((file.endsWith('.part') || /^[a-f0-9-]{36}$/.test(file)) && !db.prepare('SELECT id FROM media WHERE id=?').get(file)) await unlink(join(mediaDirectory, file));
  }
  const emptyState = JSON.stringify({ version: 3, nextId: 1, currentAccountId: null, accounts: [], artists: [], projects: [], investments: [], supports: [], visibility: [] });
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = queue.then(fn); queue = result.catch(() => {}); return result;
  }
  function domain(account: number | null) {
    return createLocalStore({
      getItem: () => (db.prepare('SELECT value FROM state WHERE id=1').get() as { value: string } | undefined)?.value ?? emptyState,
      setItem: (_key, value) => { const data = parseState(value); data.currentAccountId = null; db.prepare('INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(data)); },
    }, { getItem: () => account === null ? null : String(account), setItem: (_key, value) => { account = Number(value) || null; } }, 600_000);
  }
  function accountId(req: IncomingMessage) {
    const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('nebula_session='))?.slice(15);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = db.prepare('SELECT account FROM sessions WHERE token=? AND expires>?').get(digest(token), Date.now()) as { account: number } | undefined;
    return session?.account ?? null;
  }
  function current(req: IncomingMessage, artistOnly = false): SessionUser {
    const user = domain(accountId(req)).getCurrentUser();
    ensure(user, 'Log in to continue.', 401);
    ensure(!artistOnly || user.role === 'artist', 'This action requires an artist account.', 403);
    return user;
  }
  function mediaRow(mediaId: string): MediaRow | undefined { return db.prepare('SELECT * FROM media WHERE id=?').get(mediaId) as MediaRow | undefined; }
  const songStore = works(db, (id, viewer) => domain(viewer).getProject(id)?.project ?? null);
  const mediaDto = (row: MediaRow): UploadedMedia => ({ id: row.id, name: row.name ?? `${row.kind}-${row.id}`, kind: row.kind, mime: row.mime, size: row.size, url: `/media/${row.id}` });
  const remixStore = remixes(db, owner => domain(null).getArtist(owner)?.artist.name ?? 'Artist');
  function postDto(row: PostRow, viewer: number | null): Publication {
    const data = JSON.parse(row.data) as StoredPublication;
    const store = domain(viewer), artist = store.getArtist(row.owner)?.artist;
    const media = mediaRow(data.mediaId)!;
    return { ...data, remix: remixStore.credit(data.remix), id: row.id, artistId: row.owner, artistName: artist?.name ?? 'Artist', artistPicture: artist?.picture ?? null,
      media: mediaDto(media), coverUrl: data.coverId ? `/media/${data.coverId}` : null,
      project: data.projectId ? store.getProject(data.projectId)?.project ?? null : null,
      ...(data.workId ? { song: data.projectId ? songStore.linked(data.projectId,data.workId,viewer) : null } : {}),
      offers: data.projectId ? collaboration.publicOffers(data.projectId, viewer) : [],
      createdAt: row.created, updatedAt: row.updated, revision: row.revision, social: social(row.id, viewer) };
  }
  function social(post: number, viewer: number | null) {
    return {
      stars: (db.prepare('SELECT COUNT(*) AS count FROM stars WHERE post=?').get(post) as { count: number }).count,
      comments: (db.prepare('SELECT COUNT(*) AS count FROM comments WHERE post=?').get(post) as { count: number }).count,
      starred: viewer !== null && !!db.prepare('SELECT 1 FROM stars WHERE post=? AND account=?').get(post, viewer),
      saved: viewer !== null && !!db.prepare('SELECT 1 FROM saves WHERE post=? AND account=?').get(post, viewer),
    };
  }
  function readablePost(post: number, viewer: number | null, publishedOnly = false) {
    const row = db.prepare('SELECT * FROM posts WHERE id=?').get(post) as PostRow | undefined;
    ensure(row && (JSON.parse(row.data).status === 'published' || (!publishedOnly && row.owner === viewer)), 'Publication not found.', 404);
    return row;
  }
  function publicationInput(value: unknown, owner: number): PublicationInput {
    const data = object(value);
    const mediaId = text(data.mediaId, 'Media', 36, 36), media = mediaRow(mediaId);
    ensure(media && media.owner === owner && !drafts.isPrivate(mediaId) && ['audio','video'].includes(media.kind), 'Choose your own uploaded audio or video.');
    const coverId = data.coverId == null ? null : text(data.coverId, 'Cover', 36, 36);
    if (coverId) { const cover = mediaRow(coverId); ensure(cover && cover.owner === owner && !drafts.isPrivate(coverId) && cover.kind === 'image', 'Choose your own cover image.'); }
    const projectId = data.projectId == null ? null : id(data.projectId);
    ensure(['draft', 'published', 'withdrawn'].includes(String(data.status)), 'Choose a publication status.');
    if (projectId) {
      const linked = domain(owner).getProject(projectId)?.project;
      ensure(linked && linked.artistId === owner, 'Link one of your available projects.');
      ensure(data.status !== 'published' || linked.status !== 'draft', 'Publish the project before linking it to a public post.');
    }
    const song = songStore.validateLink(projectId,data.workId,owner);
    return { ...(song ? {workId:song.id} : {}), title: text(data.title, 'Title', 160, 1), description: text(data.description, 'Description', 2000),
      mediaId, coverId, projectId, allowRemix: bool(data.allowRemix), status: data.status as PublicationInput['status'] };
  }
  function rateLimit(req: IncomingMessage, name: string, limit: number, seconds: number, identity?: string) {
    const key = digest(`${name}:${identity ?? req.socket.remoteAddress ?? 'unknown'}`);
    const now = Date.now();
    db.prepare('DELETE FROM rate_limits WHERE reset<?').run(now);
    const row = db.prepare('SELECT hits,reset FROM rate_limits WHERE key=?').get(key) as { hits: number; reset: number } | undefined;
    ensure(!row || row.hits < limit, 'Too many attempts. Please try again later.', 429);
    db.prepare('INSERT INTO rate_limits(key,hits,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1').run(key, now + seconds * 1000);
  }
  function json(res: ServerResponse, value: unknown, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
  }
  async function body(req: IncomingMessage) {
    ensure(req.headers['content-type']?.split(';')[0] === 'application/json', 'Send JSON.', 415);
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; ensure(size <= 1_500_000, 'Request too large.', 413); chunks.push(chunk); }
    try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON.'); }
  }
  function session(req: IncomingMessage, res: ServerResponse, user: SessionUser | null) {
    const old = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('nebula_session='))?.slice(15);
    if (old) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(old));
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    const token = user ? randomBytes(32).toString('hex') : '';
    if (user) db.prepare('INSERT INTO sessions(token,account,expires) VALUES(?,?,?)').run(digest(token), user.artistId ?? user.investorId!, Date.now() + SESSION_AGE * 1000);
    res.setHeader('Set-Cookie', `nebula_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${user ? SESSION_AGE : 0}${options.origin?.startsWith('https:') ? '; Secure' : ''}`);
  }
  async function rpc(req: IncomingMessage, res: ServerResponse) {
    const data = await body(req);
    const method = text(data.method, 'Method', 60, 1);
    ensure(Array.isArray(data.args) && data.args.length <= 2, 'Invalid arguments.');
    const args = data.args;
    if (['register', 'login'].includes(method)) rateLimit(req, 'auth', 30, 15 * 60);
    await serial(async () => {
      const store = domain(accountId(req));
      let result: unknown;
      switch (method) {
        case 'register': {
          const input = object(args[0]);
          ensure(input.role === 'artist' || input.role === 'investor', 'Choose an artist or investor account.');
          const identity = credentials(input, true);
          const transferred = input.profile == null ? null : profile(input.profile);
          // Validate the optional transferred profile before creating the account.
          if (transferred?.picture) ensure(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(transferred.picture), 'Invalid profile image.');
          try { result = await store.register({ ...identity, role: input.role, name: text(input.name, 'Name', 120, 2) }); }
          catch (error) { if (error instanceof Error && error.message.includes('already exists')) throw new HttpError(409, 'An account with this email already exists on this server. Log in instead.'); throw error; }
          if (input.role === 'artist' && transferred) store.updateArtist(transferred);
          result = store.getCurrentUser(); session(req, res, result as SessionUser); break;
        }
        case 'login': {
          const input = credentials(args[0]);
          rateLimit(req, 'email-auth', 15, 15 * 60, input.email);
          try { result = await store.login(input); }
          catch { throw new HttpError(401, 'Email or password is incorrect. If this is a browser-only account, transfer it using the option below.'); }
          session(req, res, result as SessionUser); break;
        }
        case 'logout': store.logout(); session(req, res, null); result = null; break;
        case 'listProjects': { const input = object(args[0] ?? {}); result = store.listProjects({ category: input.category == null ? undefined : text(input.category, 'Category', 60), search: input.search == null ? undefined : text(input.search, 'Search', 200), status: input.status == null ? undefined : text(input.status, 'Status', 20) }); break; }
        case 'listArtists': { const input = object(args[0] ?? {}); result = store.listArtists({ search: input.search == null ? undefined : text(input.search, 'Search', 200) }); break; }
        case 'getProject': result = store.getProject(id(args[0])); break;
        case 'getArtist': result = store.getArtist(id(args[0])); break;
        case 'getPublicArtist': {
          const detail = store.getPublicArtist(id(args[0]));
          result = detail ? { ...detail, opportunityProjectIds: detail.projects.filter(p => p.status === 'funding' || collaboration.publicOffers(p.id, null).some(offer => offer.available)).map(p => p.id) } : null;
          break;
        }
        case 'listMyInvestments': current(req); result = store.listMyInvestments(); break;
        case 'listReceivedInvestments': current(req, true); result = store.listReceivedInvestments(); break;
        case 'getInvestment': current(req); result = store.getInvestment(id(args[0])); break;
        case 'listAuthEvents': current(req); result = store.listAuthEvents(); break;
        case 'updateArtist': current(req, true); result = store.updateArtist(profile(args[0])); break;
        case 'getMyArtistOnboarding': {
          current(req, true); ensure(args.length === 0, 'This operation only reads your own onboarding.');
          result = store.getMyArtistOnboarding(); break;
        }
        case 'updateArtistIdentity': {
          current(req, true); ensure(args.length === 1, 'Provide only your identity changes.');
          const input = object(args[0]);
          ensure(Object.keys(input).every(key => ['profile','preferences','onboarding','expected'].includes(key)), 'Unsupported artist identity field.');
          let patch;
          if (input.profile !== undefined) {
            const fields = object(input.profile);
            // Reuse profile validation without making an unchanged name part of the patch.
            const validated = profile({ name: store.getCurrentUser()!.name, ...fields });
            const { name, ...rest } = validated;
            patch = Object.hasOwn(fields, 'name') ? { name, ...rest } : rest;
          }
          result = store.updateArtistIdentity({ ...input, ...(patch !== undefined ? { profile: patch } : {}) }); break;
        }
        case 'getMyArtistPreferences': {
          current(req, true); ensure(args.length === 0, 'This operation only reads your own preferences.');
          result = store.getMyArtistPreferences(); break;
        }
        case 'updateMyArtistPreferences': {
          current(req, true); ensure(args.length === 1, 'Provide only your preference changes.');
          result = store.updateMyArtistPreferences(object(args[0])); break;
        }
        case 'createProject': {
          const owner=current(req,true).artistId!, raw=object(args[0]);
          ensure(raw.songs===undefined || (typeof raw.operationId==='string' && raw.operationId.length>=16),'Provide an operation ID when creating a project with songs.');
          const create=()=>{const created=store.createProject(project(raw) as unknown as ProjectInput);if(raw.songs!==undefined)songStore.save(created.id,owner,{revision:0,songs:raw.songs});return created;};
          result=raw.operationId ? transaction(db,()=>songStore.operation(owner,raw.operationId,'project:create',raw,create)) : transaction(db,create);break;
        }
        case 'updateProject': {
          const owner = current(req, true).artistId;
          ensure(store.getProject(id(args[0]))?.project.artistId === owner, 'Project not found.', 404);
          const raw=object(args[1]), existing=store.getProject(id(args[0]))!.project;
          const changes=project(raw);
          if(raw.expected!==undefined){const expected=object(raw.expected);for(const key of Object.keys(changes))ensure(JSON.stringify((existing as unknown as Record<string,unknown>)[key]??null)===JSON.stringify(expected[key]??null),'Project changed in another tab. Reload and review your draft.',409);}
          if(changes.category!==undefined && !musicalProject(String(changes.category)))ensure(!songStore.list(existing.id,owner!).songs.length,'Remove unreferenced songs before changing to a non-musical format.',409);
          result = store.updateProject(id(args[0]), changes); break;
        }
        case 'deleteProject': {
          const owner = current(req, true).artistId;
          ensure(store.getProject(id(args[0]))?.project.artistId === owner, 'Project not found.', 404);
          store.deleteProject(id(args[0])); result = null; break;
        }
        case 'toggleProjectSupport': current(req, true); result = store.toggleProjectSupport(id(args[0])); break;
        case 'createInvestment': {
          current(req); const input = object(args[0]); ensure(typeof input.amount === 'number', 'Enter an amount.');
          const visibility = input.publicVisibility == null ? undefined : object(input.publicVisibility);
          result = store.createInvestment({ projectId: id(input.projectId), amount: input.amount, publicVisibility: visibility ? { showName: bool(visibility.showName), showAmount: bool(visibility.showAmount) } : undefined }); break;
        }
        case 'updateProjectVisibility': {
          current(req); const input = object(args[1]); result = store.updateProjectVisibility(id(args[0]), { showName: bool(input.showName), showAmount: bool(input.showAmount) }); break;
        }
        default: throw new HttpError(404, 'Unknown operation.');
      }
      json(res, { result: result ?? null, user: store.getCurrentUser() });
    }).catch(error => {
      // Domain validation messages are safe, unlike storage or unexpected failures.
      if (error instanceof Error && error.constructor === Error && !('code' in error)) throw new HttpError(400, error.message);
      throw error;
    });
  }
  const drafts = remixDrafts({ db, current, body, json, media: key => { const row = mediaRow(key); return row ? { ...mediaDto(row), owner: row.owner } : undefined; }, name: owner => domain(null).getArtist(owner)?.artist.name ?? 'Artist' });
  const publicActor = (id: number) => { const user = domain(id).getCurrentUser(); return user?.role === 'artist' && user.artistId === id ? domain(null).getArtist(id)?.artist : undefined; };
  const messageStore = messageStorage(db);
  const alerts = notifications(db, publicActor, (id,viewer)=>!!db.prepare('SELECT 1 FROM artist_conversations WHERE id=? AND (sender=? OR recipient=?)').get(id,viewer,viewer));
  const collaboration = collaborations({ songs:songStore, alerts, messages: messageStore, isArtist: id=>!!publicActor(id), db, current, viewer: accountId, body, json, rate: rateLimit, privateMedia: drafts.isPrivate, remixProposal: drafts.proposal,
    project: (id, viewer) => domain(viewer).getProject(id)?.project ?? null,
    name: id => domain(id).getCurrentUser()?.name ?? 'Artist', media: mediaRow });
  const messageService = messages({db,store:messageStore,alerts,current,body,json,rate:rateLimit,artist:publicActor,project:id=>domain(null).getProject(id)?.project ?? null,collaboration});
  const followStore = follows(db, publicActor);
  const waveformStore = waveforms(directory, mediaDirectory);
  const uploads = new Set<number>();
  async function upload(req: IncomingMessage, res: ServerResponse) {
    const owner = current(req, true).artistId!;
    const draftId = req.headers['x-remix-draft'];
    if (draftId !== undefined) { ensure(typeof draftId === 'string', 'Invalid draft.'); drafts.authorizeUpload(draftId, owner); }
    ensure(!uploads.has(owner), 'Another upload is in progress.', 409);
    rateLimit(req, 'uploads', 60, 3600, String(owner));
    const requested = req.headers['x-media-kind'];
    ensure(['audio', 'video', 'image', 'document', 'archive'].includes(String(requested)), 'Choose audio, video, a cover, PDF or ZIP.');
    const limit = requested === 'image' ? 5 * 1024 * 1024 : requested === 'document' ? 20 * 1024 * 1024 : LIMIT;
    let filename = '';
    try { filename = decodeURIComponent(String(req.headers['x-file-name'] ?? '')); } catch { throw new HttpError(400, 'Invalid file name.'); }
    filename = Array.from(filename.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 180).join('');
    const length = Number(req.headers['content-length']);
    ensure(Number.isSafeInteger(length) && length > 0 && length <= limit, `File exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`, 413);
    const total = (db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM media').get() as { bytes: number }).bytes;
    const owned = (db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM media WHERE owner=?').get(owner) as { bytes: number }).bytes;
    ensure(owned + length <= 1024 ** 3 && total + length <= (options.maxStorageBytes ?? 5 * 1024 ** 3), 'Storage limit reached. Remove unused uploads or contact the operator.', 413);
    const mediaId = randomUUID(), temporary = join(mediaDirectory, `${mediaId}.part`), destination = join(mediaDirectory, mediaId);
    uploads.add(owner);
    let committed = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      let size = 0, header = Buffer.alloc(0);
      try {
        for await (const chunk of req) {
          size += chunk.length; ensure(size <= limit, 'File too large.', 413);
          if (header.length < 512) header = Buffer.concat([header, chunk]).subarray(0, 512);
          await file.writeFile(chunk);
        }
        ensure(size === length && size >= 16, 'Upload was incomplete.');
        await file.sync();
      } finally { await file.close(); }
      const detected = sniffMedia(header);
      ensure(detected && detected.kind === requested, 'Unsupported file. Use MP4/WebM video, MP3/WAV/OGG audio, PNG/JPEG/WebP covers, PDF documents or ZIP archives.', 415);
      await rename(temporary, destination);
      const row = { id: mediaId, owner, ...detected, name: filename || `${detected.kind}-${mediaId}`, size, created: Date.now() };
      // Recheck total after asynchronous file writes to enforce the global limit.
      const latestTotal = (db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM media').get() as { bytes: number }).bytes;
      ensure(latestTotal + size <= (options.maxStorageBytes ?? 5 * 1024 ** 3), 'Server storage is full.', 413);
      if (draftId) { ensure(current(req, true).artistId === owner, 'Session expired.', 401); drafts.authorizeUpload(draftId as string, owner); }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO media(id,owner,kind,mime,size,created,name) VALUES(?,?,?,?,?,?,?)').run(row.id, owner, row.kind, row.mime, size, row.created, row.name);
        if (draftId) drafts.bind(row.id, draftId as string, owner);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      committed = true; json(res, mediaDto(row), 201);
    } finally {
      uploads.delete(owner);
      if (!committed) { await unlink(temporary).catch(() => {}); await unlink(destination).catch(() => {}); }
    }
  }
  async function sendFile(req: IncomingMessage, res: ServerResponse, path: string, mime: string, privateFile = false) {
    const info = await stat(path);
    ensure(info.isFile(), 'Not found.', 404);
    const range = req.headers.range;
    let start = 0, end = info.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${info.size}`); throw new HttpError(416, 'Invalid range.'); }
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
      if (start > end || start >= info.size || !Number.isSafeInteger(start)) { res.setHeader('Content-Range', `bytes */${info.size}`); throw new HttpError(416, 'Invalid range.'); }
      res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    res.writeHead(range ? 206 : 200, { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': privateFile ? 'private, no-store' : 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const address = server.address();
      const origin = options.origin ?? `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4174}`;
      ensure(req.headers.host === new URL(origin).host, 'Unexpected host.', 403);
      const url = new URL(req.url ?? '/', origin);
      if (!['GET', 'HEAD'].includes(req.method ?? '')) {
        ensure(req.headers.origin === origin && req.headers['x-nebula-request'] === '1', 'Request origin is not allowed.', 403);
      }
      if (url.pathname === '/api/session' && req.method === 'GET') { json(res, { user: domain(accountId(req)).getCurrentUser() }); return; }
      if (url.pathname === '/api/rpc' && req.method === 'POST') { await rpc(req, res); return; }
      const followMatch = /^\/api\/artists\/(\d+)\/(social|followers|following|follow)$/.exec(url.pathname);
      if (followMatch) {
        const target = id(Number(followMatch[1])), operation = followMatch[2];
        if (operation === 'follow') {
          ensure(req.method === 'PUT' || req.method === 'DELETE', 'Method not allowed.', 405);
          const viewer = current(req,true).artistId!;
          rateLimit(req,'artist-follow',120,60,String(viewer));
          const summary = transaction(db, () => {
            const transition = followStore.change(viewer,target,req.method === 'PUT');
            if (transition.event) alerts.recordFollow(transition.event);
            return transition.summary;
          });
          json(res,summary); return;
        }
        ensure(req.method === 'GET', 'Method not allowed.', 405);
        const viewer = accountId(req);
        if (operation === 'social') { json(res,followStore.summary(target,viewer)); return; }
        const before = url.searchParams.has('before') ? id(Number(url.searchParams.get('before'))) : Number.MAX_SAFE_INTEGER;
        json(res,followStore.list(target,operation as 'followers'|'following',viewer,before)); return;
      }
      if (['/api/opportunities/projects', '/api/opportunities/suggestions'].includes(url.pathname)) {
        ensure(req.method === 'GET', 'Method not allowed.', 405);
        const before = url.searchParams.has('before') ? id(Number(url.searchParams.get('before'))) : Number.MAX_SAFE_INTEGER;
        const category = url.searchParams.has('category') ? text(url.searchParams.get('category'), 'Category', 60) : 'all';
        const search: HomeSearch = { q: url.searchParams.has('q') ? text(url.searchParams.get('q'), 'Search', 200) : '', criteria: {} };
        for (const key of ['genre', 'need', 'compensation', 'opportunity', 'projectType'] as const) {
          if (!url.searchParams.has(key)) continue;
          const value = text(url.searchParams.get(key), key, key === 'genre' ? 200 : 60, 1);
          const allowed: Record<string, readonly string[]> = { need: opportunityNeeds, compensation: ['split', 'fee'], opportunity: ['funding'], projectType: projectTypes };
          ensure(key === 'genre' || allowed[key].includes(value), 'Invalid search criterion.');
          Object.assign(search.criteria, { [key]: value });
        }
        const mode = url.searchParams.get('mode') ?? 'for-you';
        ensure(mode === 'for-you' || mode === 'recent' || mode === 'following', 'Unsupported Home mode.');
        ensure(mode !== 'recent' || !url.searchParams.has('before'), 'Use the Home cursor for Recently created.');
        const filters = emptyHomeFilters();
        for (const field of Object.keys(filters) as (keyof typeof filters)[]) {
          const values = url.searchParams.getAll(field); ensure(values.length <= 50, 'Too many filter values.');
          for (const value of values) {
            text(value, field, field === 'artistGenres' ? 200 : 60, 1);
            if (field === 'participation') ensure([...opportunityNeeds, 'Funding'].includes(value), 'Unsupported participation type.');
            if (field === 'compensationKinds') ensure(['fee','split'].includes(value), 'Unsupported compensation type.');
          }
          Object.assign(filters, { [field]: values });
        }
        search.filters = normalizeHomeFilters(filters);
        const cursor = url.searchParams.has('cursor') ? text(url.searchParams.get('cursor'), 'Cursor', 1000, 1) : null;
        const viewerAccount = accountId(req), viewerStore = domain(viewerAccount), viewer = viewerStore.getCurrentUser();
        if (mode === 'following') {
          ensure(viewer, 'Log in to continue.', 401);
          ensure(viewer.role === 'artist', 'This action requires an artist account.', 403);
        }
        const followingViewer = mode === 'following' ? viewer!.artistId! : null;
        const followed = followingViewer !== null ? followStore.followedIds(followingViewer) : null;
        // Public eligibility is shared by results and suggestions, before filtering/pagination.
        const publicDomain = domain(null);
        const inventory = collaboration.opportunityProjects(publicDomain.listProjects()).filter(item => !followed || followed.has(item.project.artistId)).sort((a, b) => b.project.id - a.project.id);
        const artists = publicDomain.listArtists();
        if (url.pathname.endsWith('/suggestions')) {
          json(res, { items: opportunitySuggestions(inventory, artists, search, category) }); return;
        }
        const items = filterOpportunityProjects(inventory, artists, search, category);
        // Session-owned preferences are read once, after eligibility and filters.
        // Suggestions, Following, Recently created and Investor never use this ranker.
        const signals = mode === 'for-you' && viewer?.role === 'artist'
          ? buildHomeAffinitySignals(artists.find(artist => artist.id === viewer.artistId) ?? null, viewerStore.getMyArtistPreferences()) : null;
        const affinity = signals ? rankHomeProjects(items, artists, search, signals) : null;
        const summary = affinity?.summary;
        const forYou: HomeForYouSummary = !summary?.hasMatches
          ? { basis: 'general', reason: summary?.hasSignals ? 'no-matches' : 'no-signals' }
          : { basis: summary.usesExplicitPreferences && summary.usesPublicProfile ? 'mixed' : summary.usesExplicitPreferences ? 'preferences' : 'profile' };
        const signature = createHash('sha256').update(JSON.stringify({ search, category, mode, viewerAccount, signals })).digest('hex');
        json(res, { ...pageHomeProjects(items, mode, cursor, before, signature, homeCursors, summary?.hasSignals ? affinity!.entries : undefined),
          eligibleCount: inventory.length, ...(followed ? { followedArtistCount: followed.size } : {}), facets: homeFacetOptions(inventory, artists),
          ...(mode === 'for-you' ? { forYou } : {}) }); return;
      }
      const songList=/^\/api\/projects\/(\d+)\/songs$/.exec(url.pathname), songRecord=/^\/api\/works\/(\d+)$/.exec(url.pathname);
      if(songList || url.pathname==='/api/works' || songRecord){
        if(songList && req.method==='GET'){json(res,songStore.list(id(Number(songList[1])),accountId(req)));return;}
        const owner=current(req,true).artistId!;
        if(url.pathname==='/api/works' && req.method==='GET'){json(res,songStore.mine(owner));return;}
        ensure((songList&&req.method==='PUT')||(songRecord&&req.method==='DELETE'),'Method not allowed.',405);
        const value=await body(req);rateLimit(req,'songs',100,60,String(owner));
        const result=transaction(db,()=>songStore.operation(owner,value.operationId,url.pathname,value,()=>songList?songStore.save(id(Number(songList[1])),owner,value):songStore.remove(id(Number(songRecord![1])),owner,value.revision)));
        json(res,result);return;
      }
      if (url.pathname === '/api/uploads' && req.method === 'POST') { await upload(req, res); return; }
      if (await drafts.handle(req, res, url)) return;
      if (await messageService.handle(req,res,url)) return;
      if (await collaboration.handle(req, res, url)) return;
      const waveformMatch = /^\/api\/publications\/(\d+)\/waveform$/.exec(url.pathname);
      if (waveformMatch && req.method === 'GET') {
        const viewer = current(req, true).artistId!;
        rateLimit(req, 'waveform', 60, 60, String(viewer));
        const allowed = () => {
          const row = db.prepare('SELECT * FROM posts WHERE id=?').get(Number(waveformMatch[1])) as PostRow | undefined;
          const post = row ? JSON.parse(row.data) as StoredPublication : null;
          ensure(post && post.status === 'published' && post.allowRemix && !post.remix, 'Original unavailable for remixing.', 404);
          const media = mediaRow(post.mediaId); ensure(media && ['audio','video'].includes(media.kind), 'Original unavailable.', 404);
          return media.id;
        };
        const mediaId = allowed(), result = await waveformStore.get(mediaId);
        ensure(allowed() === mediaId, 'The original changed. Reload the studio.', 409);
        res.setHeader('Cache-Control', 'private, no-store'); json(res, result); return;
      }
      const mediaMatch = /^\/media\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (mediaMatch && ['GET', 'HEAD'].includes(req.method ?? '')) {
        const row = mediaRow(mediaMatch[1]); ensure(row, 'Not found.', 404);
        const publicPost = db.prepare("SELECT id FROM posts WHERE json_extract(data,'$.status')='published' AND (json_extract(data,'$.mediaId')=? OR json_extract(data,'$.coverId')=?) LIMIT 1").get(row.id, row.id);
        ensure(publicPost || row.owner === accountId(req) || collaboration.canReadMedia(row.id, accountId(req)), 'Not found.', 404);
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        if (['document','archive'].includes(row.kind) || url.searchParams.get('download') === '1') res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name ?? row.id).replace(/'/g, '%27')}`);
        await sendFile(req, res, join(mediaDirectory, row.id), row.mime, true); return;
      }
      const uploadMatch = /^\/api\/uploads\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (uploadMatch && req.method === 'DELETE') {
        const owner = current(req, true).artistId!, row = mediaRow(uploadMatch[1]);
        ensure(row && row.owner === owner, 'Not found.', 404);
        ensure(!drafts.used(row.id) && !collaboration.mediaUsed(row.id) && !db.prepare("SELECT id FROM posts WHERE json_extract(data,'$.mediaId')=? OR json_extract(data,'$.coverId')=?").get(row.id, row.id), 'This file is used by a publication or collaboration.', 409);
        db.prepare('DELETE FROM remix_private_media WHERE media=?').run(row.id); db.prepare('DELETE FROM media WHERE id=?').run(row.id); await unlink(join(mediaDirectory, row.id)).catch(() => {}); await waveformStore.remove(row.id); json(res, { ok: true }); return;
      }
      if (url.pathname === '/api/uploads' && req.method === 'GET') {
        const owner = current(req, true).artistId!;
        const rows = db.prepare("SELECT * FROM media WHERE owner=? AND NOT EXISTS (SELECT 1 FROM posts WHERE json_extract(data,'$.mediaId')=media.id OR json_extract(data,'$.coverId')=media.id) ORDER BY created DESC").all(owner) as MediaRow[];
        json(res, rows.filter(row => !drafts.used(row.id) && !collaboration.mediaUsed(row.id)).map(mediaDto)); return;
      }
      if (url.pathname === '/api/feed' && req.method === 'GET') {
        db.prepare('DELETE FROM feed_snapshots WHERE expires<?').run(Date.now());
        let token = url.searchParams.get('snapshot');
        let ids: number[];
        if (token) {
          const snapshot = db.prepare('SELECT ids FROM feed_snapshots WHERE token=?').get(token) as { ids: string } | undefined;
          ensure(snapshot, 'This feed expired. Refresh Discovery to continue.', 410);
          ids = JSON.parse(snapshot.ids);
        } else {
          rateLimit(req, 'feed-snapshot', 120, 60);
          const candidates = db.prepare("SELECT id,owner,created,(SELECT COUNT(*) FROM stars WHERE post=posts.id) AS stars FROM posts WHERE json_extract(data,'$.status')='published' ORDER BY id DESC LIMIT 5000").all() as RankCandidate[];
          ids = rankPosts(candidates); token = randomUUID();
          db.prepare('INSERT INTO feed_snapshots(token,ids,expires) VALUES(?,?,?)').run(token, JSON.stringify(ids), Date.now() + 24 * 3600_000);
        }
        const offset = Number(url.searchParams.get('offset') ?? 0);
        ensure(Number.isSafeInteger(offset) && offset >= 0 && offset <= ids.length, 'Invalid cursor.');
        const items: Publication[] = []; let next = offset;
        while (next < ids.length && items.length < 20) {
          const row = db.prepare("SELECT * FROM posts WHERE id=? AND json_extract(data,'$.status')='published'").get(ids[next++]) as PostRow | undefined;
          if (row) items.push(postDto(row, accountId(req)));
        }
        json(res, { items, snapshot: token, nextCursor: next < ids.length ? next : null }); return;
      }
      if (url.pathname === '/api/saved' && req.method === 'GET') {
        current(req); const viewer = accountId(req)!;
        const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
        ensure(Number.isSafeInteger(before) && before > 0, 'Invalid cursor.');
        const rows = db.prepare("SELECT posts.* FROM saves JOIN posts ON posts.id=saves.post WHERE saves.account=? AND posts.id<? AND json_extract(posts.data,'$.status')='published' ORDER BY posts.id DESC LIMIT 21").all(viewer, before) as PostRow[];
        json(res, { items: rows.slice(0,20).map(row => postDto(row, viewer)), nextCursor: rows.length > 20 ? rows[19].id : null }); return;
      }
      const interaction = /^\/api\/publications\/(\d+)\/(star|save|comments)(?:\/(\d+))?$/.exec(url.pathname);
      if (interaction) {
        const post = id(Number(interaction[1])), action = interaction[2], commentId = interaction[3] ? id(Number(interaction[3])) : null;
        const viewer = accountId(req);
        if (req.method === 'GET' && action === 'comments' && !commentId) {
          readablePost(post, viewer);
          const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
          ensure(Number.isSafeInteger(before) && before > 0, 'Invalid cursor.');
          const rows = db.prepare('SELECT * FROM comments WHERE post=? AND id<? ORDER BY id DESC LIMIT 31').all(post, before) as { id: number; account: number; text: string; created: string }[];
          const owner = (db.prepare('SELECT owner FROM posts WHERE id=?').get(post) as { owner: number }).owner;
          const items = rows.slice(0,30).map(row => {
            const author = domain(row.account).getCurrentUser();
            return { id: row.id, text: row.text, createdAt: row.created, author: author?.name ?? 'Member', artistId: author?.artistId ?? null, canDelete: viewer === row.account || viewer === owner };
          });
          json(res, { items, nextCursor: rows.length > 30 ? rows[29].id : null }); return;
        }
        current(req);
        if (req.method === 'PUT' && ['star','save'].includes(action) && !commentId) {
          const input = await body(req), enabled = bool(input.enabled);
          // Removing one's own interaction remains possible after withdrawal.
          if (enabled) readablePost(post, viewer, true);
          rateLimit(req, 'reactions', 180, 60, String(viewer));
          const table = action === 'star' ? 'stars' : 'saves';
          if (!enabled) db.prepare(`DELETE FROM ${table} WHERE post=? AND account=?`).run(post, viewer!);
          else if (action === 'star') db.prepare('INSERT OR IGNORE INTO stars(post,account) VALUES(?,?)').run(post, viewer!);
          else db.prepare('INSERT OR IGNORE INTO saves(post,account,created) VALUES(?,?,?)').run(post, viewer!, Date.now());
          // Do not expose counts from a withdrawn/private post via a removal response.
          json(res, { ok: true }); return;
        }
        if (req.method === 'POST' && action === 'comments' && !commentId) {
          const input = await body(req); readablePost(post, viewer, true);
          const value = text(input.text, 'Comment', 500, 1);
          rateLimit(req, 'comments', 20, 60, String(viewer));
          const result = db.prepare('INSERT INTO comments(post,account,text,created) VALUES(?,?,?,?)').run(post, viewer!, value, new Date().toISOString());
          json(res, { id: Number(result.lastInsertRowid) }, 201); return;
        }
        if (req.method === 'DELETE' && action === 'comments' && commentId) {
          const row = db.prepare('SELECT comments.account,posts.owner FROM comments JOIN posts ON posts.id=comments.post WHERE comments.id=? AND comments.post=?').get(commentId, post) as { account: number; owner: number } | undefined;
          ensure(row && (row.account === viewer || row.owner === viewer), 'Comment not found.', 404);
          db.prepare('DELETE FROM comments WHERE id=?').run(commentId); json(res, { ok: true }); return;
        }
        throw new HttpError(405, 'Method not allowed.');
      }
      if (url.pathname === '/api/publications' && req.method === 'GET') {
        const viewer = accountId(req), mine = url.searchParams.get('mine') === '1';
        if (mine) current(req, true);
        const artist = url.searchParams.has('artistId') ? id(Number(url.searchParams.get('artistId'))) : null;
        const projectAudio = url.searchParams.get('projectAudio') === '1';
        const songProject=url.searchParams.has('project')?id(Number(url.searchParams.get('project'))):null;
        const songId=url.searchParams.has('song')?id(Number(url.searchParams.get('song'))):null;
        if(songId){ensure(songProject&&songStore.linked(songProject,songId,null),'Song context unavailable.',404);ensure(!mine,'Related publications are public only.');}

        ensure(!artist || !mine, 'Public artist publications cannot include drafts.');
        ensure(!projectAudio || !!artist, 'Choose an artist for project audio.');
        const before = url.searchParams.get('before') ? Number(url.searchParams.get('before')) : Number.MAX_SAFE_INTEGER;
        ensure(Number.isSafeInteger(before) && before > 0, 'Invalid cursor.');
        const projectIds = projectAudio ? domain(null).getPublicArtist(artist!)?.projects.filter(p => ['album','ep','single'].includes(p.category.toLowerCase())).map(p => p.id) ?? [] : [];
        const params = [before, ...(mine ? [viewer!] : []), ...(artist ? [artist] : []), ...projectIds, ...(songId?[songProject!,songId]:[])];
        const rows = db.prepare(`SELECT * FROM posts WHERE id<? AND ${mine ? 'owner=?' : "json_extract(data,'$.status')='published'"}${artist ? ' AND owner=?' : ''}${projectAudio ? ` AND json_extract(data,'$.projectId') IN (${projectIds.map(() => '?').join(',') || 'NULL'}) AND EXISTS(SELECT 1 FROM media WHERE media.id=json_extract(posts.data,'$.mediaId') AND media.kind='audio')` : ''}${songId ? " AND json_extract(data,'$.projectId')=? AND json_extract(data,'$.workId')=?" : ''} ORDER BY id DESC LIMIT 21`).all(...params) as PostRow[];
        json(res, { items: rows.slice(0, 20).map(row => postDto(row, artist ? null : viewer)), nextCursor: rows.length > 20 ? rows[19].id : null }); return;
      }
      const postMatch = /^\/api\/publications\/(\d+)$/.exec(url.pathname);
      if (postMatch && req.method === 'GET') {
        const row = db.prepare('SELECT * FROM posts WHERE id=?').get(Number(postMatch[1])) as PostRow | undefined;
        ensure(row && (JSON.parse(row.data).status === 'published' || row.owner === accountId(req)), 'Publication not found.', 404);
        json(res, postDto(row, accountId(req))); return;
      }
      if ((url.pathname === '/api/publications' && req.method === 'POST') || (postMatch && req.method === 'PATCH')) {
        const owner = current(req, true).artistId!, input = await body(req);
        const now = new Date().toISOString();
        let postId: number;
        if (postMatch) {
          postId = Number(postMatch[1]);
          const row = db.prepare('SELECT * FROM posts WHERE id=?').get(postId) as PostRow | undefined;
          ensure(row && row.owner === owner, 'Publication not found.', 404);
          ensure(input.revision === row.revision, 'This publication changed in another tab. Reload before saving.', 409);
          const previous = JSON.parse(row.data);
          const data: StoredPublication = publicationInput({...input,workId:Object.hasOwn(input,'workId')?input.workId:previous.workId}, owner) as StoredPublication;
          ensure(!previous.remix || data.status !== 'published' || previous.status === 'published', 'Public release of remixes is deferred. Keep this remix private.', 409);
          data.remix = remixStore.validate(input.remix, data, previous);
          db.prepare('UPDATE posts SET data=?,revision=revision+1,updated=? WHERE id=?').run(JSON.stringify(data), now, postId);
        } else {
          rateLimit(req, 'publish', 100, 3600, String(owner));
          const data: StoredPublication = publicationInput(input, owner) as StoredPublication;
          ensure(input.remix == null, 'Create a private remix draft in Remix studio.', 409);
          data.remix = null;
          postId = Number(db.prepare('INSERT INTO posts(owner,data,created,updated) VALUES(?,?,?,?)').run(owner, JSON.stringify(data), now, now).lastInsertRowid);
        }
        json(res, postDto(db.prepare('SELECT * FROM posts WHERE id=?').get(postId) as PostRow, owner), postMatch ? 200 : 201); return;
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) throw new HttpError(404, 'Not found.');
      ensure(['GET', 'HEAD'].includes(req.method ?? ''), 'Method not allowed.', 405);
      const root = resolve(options.publicDir), path = resolve(root, '.' + decodeURIComponent(url.pathname));
      ensure(path === root || path.startsWith(root + sep), 'Not found.', 404);
      if (extname(path)) {
        const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.wav': 'audio/wav', '.txt': 'text/plain', '.ico': 'image/x-icon' };
        ensure(types[extname(path)], 'Not found.', 404);
        await sendFile(req, res, path, types[extname(path)]); return;
      }
      const html = (await readFile(join(root, 'index.html'), 'utf8'))
        .replace('<head>', '<head><meta name="nebula-data-mode" content="server">')
        .replace("connect-src 'none'", "connect-src 'self'")
        .replace("img-src 'self' data: blob:;", "img-src 'self' data: blob:; media-src 'self' blob:;");
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : html);
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      const status = error instanceof HttpError ? error.status : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : error instanceof TypeError ? 400 : 500;
      if (status === 500) console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
      json(res, { error: status === 500 ? 'The server could not complete this request. Please try again.' : error instanceof Error ? error.message : 'Request failed.' }, status);
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.on('close', () => { waveformStore.close(); db.close(); });
  return server;
}
