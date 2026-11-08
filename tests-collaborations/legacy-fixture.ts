import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from '@playwright/test';
/** Seed only a disposable historical thread, never offer a production legacy-create bypass. */
export async function legacyConversation(page:Page,offerId:number){
 const directory=readFileSync('.data/e2e-data-dir','utf8').trim();
 if(dirname(directory)!==tmpdir().replace(/\/$/,'') || !basename(directory).startsWith('nebula-e2e-'))throw new Error('Expected disposable test database.');
 const session=await(await page.request.get('/api/session')).json();
 const db=new DatabaseSync(join(directory,'nebula.sqlite'));
 try{
  const offer=db.prepare('SELECT * FROM collaboration_offers WHERE id=?').get(offerId) as {id:number;project:number;owner:number;data:string;title:string;revision:number;created:string};
  let row=db.prepare('SELECT id FROM collaborations WHERE offer=? AND applicant=?').get(offerId,session.user.artistId) as {id:number}|undefined;
  if(!row){const terms={...JSON.parse(offer.data),id:offer.id,projectId:offer.project,ownerId:offer.owner,projectTitle:offer.title,revision:offer.revision,createdAt:offer.created,available:true};
   const saved=db.prepare('INSERT INTO collaborations(offer,owner,applicant,terms,updated) VALUES(?,?,?,?,?)').run(offer.id,offer.owner,session.user.artistId,JSON.stringify(terms),new Date().toISOString());row={id:Number(saved.lastInsertRowid)};
   db.prepare("INSERT INTO artist_notifications(recipient,actor,thread,kind,created) VALUES(?,?,?,'contact',?)").run(offer.owner,session.user.artistId,row.id,new Date().toISOString());
  }
  return await page.request.get(`/api/collaborations/${row.id}`);
 }finally{db.close();}
}
