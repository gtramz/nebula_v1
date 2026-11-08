import { expect, test } from 'vitest';
import { creativeRoleTaxonomy, musicalGenreTaxonomy, normalizeTaxonomyTerm, resolveLegacyTaxonomy, validateTaxonomyIds, type TaxonomyOption } from './artist-taxonomy';
import { createLocalStore, STORAGE_KEY } from './store';
import { parseState } from './state';

function memory() { const data = new Map<string,string>(); return { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => { data.set(key,value); } }; }
async function fixture() {
  const disk=memory(), store=createLocalStore(disk,undefined,1);
  const user=await store.register({name:'Taxonomy artist',email:'taxonomy@example.invalid',password:'preview123',role:'artist'});
  return {disk,store,id:user.artistId!};
}

test('taxonomies have stable unique IDs, unambiguous aliases and valid subgenre parents', () => {
  expect(creativeRoleTaxonomy).toHaveLength(17);
  expect(creativeRoleTaxonomy.find(r=>r.id==='producer')?.label).toBe('Music Producer');
  for (const taxonomy of [creativeRoleTaxonomy,musicalGenreTaxonomy] as readonly (readonly TaxonomyOption[])[]) {
    expect(new Set(taxonomy.map(r=>r.id)).size).toBe(taxonomy.length);
    const seen=new Map<string,string>();
    for(const option of taxonomy) {
      expect(option.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      if(option.parentId) { expect(taxonomy.some(r=>r.id===option.parentId)).toBe(true); expect(option.parentId).not.toBe(option.id); }
      for(const alias of [option.id,option.label,...option.aliases??[]]) {
        const key=normalizeTaxonomyTerm(alias);
        expect(seen.get(key) ?? option.id).toBe(option.id); seen.set(key,option.id);
      }
    }
  }
  expect(resolveLegacyTaxonomy(['producer','Producer','Music Producer','Mix Engineer'],creativeRoleTaxonomy)).toEqual({ids:['producer','mixing-engineer'],unresolved:[]});
  expect(resolveLegacyTaxonomy(['HIP HOP','Hiphop','R&B','Rhythm and Blues','Reguetón','regional mexicano','Norteño'],musicalGenreTaxonomy)).toEqual({ids:['hip-hop','rnb','reggaeton','regional-mexican','norteno'],unresolved:[]});
  expect(resolveLegacyTaxonomy(['Hip-hop / R&B','Demo projects'],musicalGenreTaxonomy).unresolved).toEqual(['Hip-hop / R&B','Demo projects']);
  expect(resolveLegacyTaxonomy(['Production'],creativeRoleTaxonomy).ids).toEqual([]); // opportunity is not a professional role
});

test('canonical writes reject labels, aliases, unknown IDs and deduplicate exact IDs', () => {
  expect(validateTaxonomyIds(['hip-hop','jazz','hip-hop'],musicalGenreTaxonomy,'genre',20)).toEqual(['hip-hop','jazz']);
  for(const value of [['Jazz'],['Hip hop'],['RnB'],['made-up'],null,'jazz',Array(21).fill('jazz')]) expect(()=>validateTaxonomyIds(value,musicalGenreTaxonomy,'genre',20)).toThrow();
  expect(()=>validateTaxonomyIds(['Music Producer'],creativeRoleTaxonomy,'role')).toThrow();
  expect(resolveLegacyTaxonomy(['ambiguous'],[{id:'a',label:'A',aliases:['ambiguous']},{id:'b',label:'B',aliases:['ambiguous']}])).toEqual({ids:[],unresolved:['ambiguous']});
});

test('legacy projection is read-only, maps clear values and preserves unsupported values through edits', async () => {
  const {disk,store,id}=await fixture(); const initial=JSON.parse(disk.getItem(STORAGE_KEY)!);
  initial.artists[0].genre='Demo projects';
  initial.artists[0].genres=['Hip hop','R&B','R and B','Jazz / Soul'];
  initial.artists[0].creativeRoles=['Producer','Vocalist','Unusual legacy role'];
  disk.setItem(STORAGE_KEY,JSON.stringify(initial)); const before=disk.getItem(STORAGE_KEY);
  const publicProfile=store.getArtist(id)!.artist;
  expect(publicProfile.creativeRoles).toEqual(['producer','vocalist']);
  expect(publicProfile.genreIds).toEqual(['hip-hop','rnb']);
  expect(publicProfile.identityReview).toEqual({creativeRoles:['Unusual legacy role'],genres:['Jazz / Soul','Demo projects']});
  store.listArtists(); store.getCurrentUser(); expect(disk.getItem(STORAGE_KEY)).toBe(before);
  store.updateArtist({name:'Taxonomy artist',creativeRoles:['arranger','recording-engineer'],genreIds:['techno','house','techno']});
  const saved=parseState(disk.getItem(STORAGE_KEY)!);
  expect(saved.artists[0]).toMatchObject({genre:initial.artists[0].genre,genres:initial.artists[0].genres,genreIds:['techno','house'],legacyCreativeRoles:['Unusual legacy role']});
  store.updateArtist({name:'Taxonomy artist',creativeRoles:[],genreIds:[]});
  expect(createLocalStore(disk,undefined,1).getArtist(id)!.artist).toMatchObject({creativeRoles:[],genreIds:[],identityReview:{creativeRoles:['Unusual legacy role'],genres:['Jazz / Soul','Demo projects']}});
});

test('canonical selections survive old clients and remain separate from private preferences and projects',async()=>{
  const {disk,store,id}=await fixture();
  const project=store.createProject({title:'No genre rewrite',category:'EP',goalAmount:100,status:'published'});
  store.updateMyArtistPreferences({discovery:{genres:['Private legacy value'],genreIds:['classical']}});
  store.updateArtist({name:'Taxonomy artist',creativeRoles:['session-musician','sound-designer'],genreIds:['trap','regional-mexican']});
  const before=JSON.parse(disk.getItem(STORAGE_KEY)!);
  store.updateArtist({name:'Old client',genre:'Unclassified previous value',bio:'Updated'});
  expect(store.getArtist(id)!.artist.genreIds).toEqual(['trap','regional-mexican']);
  expect(store.getArtist(id)!.artist.creativeRoles).toEqual(['session-musician','sound-designer']);
  expect(store.getArtist(id)!.artist).not.toHaveProperty('discovery');
  expect(store.getMyArtistPreferences().discovery).toMatchObject({genres:['Private legacy value'],genreIds:['classical']});
  expect(store.getProject(project.id)!.project).toMatchObject({title:'No genre rewrite',category:'EP'});
  expect(JSON.parse(disk.getItem(STORAGE_KEY)!).projects).toEqual(before.projects);
  const saved=disk.getItem(STORAGE_KEY);
  for(const input of [{genreIds:['Hip-hop']},{creativeRoles:['Producer']},{identityReview:{}},{legacyCreativeRoles:['new arbitrary role']}]) expect(()=>store.updateArtist({name:'Old client',...input} as never)).toThrow();
  expect(()=>store.updateMyArtistPreferences({discovery:{genreIds:['unlisted']}} as never)).toThrow();
  expect(disk.getItem(STORAGE_KEY)).toBe(saved);
});
