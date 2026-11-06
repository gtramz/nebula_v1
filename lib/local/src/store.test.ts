import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStore, STORAGE_KEY } from './store';

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
    await expect(store.login({ ...credentials, password: 'incorrect', role: 'artist' })).rejects.toThrow();
    await store.login({ ...credentials, role: 'artist' });
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
    await store.register({ ...credentials, role: 'investor' });
    expect(() => store.createProject(projectInput)).toThrow();
    expect(() => store.toggleProjectSupport(project.id)).toThrow();
  });

  it('previews pledges and receipts without making a payment', async () => {
    const { store } = fixture();
    await store.register({ ...credentials, role: 'artist' });
    const project = store.createProject(projectInput);
    await store.register({ ...credentials, name: 'Investor One', role: 'investor' });
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
});
