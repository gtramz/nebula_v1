import type {
  Artist, ArtistDetail, ArtistSummary, Investment, InvestmentInput,
  InvestorRegistration, ListArtistsParams, ListProjectsParams, LoginCredentials,
  Project, ProjectDetail, ProjectInput, ProjectUpdate, SessionUser, SessionUserRole,
  SupportState,
} from './types';

export type AccountRegistration = InvestorRegistration & { role: SessionUserRole };
export type LocalLogin = LoginCredentials & { role: SessionUserRole };
export type ArtistProfileInput = Pick<Artist, 'name' | 'genre' | 'basedIn' | 'bio' | 'recordLabel' | 'picture'>;

type Account = {
  id: number;
  role: SessionUserRole;
  name: string;
  email: string;
  salt: string;
  passwordDigest: string;
};
type StoredProject = ProjectInput & { id: number; artistId: number; createdAt: string };
type StoredInvestment = Investment & { investorId: number };
type Support = { projectId: number; artistId: number; createdAt: string };
type State = {
  version: 1;
  nextId: number;
  currentAccountId: number | null;
  accounts: Account[];
  artists: Artist[];
  projects: StoredProject[];
  investments: StoredInvestment[];
  supports: Support[];
};

export const STORAGE_KEY = 'nebula-v1-shell';
const emptyState = (): State => ({
  version: 1, nextId: 1, currentAccountId: null,
  accounts: [], artists: [], projects: [], investments: [], supports: [],
});

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function localImage(value: string | null | undefined): string | null {
  if (!value) return null;
  check(value.length <= 1_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value),
    'Choose a PNG, JPEG or WebP image from your device.');
  return value;
}

