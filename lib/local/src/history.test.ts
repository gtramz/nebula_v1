import { expect, it } from 'vitest';
import { createLocalStore, STORAGE_KEY } from './store';

const artist = { name: 'Artist', email: 'artist@example.invalid', password: 'preview123', role: 'artist' as const };
const investor = { name: 'Investor', email: 'investor@example.invalid', password: 'preview123', role: 'investor' as const };
async function fixture() {
  let raw: string | null = null;
  const storage = { getItem: (_key: string) => raw, setItem: (_key: string, value: string) => { raw = value; } };
  const store = createLocalStore(storage);
  await store.register(artist);
  const project = store.createProject({ title: 'Album', category: 'Album', goalAmount: 5000, status: 'funding' });
  await store.register(investor);
  return { store, project, storage };
}

it('groups repeat contributions by identity and defaults to anonymous, hidden amounts', async () => {
  const { store, project } = await fixture();
  store.createInvestment({ projectId: project.id, amount: 100.10 });
  store.createInvestment({ projectId: project.id, amount: 200.20 });
  expect(store.listMyInvestments()).toHaveLength(2);
  store.logout();
  const detail = store.getProject(project.id)!;
  expect(detail.project).toMatchObject({ raisedAmount: 300.30, backersCount: 1 });
  expect(detail.backers).toHaveLength(1);
  expect(detail.backers[0]).toEqual({ publicId: expect.any(String), name: null, amount: null });
  expect(detail.viewerVisibility).toBeUndefined();
});

it('applies independent visibility settings retroactively, retains them across reloads and new contributions', async () => {
  const { store, project, storage } = await fixture();
  store.createInvestment({ projectId: project.id, amount: 100.10 });
  const id = store.getProject(project.id)!.backers[0].publicId;
  for (const showName of [false, true]) for (const showAmount of [false, true]) {
    store.updateProjectVisibility(project.id, { showName, showAmount });
    expect(store.getProject(project.id)!.backers[0]).toEqual({ publicId: id, name: showName ? 'Investor' : null, amount: showAmount ? 100.10 : null });
  }
  store.createInvestment({ projectId: project.id, amount: 200.20 });
  expect(createLocalStore(storage).getProject(project.id)!.backers).toEqual([{ publicId: id, name: 'Investor', amount: 300.30 }]);
  store.updateProjectVisibility(project.id, { showName: false, showAmount: false });
  expect(store.listMyInvestments().every(item => !item.publicVisibility?.showName && !item.publicVisibility?.showAmount)).toBe(true);
  expect(store.getProject(project.id)!.backers[0]).toMatchObject({ name: null, amount: null });
});

it('does not merge distinct investors with the same name or share preferences across projects', async () => {
  const { store, project } = await fixture();
  store.createInvestment({ projectId: project.id, amount: 100, publicVisibility: { showName: true, showAmount: true } });
  await store.register({ ...investor, email: 'other@example.invalid' });
  store.createInvestment({ projectId: project.id, amount: 200 });
  expect(store.getProject(project.id)!.backers).toMatchObject([{ name: 'Investor', amount: 100 }, { name: null, amount: null }]);
  await store.login(artist);
  const second = store.createProject({ title: 'Second', category: 'EP', goalAmount: 5000, status: 'funding' });
  await store.login(investor);
  store.createInvestment({ projectId: second.id, amount: 300 });
  expect(store.getProject(second.id)!.backers[0]).toMatchObject({ name: null, amount: null });
});

it('keeps received history private to the recipient artist, including removed projects', async () => {
  const { store, project } = await fixture();
  const receipt = store.createInvestment({ projectId: project.id, amount: 250.25 });
  expect(() => store.listReceivedInvestments()).toThrow();
  await store.login(artist);
  expect(store.listReceivedInvestments()).toMatchObject([{ investorName: 'Investor', amount: 250.25 }]);
  expect(store.getInvestment(receipt.id)).toBeNull();
  expect(() => store.updateProjectVisibility(project.id, { showName: true, showAmount: true })).toThrow();
  store.deleteProject(project.id);
  expect(store.listReceivedInvestments()).toMatchObject([{ projectArchived: true, investorName: 'Investor', amount: 250.25 }]);
  await store.register({ ...artist, email: 'stranger@example.invalid' });
  expect(store.listReceivedInvestments()).toEqual([]);
  store.logout();
  expect(() => store.listReceivedInvestments()).toThrow();
});

it('rejects unauthorized or malformed visibility changes without changing the stored receipt', async () => {
  const { store, project, storage } = await fixture();
  expect(() => store.updateProjectVisibility(project.id, { showName: true, showAmount: true })).toThrow('not backed');
  const receipt = store.createInvestment({ projectId: project.id, amount: 100 });
  const raw = storage.getItem(STORAGE_KEY);
  expect(() => store.updateProjectVisibility(project.id, { showName: 'true', showAmount: false } as never)).toThrow('valid visibility');
  expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  await store.register({ ...investor, email: 'stranger@example.invalid' });
  expect(() => store.updateProjectVisibility(project.id, { showName: true, showAmount: true })).toThrow('not backed');
  expect(store.getInvestment(receipt.id)).toBeNull();
});
