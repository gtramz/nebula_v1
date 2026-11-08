import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { transaction } from './transaction.js';
import { ensure, id, object, text } from './validation.js';
import { musicalProject, type Song, type Tracklist } from '../lib/local/src/works.js';
import type { Project } from '../lib/local/src/types.js';

export function works(db: DatabaseSync, project: (id: number, viewer: number | null) => Project | null) {
  transaction(db, () => db.exec(`
    CREATE TABLE IF NOT EXISTS works(id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS works_owner ON works(owner,id);
    CREATE TABLE IF NOT EXISTS project_tracklists(project INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS project_works(project INTEGER NOT NULL, work INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(project,work), UNIQUE(project,position));
    CREATE INDEX IF NOT EXISTS project_works_work ON project_works(work);
    CREATE TABLE IF NOT EXISTS work_operations(owner INTEGER NOT NULL, token TEXT NOT NULL, signature TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(owner,token));
  `));
  type Row = {id:number;owner:number;title:string;description:string;revision:number;created:string;updated:string};
  const row = (work: number) => db.prepare('SELECT * FROM works WHERE id=?').get(work) as Row | undefined;
  const dto = (r: Row): Song => ({id:r.id,ownerId:r.owner,title:r.title,description:r.description,revision:r.revision,createdAt:r.created,updatedAt:r.updated});
  function references(projectId: number, workId: number): string[] {
    const result: string[] = [];
    if (db.prepare("SELECT 1 FROM collaboration_offers WHERE project=? AND json_extract(data,'$.workId')=?").get(projectId,workId)) result.push('offers and their proposal history');
    if (db.prepare("SELECT 1 FROM posts WHERE json_extract(data,'$.projectId')=? AND json_extract(data,'$.workId')=?").get(projectId,workId)) result.push('publications (including drafts and withdrawn posts)');
    return result;
  }
  function list(projectId: number, viewer: number | null): Tracklist {
    const p = project(projectId,viewer); ensure(p,'Project not found.',404);
    const revision=(db.prepare('SELECT revision FROM project_tracklists WHERE project=?').get(projectId) as {revision:number}|undefined)?.revision??0;
    const rows=db.prepare('SELECT w.* FROM works w JOIN project_works pw ON pw.work=w.id WHERE pw.project=? ORDER BY pw.position').all(projectId) as Row[];
    return {revision,songs:rows.map(r=>({...dto(r),references:viewer===p.artistId?references(projectId,r.id):[]}))};
  }
  function linked(projectId: number, workId: number, viewer: number | null) {
    if (!project(projectId,viewer) || !db.prepare('SELECT 1 FROM project_works WHERE project=? AND work=?').get(projectId,workId)) return null;
    const r=row(workId); return r?dto(r):null;
  }
  function validateLink(projectId: number | null, workId: unknown, owner: number) {
    if (workId==null) return null;
    ensure(projectId,'Choose a project for this song.');
    const p=project(projectId,owner),song=linked(projectId,id(workId),owner);
    ensure(p?.artistId===owner && song?.ownerId===owner,'Choose your own song included in this project.',400);
    return song;
  }
  // Caller owns the single transaction. A lost response can be replayed safely.
  function operation<T>(owner:number, token:unknown, scope:string, input:unknown, write:()=>T):T {
    const key=text(token,'Operation ID',100,16),signature=createHash('sha256').update(JSON.stringify({scope,input})).digest('hex');
    const previous=db.prepare('SELECT signature,result FROM work_operations WHERE owner=? AND token=?').get(owner,key) as {signature:string;result:string}|undefined;
    if(previous){ensure(previous.signature===signature,'This operation changed. Review before retrying.',409);return JSON.parse(previous.result) as T;}
    const result=write();db.prepare('INSERT INTO work_operations VALUES(?,?,?,?)').run(owner,key,signature,JSON.stringify(result));return result;
  }
  function save(projectId:number, owner:number, value:unknown) {
    const p=project(projectId,owner);ensure(p?.artistId===owner,'Project not found.',404);ensure(musicalProject(p.category),'Songs are managed in Single, EP or Album projects.');
    const input=object(value),existing=list(projectId,owner);
    ensure(input.revision===existing.revision,'The song list changed in another tab. Reload and review your draft.',409);
    ensure(Array.isArray(input.songs)&&input.songs.length<=100,'A tracklist can contain up to 100 songs.');
    const entries=input.songs.map(value=>{const item=object(value);return {id:item.workId==null?null:id(item.workId),revision:item.revision,title:text(item.title,'Song title',160,1),description:text(item.description??'','Song description',4000)};});
    const selected=entries.flatMap(e=>e.id?[e.id]:[]);ensure(new Set(selected).size===selected.length,'A song can only appear once in this project.');
    for(const old of existing.songs) if(!selected.includes(old.id)) ensure(!old.references.length,`Cannot remove “${old.title}”: referenced by ${old.references.join(', ')}.`,409);
    for(const e of entries) if(e.id){const r=row(e.id);ensure(r?.owner===owner,'Song not found.',404);ensure(r.revision===e.revision,'A song changed in another tab. Reload and review your draft.',409);}
    const now=new Date().toISOString();
    const ids=entries.map(e=>{if(e.id){const r=row(e.id)!;if(e.title!==r.title||e.description!==r.description) db.prepare('UPDATE works SET title=?,description=?,revision=revision+1,updated=? WHERE id=?').run(e.title,e.description,now,e.id);return e.id;}return Number(db.prepare('INSERT INTO works(owner,title,description,created,updated) VALUES(?,?,?,?,?)').run(owner,e.title,e.description,now,now).lastInsertRowid);});
    db.prepare('DELETE FROM project_works WHERE project=?').run(projectId);
    ids.forEach((work,position)=>db.prepare('INSERT INTO project_works VALUES(?,?,?)').run(projectId,work,position));
    db.prepare('INSERT INTO project_tracklists(project,revision) VALUES(?,1) ON CONFLICT(project) DO UPDATE SET revision=revision+1').run(projectId);
    return list(projectId,owner);
  }
  function remove(workId:number, owner:number, revision:unknown) {
    const r=row(workId);ensure(r?.owner===owner,'Song not found.',404);ensure(r.revision===revision,'Song changed. Reload before deleting.',409);
    ensure(!db.prepare('SELECT 1 FROM project_works WHERE work=?').get(workId),'Remove this song from its projects first. Referenced songs cannot be removed.',409);
    ensure(!db.prepare("SELECT 1 FROM collaboration_offers WHERE json_extract(data,'$.workId')=?").get(workId)&&!db.prepare("SELECT 1 FROM posts WHERE json_extract(data,'$.workId')=?").get(workId),'Song has historical references and cannot be deleted.',409);
    db.prepare('DELETE FROM works WHERE id=?').run(workId);return {deleted:true};
  }
  return {list,linked,validateLink,save,operation,remove,mine:(owner:number)=>(db.prepare('SELECT * FROM works WHERE owner=? ORDER BY id DESC').all(owner) as Row[]).map(dto)};
}