async function passwordDigest(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100_000, hash: 'SHA-256',
  }, key, 256);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createLocalStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const listeners = new Set<() => void>();
  function read(): State {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const state: State = JSON.parse(raw);
    check(state.version === 1 && Array.isArray(state.accounts) && Array.isArray(state.artists)
      && Array.isArray(state.projects) && Array.isArray(state.investments) && Array.isArray(state.supports),
    'This preview data cannot be read. Clear the tab data to start again.');
    return state;
  }

  function save(state: State) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      throw new Error('The tab storage is full or unavailable. Try a smaller image or clear the preview.');
    }
    for (const listener of listeners) listener();
  }

  function currentAccount(state: State, role?: SessionUserRole): Account {
    const account = state.accounts.find((item) => item.id === state.currentAccountId);
    check(account && (!role || account.role === role), `Choose an ${role ?? 'account'} profile to continue.`);
    return account;
  }

  function sessionUser(state: State): SessionUser | null {
    const account = state.accounts.find((item) => item.id === state.currentAccountId);
    if (!account) return null;
    const artist = account.role === 'artist' ? state.artists.find((item) => item.id === account.id) ?? null : null;
    return {
      role: account.role, name: account.name, email: account.email,
      investorId: account.role === 'investor' ? account.id : null,
      artistId: artist?.id ?? null, picture: artist?.picture ?? null, artist,
    };
  }

  function projectDto(state: State, project: StoredProject): Project {
    const artist = state.artists.find((item) => item.id === project.artistId);
    const investments = state.investments.filter((item) => item.projectId === project.id);
    return {
      ...project, currency: project.currency ?? 'MXN', status: project.status ?? 'draft',
      artistName: artist?.name ?? '', artistPicture: artist?.picture ?? null,
      raisedAmount: investments.reduce((sum, item) => sum + item.amount, 0),
      backersCount: new Set(investments.map((item) => item.investorId)).size,
      supportsCount: state.supports.filter((item) => item.projectId === project.id).length,
    };
  }

  function visibleProjects(state: State): StoredProject[] {
    const viewer = sessionUser(state);
    return state.projects.filter((item) => item.status !== 'draft' || viewer?.artistId === item.artistId);
  }

  function validateProject(input: ProjectInput): ProjectInput {
    const title = input.title.trim();
    const category = input.category.trim();
    check(title.length > 0 && title.length <= 160, 'Enter a project title of up to 160 characters.');
    check(category.length > 0 && category.length <= 60, 'Choose a project category.');
    check(Number.isFinite(input.goalAmount) && input.goalAmount > 0 && input.goalAmount <= 100_000_000,
      'Enter a funding goal between 0 and 100,000,000.');
    check(['draft', 'published', 'funding', 'funded', 'closed'].includes(input.status ?? 'draft'), 'Choose a valid project status.');
    check(['MXN', 'USD'].includes(input.currency ?? 'MXN'), 'Choose a valid currency.');
    const funds = input.useOfFunds ?? [];
    check(funds.every((item) => item.label.trim().length > 0 && Number.isFinite(item.percentage)
      && item.percentage >= 0 && item.percentage <= 100), 'Check the use of funds.');
    check(!funds.length || Math.abs(funds.reduce((sum, item) => sum + item.percentage, 0) - 100) < 0.01,
      'Use of funds must add up to 100%.');
    return { ...input, title, category, coverUrl: localImage(input.coverUrl), status: input.status ?? 'draft' };
  }

  function ownedProject(state: State, id: number): StoredProject {
    const account = currentAccount(state, 'artist');
    const project = state.projects.find((item) => item.id === id);
    check(project && project.artistId === account.id, 'This project does not belong to this artist.');
    return project;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => storage.getItem(STORAGE_KEY),
    getCurrentUser: () => sessionUser(read()),
    async register(input: AccountRegistration): Promise<SessionUser> {
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      check(name.length >= 2 && name.length <= 120, 'Enter a name between 2 and 120 characters.');
      check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 'Enter a valid email address.');
      check(input.password.length >= 8 && input.password.length <= 128, 'Use a password between 8 and 128 characters.');
      check(input.role === 'artist' || input.role === 'investor', 'Choose an artist or investor profile.');
      const salt = crypto.randomUUID();
      const digest = await passwordDigest(input.password, salt);
      const state = read();
      check(!state.accounts.some((item) => item.email === email && item.role === input.role),
        'This profile already exists in this tab.');
      const id = state.nextId++;
      state.accounts.push({ id, name, email, role: input.role, salt, passwordDigest: digest });
      if (input.role === 'artist') state.artists.push({ id, name, picture: null, genre: null, basedIn: null, bio: null, recordLabel: null });
      state.currentAccountId = id;
      save(state);
      return sessionUser(state)!;
    },
    async login(input: LocalLogin): Promise<SessionUser> {
      let state = read();
      const email = input.email.trim().toLowerCase();
      const account = state.accounts.find((item) => item.email === email && item.role === input.role);
      check(account && await passwordDigest(input.password, account.salt) === account.passwordDigest,
        'The email or password does not match a profile in this tab.');
      state = read();
      check(state.accounts.some((item) => item.id === account.id), 'Create a profile in this tab first.');
      state.currentAccountId = account.id;
      save(state);
      return sessionUser(state)!;
    },
    logout(): void {
      const state = read();
      state.currentAccountId = null;
      save(state);
    },
    reset(): void { save(emptyState()); },
    updateArtist(input: ArtistProfileInput): Artist {
      const state = read();
      const account = currentAccount(state, 'artist');
      const artist = state.artists.find((item) => item.id === account.id)!;
      const name = input.name.trim();
      check(name.length >= 2 && name.length <= 120, 'Enter an artist name between 2 and 120 characters.');
      Object.assign(artist, { ...input, name, picture: localImage(input.picture) });
      account.name = name;
      save(state);
      return artist;
    },
    listProjects(params: ListProjectsParams = {}): Project[] {
      const state = read();
      const search = params.search?.trim().toLowerCase();
      return visibleProjects(state).map((item) => projectDto(state, item)).filter((item) =>
        (!params.category || params.category.toLowerCase() === 'all' || item.category.toLowerCase() === params.category.toLowerCase())
        && (!params.status || item.status === params.status)
        && (!search || `${item.title} ${item.artistName} ${item.pitch ?? ''}`.toLowerCase().includes(search)),
      ).reverse();
    },
    createProject(input: ProjectInput): Project {
      const state = read();
      const account = currentAccount(state, 'artist');
      const project = { ...validateProject(input), id: state.nextId++, artistId: account.id, createdAt: new Date().toISOString() };
      state.projects.push(project);
      save(state);
      return projectDto(state, project);
    },
    updateProject(id: number, input: ProjectUpdate): Project {
      const state = read();
      const project = ownedProject(state, id);
      Object.assign(project, validateProject({ ...project, ...input }));
      save(state);
      return projectDto(state, project);
    },
    deleteProject(id: number): void {
      const state = read();
      ownedProject(state, id);
      state.projects = state.projects.filter((item) => item.id !== id);
      state.investments = state.investments.filter((item) => item.projectId !== id);
      state.supports = state.supports.filter((item) => item.projectId !== id);
      save(state);
    },
    getProject(id: number): ProjectDetail | null {
      const state = read();
      const project = visibleProjects(state).find((item) => item.id === id);
      if (!project) return null;
      const viewer = sessionUser(state);
      return {
        project: projectDto(state, project), artist: state.artists.find((item) => item.id === project.artistId)!,
        backers: state.investments.filter((item) => item.projectId === id).map((item) => ({
          name: state.accounts.find((account) => account.id === item.investorId)?.name ?? '',
          amount: item.amount, createdAt: item.createdAt,
        })),
        supporters: state.supports.filter((item) => item.projectId === id).map((item) => ({
          artistId: item.artistId, name: state.artists.find((artist) => artist.id === item.artistId)?.name ?? '',
          picture: state.artists.find((artist) => artist.id === item.artistId)?.picture ?? null, createdAt: item.createdAt,
        })),
        viewerHasSupported: state.supports.some((item) => item.projectId === id && item.artistId === viewer?.artistId),
      };
    },
    listArtists(params: ListArtistsParams = {}): ArtistSummary[] {
      const state = read();
      const search = params.search?.trim().toLowerCase();
      return state.artists.filter((artist) => !search || `${artist.name} ${artist.genre ?? ''}`.toLowerCase().includes(search)).map((artist) => {
        const projects = visibleProjects(state).filter((item) => item.artistId === artist.id);
        const ids = new Set(projects.map((item) => item.id));
        return { ...artist, projectCount: projects.length,
          totalRaised: state.investments.filter((item) => ids.has(item.projectId!)).reduce((sum, item) => sum + item.amount, 0),
          supportersCount: new Set(state.supports.filter((item) => ids.has(item.projectId)).map((item) => item.artistId)).size };
      });
    },
    getArtist(id: number): ArtistDetail | null {
      const state = read();
      const artist = state.artists.find((item) => item.id === id);
      if (!artist) return null;
      const projects = visibleProjects(state).filter((item) => item.artistId === id).map((item) => projectDto(state, item));
      const ids = new Set(projects.map((item) => item.id));
      return { artist, projects, totalRaised: projects.reduce((sum, item) => sum + item.raisedAmount, 0),
        totalGoal: projects.reduce((sum, item) => sum + item.goalAmount, 0),
        backersCount: new Set(state.investments.filter((item) => ids.has(item.projectId!)).map((item) => item.investorId)).size };
    },
    createInvestment(input: InvestmentInput): Investment {
      const state = read();
      const investor = currentAccount(state, 'investor');
      const project = state.projects.find((item) => item.id === input.projectId);
      check(project?.status === 'funding', 'This project is not open for contributions.');
      check(Number.isFinite(input.amount) && input.amount >= 100 && input.amount <= 10_000_000,
        'Enter a preview amount between 100 and 10,000,000.');
      const artist = state.artists.find((item) => item.id === project.artistId)!;
      const investment: StoredInvestment = {
        id: state.nextId++, investorId: investor.id, projectId: project.id, projectTitle: project.title,
        artistId: artist.id, artistName: artist.name, amount: Math.round(input.amount * 100) / 100,
        currency: project.currency ?? 'MXN', status: 'preview', createdAt: new Date().toISOString(),
      };
      state.investments.push(investment);
      save(state);
      return investment;
    },
    listMyInvestments(): Investment[] {
      const state = read();
      const account = state.accounts.find((item) => item.id === state.currentAccountId);
      return account?.role === 'investor' ? state.investments.filter((item) => item.investorId === account.id).reverse() : [];
    },
    getInvestment(id: number): Investment | null {
      const state = read();
      const viewer = sessionUser(state);
      return state.investments.find((item) => item.id === id && item.investorId === viewer?.investorId) ?? null;
    },
    toggleProjectSupport(id: number): SupportState {
      const state = read();
      const artist = currentAccount(state, 'artist');
      const project = state.projects.find((item) => item.id === id);
      check(project?.status === 'funding', 'This project is not open for support.');
      check(project.artistId !== artist.id, 'Choose another artist to support.');
      const supported = !state.supports.some((item) => item.projectId === id && item.artistId === artist.id);
      if (supported) state.supports.push({ projectId: id, artistId: artist.id, createdAt: new Date().toISOString() });
      else state.supports = state.supports.filter((item) => item.projectId !== id || item.artistId !== artist.id);
      save(state);
      return { supported, supportsCount: state.supports.filter((item) => item.projectId === id).length };
    },
  };
}

let browserStore: ReturnType<typeof createLocalStore> | undefined;
export function getLocalStore() {
  return browserStore ??= createLocalStore(window.sessionStorage);
}
