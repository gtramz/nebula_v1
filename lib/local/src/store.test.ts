import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStore, PreviewDataError, STORAGE_KEY } from './store';

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  return { store: createLocalStore(storage), storage };
}
const credentials = { name: 'Artist One', email: 'artist@example.invalid', password: 'preview123' };
const projectInput = { title: 'First Release', category: 'Album', goalAmount: 10_000, status: 'funding' as const };

describe('browser-only preview flows', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('starts completely empty and performs no network requests', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network unavailable'));
    const { store } = fixture();
    expect(store.getCurrentUser()).toBeNull();
    expect(store.listArtists()).toEqual([]);
    expect(store.listProjects()).toEqual([]);
    await store.register({ ...credentials, role: 'artist' });
    store.createProject(projectInput);
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps the artist profile, edits and project lifecycle in tab storage', async () => {
    const { store, storage } = fixture();
    const artist = await store.register({ ...credentials, role: 'artist' });
    expect(storage.getItem(STORAGE_KEY)).not.toContain(credentials.password);
    store.updateArtist({ name: 'Artist Updated', genre: 'Electronic', bio: 'A local preview.' });
    expect(store.getCurrentUser()?.name).toBe('Artist Updated');
    const draft = store.createProject({ ...projectInput, status: 'draft' });
    expect(store.getArtist(artist.artistId!)?.projects).toHaveLength(1);
    store.logout();
    expect(store.listProjects()).toEqual([]);
    expect(store.getProject(draft.id)).toBeNull();
    await expect(store.login({ ...credentials, password: 'incorrect' })).rejects.toThrow();
    await store.login(credentials);
    store.updateProject(draft.id, { status: 'funding', title: 'Published Release' });
    expect(store.listProjects({ search: 'published' })).toHaveLength(1);
    expect(createLocalStore(storage).getCurrentUser()?.artistId).toBe(artist.artistId);
    store.deleteProject(draft.id);
    expect(store.listProjects()).toEqual([]);
  });

  it('retains role boundaries and prevents another artist from editing projects', async () => {
    const { store } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    const project = store.createProject(projectInput);
    await store.register({ ...credentials, email: 'second@example.invalid', role: 'artist' });
    expect(() => store.updateProject(project.id, { title: 'Changed' })).toThrow('does not belong');
    expect(() => store.deleteProject(project.id)).toThrow('does not belong');
    expect(() => store.createInvestment({ projectId: project.id, amount: 500 })).toThrow();
    await store.register({ ...credentials, email: 'investor@example.invalid', role: 'investor' });
    expect(() => store.createProject(projectInput)).toThrow();
    expect(() => store.toggleProjectSupport(project.id)).toThrow();
  });

  it('previews pledges and receipts without making a payment', async () => {
    const { store } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    const project = store.createProject(projectInput);
    await store.register({ ...credentials, email: 'investor@example.invalid', name: 'Investor One', role: 'investor' });
    expect(() => store.createInvestment({ projectId: project.id, amount: -1 })).toThrow();
    expect(() => store.createInvestment({ projectId: project.id, amount: NaN })).toThrow();
    const pledge = store.createInvestment({ projectId: project.id, amount: 500 });
    expect(pledge.status).toBe('preview');
    expect(store.getProject(project.id)?.project).toMatchObject({ raisedAmount: 500, backersCount: 1 });
    expect(store.listMyInvestments()).toHaveLength(1);
    expect(store.getInvestment(pledge.id)?.amount).toBe(500);
    store.logout();
    expect(store.getInvestment(pledge.id)).toBeNull();
  });

  it('supports and unsupports other artists, while keeping drafts private', async () => {
    const { store } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    const project = store.createProject(projectInput);
    expect(() => store.toggleProjectSupport(project.id)).toThrow('another artist');
    await store.register({ ...credentials, email: 'second@example.invalid', role: 'artist' });
    expect(store.toggleProjectSupport(project.id)).toEqual({ supported: true, supportsCount: 1 });
    expect(store.getProject(project.id)?.viewerHasSupported).toBe(true);
    expect(store.toggleProjectSupport(project.id)).toEqual({ supported: false, supportsCount: 0 });
  });

  it('rejects remote media and invalid project data', async () => {
    const { store } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    expect(() => store.createProject({ ...projectInput, coverUrl: '//example.invalid/image.png' })).toThrow('from your device');
    expect(() => store.updateArtist({ name: 'Artist One', picture: '//example.invalid/avatar.png' })).toThrow();
    expect(() => store.createProject({ ...projectInput, goalAmount: -50 })).toThrow();
    expect(() => store.createProject({ ...projectInput, useOfFunds: [{ label: 'Production', percentage: 50 }] })).toThrow('100%');
    expect(store.listProjects()).toEqual([]);
  });

  it('clears every profile and record when resetting the preview', async () => {
    const { store } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    store.createProject(projectInput);
    store.reset();
    expect(store.getCurrentUser()).toBeNull();
    expect(store.listArtists()).toEqual([]);
    expect(store.listProjects()).toEqual([]);
  });

  it('retains archived project receipts, totals and ownership while blocking new contributions', async () => {
    const { store, storage } = fixture();
    const artist = await store.register({ ...credentials, role: 'artist' });
    const project = store.createProject(projectInput);
    await store.register({ ...credentials, email: 'investor@example.invalid', role: 'investor' });
    const pledge = store.createInvestment({ projectId: project.id, amount: 200.75 });
    await store.login(credentials);
    store.deleteProject(project.id);
    expect(store.listProjects()).toEqual([]);
    expect(store.getProject(project.id)).toBeNull();
    expect(store.getArtist(artist.artistId!)?.totalRaised).toBe(200.75);
    expect(store.listArtists()[0]).toMatchObject({ totalRaised: 200.75, projectCount: 0 });
    expect(() => store.updateProject(project.id, { status: 'funding' })).toThrow();
    expect(() => store.toggleProjectSupport(project.id)).toThrow('not open');
    expect(store.getInvestment(pledge.id)).toBeNull();
    await store.login({ ...credentials, email: 'investor@example.invalid' });
    expect(() => store.createInvestment({ projectId: project.id, amount: 100 })).toThrow('not open');
    expect(store.getInvestment(pledge.id)).toMatchObject({ amount: 200.75, currency: 'USD', projectArchived: true });
    expect(createLocalStore(storage).listMyInvestments()).toHaveLength(1);
    store.logout();
    expect(store.getInvestment(pledge.id)).toBeNull();
  });

  it('enforces USD and exact cents for creation, updates and aggregates', async () => {
    const { store } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    expect(() => store.createProject({ ...projectInput, currency: 'EUR' as never })).toThrow('Only USD');
    expect(() => store.createProject({ ...projectInput, goalAmount: 100.001 })).toThrow('decimal');
    const project = store.createProject({ ...projectInput, goalAmount: 1000.25 });
    expect(project.currency).toBe('USD');
    expect(store.updateProject(project.id, { title: 'Updated' }).currency).toBe('USD');
    expect(() => store.updateProject(project.id, { currency: 'EUR' } as never)).toThrow('Only USD');
    await store.register({ ...credentials, email: 'investor@example.invalid', role: 'investor' });
    expect(() => store.createInvestment({ projectId: project.id, amount: 100.001 })).toThrow('decimal');
    store.createInvestment({ projectId: project.id, amount: 100.10 });
    store.createInvestment({ projectId: project.id, amount: 100.20 });
    expect(store.getProject(project.id)?.project.raisedAmount).toBe(200.30);
  });

  it.each(['{broken', '', 'null', '{"version":99}', '{"version":3,"accounts":[null]}'])(
    'allows backup and explicit reset of unreadable data: %s', raw => {
      const { store, storage } = fixture();
      storage.setItem(STORAGE_KEY, raw);
      expect(() => store.getCurrentUser()).toThrow(PreviewDataError);
      expect(store.exportData()).toBe(raw);
      store.reset();
      expect(store.getCurrentUser()).toBeNull();
      expect(store.listProjects()).toEqual([]);
    },
  );

  it('detects invalid records and broken references inside valid JSON', async () => {
    const { store, storage } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    store.createProject(projectInput);
    const raw = storage.getItem(STORAGE_KEY)!;
    const invalidRecord = JSON.parse(raw);
    invalidRecord.projects[0].title = 42;
    storage.setItem(STORAGE_KEY, JSON.stringify(invalidRecord));
    expect(() => store.getCurrentUser()).toThrow(PreviewDataError);
    const invalidReference = JSON.parse(raw);
    invalidReference.projects[0].artistId = 999;
    storage.setItem(STORAGE_KEY, JSON.stringify(invalidReference));
    expect(() => store.getCurrentUser()).toThrow(PreviewDataError);
    const invalidStatus = JSON.parse(raw);
    invalidStatus.projects[0].status = ['funding'];
    storage.setItem(STORAGE_KEY, JSON.stringify(invalidStatus));
    expect(() => store.getCurrentUser()).toThrow(PreviewDataError);
  });

  it('reports unavailable reads and failed resets without pretending data was cleared', () => {
    const denied = createLocalStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(() => denied.getSnapshot()).toThrow(PreviewDataError);
    expect(() => denied.reset()).toThrow('unavailable');
    const raw = '{broken';
    const full = createLocalStore({ getItem: () => raw, setItem: () => { throw new Error('quota'); } });
    expect(() => full.reset()).toThrow('full or unavailable');
    expect(full.exportData()).toBe(raw);
  });
});
