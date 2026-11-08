import { describe, it, expect } from 'vitest';
import { filterOpportunityProjects, opportunitySuggestions, type HomeSearch } from './opportunity-search';
import { readHomeHistory, rememberHomeSearch, writeHomeHistory, homeHistoryKey } from './home-search-history';
import type { OpportunityProject } from './opportunities';
import type { ArtistSummary } from './types';
const artists = [{ id: 1, name: 'Grámz', genre: 'Hip-hop' }] as ArtistSummary[];
const item = (id: number, status = 'published'): OpportunityProject => ({ project: { id, artistId: 1, artistName: 'Grámz', title: `Blue Room ${id}`, category: 'EP', pitch: 'Trap sessions', story: 'Analog textures', status }, offers: [
  { id: 1, need: 'Production', deliverable: 'Beats', requirements: 'Stems', compensation: { kind: 'fee', currency: 'USD', amount: 180 } },
  { id: 2, need: 'Mix', deliverable: 'Stereo mix', requirements: '', compensation: { kind: 'split', percent: 10 } },
] } as OpportunityProject);
const search = (q = '', criteria: HomeSearch['criteria'] = {}): HomeSearch => ({ q, criteria });
describe('Home contextual search', () => {
  it('searches available fields and aliases without duplicating projects', () => {
    for (const text of ['blue room', 'gramz', 'TRAP', 'analog', 'ep', 'hip-hop', 'producer', 'beats', 'stems', 'royalties', 'usd', 'mixing engineer']) expect(filterOpportunityProjects([item(1)], artists, search(text))).toHaveLength(1);
    expect(filterOpportunityProjects([item(1)], artists, search('nonexistent'))).toEqual([]);
    expect(filterOpportunityProjects([item(1, 'funding')], artists, search('financing'))).toHaveLength(1);
  });
  it('ANDs dimensions and requires one offer to satisfy role and compensation', () => {
    expect(filterOpportunityProjects([item(1)], artists, search('trap', { need: 'Production', compensation: 'split' }), 'ep')).toEqual([]);
    expect(filterOpportunityProjects([item(1)], artists, search('trap', { need: 'Production', compensation: 'fee', genre: 'hip-hop' }), 'ep')).toHaveLength(1);
    expect(filterOpportunityProjects([item(1)], artists, search('', { projectType: 'album' }), 'ep')).toEqual([]);
    expect(filterOpportunityProjects([item(1)], artists, search('', { opportunity: 'funding' }))).toEqual([]);
  });
  it('suggests only supported criteria and real eligible entities with bounded payloads', () => {
    expect(opportunitySuggestions([item(1)], artists, search('prod'))).toEqual([expect.objectContaining({ action: 'criterion', field: 'need', value: 'Production' })]);
    expect(opportunitySuggestions([item(1)], artists, search('roy'))).toEqual([expect.objectContaining({ value: 'split' })]);
    expect(opportunitySuggestions([item(1)], artists, search('hip'))[0]).toMatchObject({ type: 'Artist genre', value: 'Hip-hop' });
    expect(opportunitySuggestions([item(1)], artists, search('gramz'))[0]).toMatchObject({ href: '/artist/1' });
    expect(opportunitySuggestions(Array.from({length:40},(_,i)=>item(i)), artists, search('Blue'))).toHaveLength(3);
    expect(opportunitySuggestions([item(1)], artists, search('prod', { compensation: 'split' }))).toEqual([]);
    expect(opportunitySuggestions([], artists, search('gramz'))).toEqual([]);
  });
});
describe('Home search history', () => {
  const fakeStorage = () => { const data = new Map<string,string>(); return { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,v:string) => { data.set(key,v); } }; };
  it('persists ten completed searches, deduplicates normalized entries and separates identities', () => {
    const storage = fakeStorage(), id = 'artist:tests';
    for (let i=0;i<12;i++) rememberHomeSearch(id, search(`Entry ${i}`), storage);
    expect(readHomeHistory(id, storage)).toHaveLength(10);
    rememberHomeSearch(id, search('  ENTRY 2  '), storage);
    expect(readHomeHistory(id, storage)[0].q).toBe('ENTRY 2');
    expect(readHomeHistory(id, storage)).toHaveLength(10);
    expect(readHomeHistory('guest:tests', storage)).toEqual([]);
    writeHomeHistory(id, [], storage); expect(readHomeHistory(id, storage)).toEqual([]);
  });
  it('does not save blanks or unrelated fields and survives unavailable/corrupt storage', () => {
    const storage = fakeStorage();
    expect(rememberHomeSearch('empty', search(), storage)).toEqual([]);
    storage.setItem(homeHistoryKey('corrupt'), '{bad'); expect(readHomeHistory('corrupt',storage)).toEqual([]);
    storage.setItem(homeHistoryKey('safe'), JSON.stringify([{q:'trap',criteria:{need:'Production',password:'secret'},category:'album',credentials:'secret'}]));
    expect(readHomeHistory('safe',storage)).toEqual([search('trap',{need:'Production'})]);
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    rememberHomeSearch('blocked',search('trap'),blocked); expect(readHomeHistory('blocked',blocked)).toEqual([search('trap')]);
    const quota = { getItem() { return JSON.stringify([search('old persisted')]); }, setItem() { throw new Error('quota'); } };
    rememberHomeSearch('quota',search('new memory'),quota); expect(readHomeHistory('quota',quota)[0].q).toBe('new memory');
    rememberHomeSearch('quota',search('newer memory'),quota); expect(readHomeHistory('quota',quota).map(v=>v.q)).toEqual(['newer memory','new memory','old persisted']);
    writeHomeHistory('blocked',[],blocked); expect(readHomeHistory('blocked',blocked)).toEqual([]);
  });
});

describe('Project Browser facets', () => {
  const facets = (values: Partial<import('./opportunity-search').HomeFilters>) => ({ projectTypes: [], artistGenres: [], participation: [], compensationKinds: [], ...values });
  it('uses OR within dimensions, AND across them, and same-record compensation', () => {
    const ep=item(1), album=item(2), funding=item(3,'funding'); album.project.category='Album'; funding.offers=[];
    const find=(values:Partial<import('./opportunity-search').HomeFilters>,q='')=>filterOpportunityProjects([ep,album,funding],artists,{q,criteria:{},filters:facets(values)}).map(i=>i.project.id);
    expect(find({projectTypes:['ep','album'],artistGenres:['Rock','hip-hop'],participation:['Production','Mix'],compensationKinds:['fee','split']},'trap')).toEqual([1,2]);
    expect(find({participation:['Production'],compensationKinds:['split']})).toEqual([]);
    expect(filterOpportunityProjects([ep],artists,{q:'',criteria:{need:'Production'},filters:facets({compensationKinds:['split']})})).toEqual([]);
    expect(find({participation:['Mix','Funding']})).toEqual([1,2,3]);
    expect(find({participation:['Funding'],compensationKinds:['fee']})).toEqual([]);
    expect(find({participation:['Funding','Production'],compensationKinds:['fee']})).toEqual([1,2]);
    expect(find({projectTypes:['ep','album']},'absent')).toEqual([]);
  });
  it('keeps autocomplete truthful across facets and extends rather than replaces selections', async () => {
    const {addHomeCriterion}=await import('./opportunity-search');
    const state={q:'prod',criteria:{},filters:facets({participation:['Mix'],compensationKinds:['split']})};
    expect(opportunitySuggestions([item(1)],artists,state)).toEqual([]);
    const selected=addHomeCriterion({...state,filters:facets({participation:['Mix']})},'need','Production');
    expect(selected.filters.participation).toEqual(['Mix','Production']);
    expect(opportunitySuggestions([item(1)],artists,{q:'roy',criteria:{},filters:facets({participation:['Production'],compensationKinds:['fee']})})).toEqual([]);
  });
  it('preserves multiselect history, recognizes equivalent order and reads v1 entries', () => {
    const data=new Map<string,string>(), storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}};
    const entry={q:'trap',criteria:{},filters:facets({projectTypes:['ep','album'],participation:['Mix','Production']})};
    rememberHomeSearch('multi',entry,storage);rememberHomeSearch('multi',{...entry,filters:facets({projectTypes:['album','ep'],participation:['Production','Mix']})},storage);
    expect(readHomeHistory('multi',storage)).toHaveLength(1);
    expect(readHomeHistory('multi',storage)[0].filters?.participation).toEqual(['Production','Mix']);
    storage.setItem(homeHistoryKey('legacy-browser'),JSON.stringify([{q:'prod',criteria:{need:'Production',genre:'Hip-hop'}}]));
    expect(readHomeHistory('legacy-browser',storage)[0].criteria).toEqual({genre:'Hip-hop',need:'Production'});
  });
});
