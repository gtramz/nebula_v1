import { artistSearchText } from './artist-search-genres.js';
import { normalizeTaxonomyTerm } from './artist-taxonomy.js';
import type {
  Artist, ArtistDetail, ArtistSummary, Investment, InvestmentInput,
  InvestorRegistration, ListArtistsParams, ListProjectsParams, LoginCredentials,
  Project, ProjectDetail, ProjectInput, ProjectUpdate, PublicVisibility, ReceivedInvestment, SessionUser, SessionUserRole,
  SupportState,
} from './types.js';

export type AccountRegistration = InvestorRegistration & { role: SessionUserRole };
export type LocalLogin = LoginCredentials;
export type ArtistProfileInput = Pick<Artist, 'name' | 'genre' | 'basedIn' | 'bio' | 'recordLabel' | 'picture' | 'creativeRoles' | 'genres' | 'genreIds' | 'collaborationAvailability' | 'externalLinks' | 'publicInterests'>;
export type ArtistIdentityUpdate = { profile?: Partial<ArtistProfileInput>; preferences?: ArtistPreferencesUpdate; onboarding?: ArtistOnboardingUpdate; expected?: { profile: Partial<Artist>; preferences: ArtistPreferences } };
export type PublicArtistProfile = { artist: Artist; projects: Project[]; opportunityProjectIds: number[] };

import { advanceArtistOnboarding, emptyArtistOnboarding, type ArtistOnboarding, type ArtistOnboardingUpdate, artistPreferencesUpdate, emptyArtistPreferences, mergeArtistPreferences, professionalIdentityUpdate, publicArtist, validateArtistProfileKeys, type ArtistPreferences, type ArtistPreferencesUpdate } from './artist-identity.js';

import { parseState, PreviewDataError, type State, type StoredProject, type StoredInvestment } from './state.js';
import { CURRENCY, isMoney, sumMoney } from './money.js';
export { PreviewDataError } from './state.js';

export const STORAGE_KEY = 'nebula-usd-preview';
export const SESSION_KEY = 'nebula-session';
const emptyState = (): State => ({
  version: 3, visibility: [], nextId: 1, currentAccountId: null,
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

async function passwordDigest(password: string, salt: string, iterations: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256',
  }, key, 256);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createLocalStore(storage: Pick<Storage, 'getItem' | 'setItem'>, session?: Pick<Storage, 'getItem' | 'setItem'>, passwordIterations = 100_000) {
  const listeners = new Set<() => void>();
  function readRaw(): string | null {
    try { return storage.getItem(STORAGE_KEY); }
    catch { throw new PreviewDataError('Browser storage is unavailable. Allow browser storage and try again.'); }
  }

  function read(): State {
    const raw = readRaw();
    const state = raw === null ? emptyState() : parseState(raw);
    if (session) {
      const currentId = Number(session.getItem(SESSION_KEY));
      state.currentAccountId = state.accounts.some(item => item.id === currentId) ? currentId : null;
    }
    return state;
  }

  function save(state: State) {
    try {
      const previousSession = session?.getItem(SESSION_KEY) ?? '';
      session?.setItem(SESSION_KEY, String(state.currentAccountId ?? ''));
      try { storage.setItem(STORAGE_KEY, JSON.stringify(session ? { ...state, currentAccountId: null } : state)); }
      catch (error) { session?.setItem(SESSION_KEY, previousSession); throw error; }
    } catch {
      throw new Error('Browser storage is full or unavailable. Your existing data has not been cleared. Try a smaller image.');
    }
    for (const listener of listeners) listener();
  }

  function event(state: State, type: 'registered' | 'login' | 'login_failed' | 'logout' | 'demo_cleared', accountId: number | null) {
    state.authEvents = [...(state.authEvents ?? []), { type, accountId, at: new Date().toISOString() }].slice(-200);
  }

  function currentAccount(state: State, role?: SessionUserRole): State['accounts'][number] {
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
      artistId: artist?.id ?? null, picture: artist?.picture ?? null, artist: artist ? publicArtist(artist) : null,
    };
  }

  function projectDto(state: State, project: StoredProject): Project {
    const artist = state.artists.find((item) => item.id === project.artistId);
    const investments = state.investments.filter((item) => item.projectId === project.id);
    return {
      ...project, currency: CURRENCY, status: project.status ?? 'draft',
      artistName: artist?.name ?? '', artistPicture: artist?.picture ?? null,
      raisedAmount: sumMoney(investments.map(item => item.amount)),
      backersCount: new Set(investments.map((item) => item.investorId)).size,
      supportsCount: state.supports.filter((item) => item.projectId === project.id).length,
    };
  }

  function investmentDto(state: State, investment: StoredInvestment): Investment {
    const project = state.projects.find(item => item.id === investment.projectId);
    const visibility = state.visibility.find(item => item.projectId === investment.projectId && item.investorId === investment.investorId);
    const { investorId: _investorId, ...receipt } = investment;
    return { ...receipt, publicVisibility: { showName: visibility?.showName ?? false, showAmount: visibility?.showAmount ?? false }, projectArchived: !project || !!project.archivedAt };
  }

  function validateVisibility(value: PublicVisibility): PublicVisibility {
    check(value && typeof value.showName === 'boolean' && typeof value.showAmount === 'boolean', 'Choose valid visibility settings.');
    return { showName: value.showName, showAmount: value.showAmount };
  }

  function setVisibility(state: State, projectId: number, investorId: number, value: PublicVisibility) {
    const settings = validateVisibility(value);
    const existing = state.visibility.find(item => item.projectId === projectId && item.investorId === investorId);
    if (existing) Object.assign(existing, settings);
    else state.visibility.push({ projectId, investorId, publicId: crypto.randomUUID(), ...settings });
  }

  function publicBackers(state: State, projectId: number): ProjectDetail['backers'] {
    const grouped = new Map<number, number[]>();
    for (const investment of state.investments.filter(item => item.projectId === projectId)) {
      const amounts = grouped.get(investment.investorId) ?? [];
      amounts.push(investment.amount);
      grouped.set(investment.investorId, amounts);
    }
    return [...grouped].map(([investorId, amounts], index) => {
      const visibility = state.visibility.find(item => item.projectId === projectId && item.investorId === investorId);
      return {
        publicId: visibility?.publicId ?? `anonymous-${index}`,
        name: visibility?.showName ? state.accounts.find(item => item.id === investorId)?.name ?? null : null,
        amount: visibility?.showAmount ? sumMoney(amounts) : null,
      };
    });
  }

  function visibleProjects(state: State): StoredProject[] {
    const viewer = sessionUser(state);
    return state.projects.filter((item) => !item.archivedAt && (item.status !== 'draft' || viewer?.artistId === item.artistId));
  }

  function validateProject(input: ProjectInput): ProjectInput {
    const title = input.title.trim();
    const category = input.category.trim();
    check(title.length > 0 && title.length <= 160, 'Enter a project title of up to 160 characters.');
    check(category.length > 0 && category.length <= 60, 'Choose a project category.');
    check(isMoney(input.goalAmount, 0.01, 100_000_000),
      'Enter a USD funding goal from 0.01 to 100,000,000 with at most two decimal places.');
    check(['draft', 'published', 'funding', 'funded', 'closed'].includes(input.status ?? 'draft'), 'Choose a valid project status.');
    check((input.currency ?? CURRENCY) === CURRENCY, 'Only USD is supported.');
    const funds = input.useOfFunds ?? [];
    check(funds.every((item) => item.label.trim().length > 0 && Number.isFinite(item.percentage)
      && item.percentage >= 0 && item.percentage <= 100), 'Check the use of funds.');
    check(!funds.length || Math.abs(funds.reduce((sum, item) => sum + item.percentage, 0) - 100) < 0.01,
      'Use of funds must add up to 100%.');
    return { ...input, currency: CURRENCY, title, category, coverUrl: localImage(input.coverUrl), status: input.status ?? 'draft' };
  }

  function ownedProject(state: State, id: number): StoredProject {
    const account = currentAccount(state, 'artist');
    const project = state.projects.find((item) => item.id === id);
    check(project && !project.archivedAt && project.artistId === account.id, 'This project does not belong to this artist.');
    return project;
  }

  function applyArtistProfile(state: State, input: ArtistProfileInput): Artist {
      const account = currentAccount(state, 'artist');
      const artist = state.artists.find((item) => item.id === account.id)!;
      validateArtistProfileKeys(input);
      const professional = professionalIdentityUpdate(input);
      check(typeof input.name === 'string', 'Enter an artist name.');
      const name = input.name.trim();
      check(name.length >= 2 && name.length <= 120, 'Enter an artist name between 2 and 120 characters.');
      const basic: Partial<Artist> = { name };
      for (const key of ['genre', 'basedIn', 'bio', 'recordLabel'] as const) {
        if (input[key] !== undefined) {
          check(input[key] === null || (typeof input[key] === 'string' && input[key]!.length <= (key === 'bio' ? 4000 : 120)), `Invalid ${key}.`);
          basic[key] = input[key];
        }
      }
      if (input.picture !== undefined) basic.picture = localImage(input.picture);
      if (professional.creativeRoles !== undefined) {
        const unresolved = publicArtist(artist).identityReview!.creativeRoles;
        check(unresolved.length <= 100, 'Previous role information needs review before editing. Your saved data has been preserved.');
        if (unresolved.length) artist.legacyCreativeRoles = unresolved;
      }
      Object.assign(artist, basic, professional);
      account.name = name;
      return publicArtist(artist);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notify() { for (const listener of listeners) listener(); },
    getSnapshot: () => `${readRaw() ?? ''}|${session?.getItem(SESSION_KEY) ?? ''}`,
    listAuthEvents() {
      const state = read();
      const account = currentAccount(state);
      return (state.authEvents ?? []).filter(item => item.accountId === account.id).slice(-20).reverse();
    },
    exportData: readRaw,
    getCurrentUser: () => sessionUser(read()),
    async register(input: AccountRegistration): Promise<SessionUser> {
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      check(name.length >= 2 && name.length <= 120, 'Enter a name between 2 and 120 characters.');
      check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 'Enter a valid email address.');
      check(input.password.length >= 8 && input.password.length <= 128, 'Use a password between 8 and 128 characters.');
      check(input.role === 'artist' || input.role === 'investor', 'Choose an artist or investor profile.');
      const salt = crypto.randomUUID();
      const digest = await passwordDigest(input.password, salt, passwordIterations);
      const state = read();
      check(!state.accounts.some((item) => item.email === email),
        'This profile already exists in this browser. Log in with your existing password.');
      const id = state.nextId++;
      state.accounts.push({ id, name, email, role: input.role, salt, passwordDigest: digest, createdAt: new Date().toISOString() });
      if (input.role === 'artist') state.artists.push({ id, name, picture: null, genre: null, basedIn: null, bio: null, recordLabel: null });
      state.currentAccountId = id;
      event(state, 'registered', id);
      save(state);
      return sessionUser(state)!;
    },
    async login(input: LocalLogin): Promise<SessionUser> {
      let state = read();
      const email = input.email.trim().toLowerCase();
      const candidates = state.accounts.filter(item => item.email === email);
      if (!candidates.length) {
        event(state, 'login_failed', null); save(state);
        throw new Error('No account with this email is saved in this browser. Use the browser where you registered, or create an account.');
      }
      const matches = [];
      for (const candidate of candidates) {
        if (await passwordDigest(input.password, candidate.salt, passwordIterations) === candidate.passwordDigest) matches.push(candidate);
      }
      state = read();
      const valid = matches.filter(candidate => state.accounts.some(latest => latest.id === candidate.id
        && latest.email === email && latest.salt === candidate.salt && latest.passwordDigest === candidate.passwordDigest));
      if (!valid.length) {
        event(state, 'login_failed', candidates.length === 1 ? candidates[0].id : null); save(state);
        throw new Error('Incorrect password. Check your password and try again.');
      }
      if (valid.length > 1) {
        event(state, 'login_failed', null); save(state);
        throw new Error('This email has duplicate older accounts with the same password. Account recovery is needed before signing in. Your profiles and data have been kept.');
      }
      const account = valid[0];
      const latest = state.accounts.find(item => item.id === account.id)!;
      latest.lastLoginAt = new Date().toISOString();
      state.currentAccountId = account.id;
      event(state, 'login', account.id);
      save(state);
      return sessionUser(state)!;
    },
    logout(): void {
      const state = read();
      event(state, 'logout', state.currentAccountId);
      state.currentAccountId = null;
      save(state);
    },
    reset(): void { save(emptyState()); },
    clearDemoData(): void {
      const state = read();
      state.projects = []; state.investments = []; state.supports = []; state.visibility = [];
      event(state, 'demo_cleared', state.currentAccountId);
      save(state);
    },
    updateArtist(input: ArtistProfileInput): Artist {
      const state = read(), artist = applyArtistProfile(state, input); save(state); return artist;
    },
    getMyArtistOnboarding(): ArtistOnboarding {
      return currentAccount(read(), 'artist').artistOnboarding ?? emptyArtistOnboarding();
    },
    updateArtistIdentity(input: ArtistIdentityUpdate) {
      const state = read(), account = currentAccount(state, 'artist');
      check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['profile', 'preferences', 'onboarding', 'expected'].includes(key)), 'Unsupported artist identity field.');
      const currentArtist = publicArtist(state.artists.find(a => a.id === account.id)!);
      if (input.expected !== undefined) {
        const expected = input.expected;
        check(expected && typeof expected === 'object' && expected.profile && expected.preferences, 'Invalid profile edit baseline.');
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        const conflict = 'Your profile changed in another tab. Cancel and reopen the editor to review the latest version before saving.';
        for (const key of Object.keys(input.profile ?? {}) as (keyof Artist)[]) check(same(currentArtist[key], expected.profile[key]), conflict);
        const currentPreferences = account.artistPreferences ?? emptyArtistPreferences();
        for (const group of ['collaboration', 'discovery'] as const) {
          for (const key of Object.keys(input.preferences?.[group] ?? {})) {
            check(same((currentPreferences[group] as unknown as Record<string, unknown>)[key], (expected.preferences[group] as unknown as Record<string, unknown>)?.[key]), conflict);
          }
        }
      }
      // Validate every section before committing any change. One existing state write.
      const preferences = input.preferences !== undefined ? mergeArtistPreferences(account.artistPreferences, artistPreferencesUpdate(input.preferences)) : undefined;
      const onboarding = input.onboarding !== undefined ? advanceArtistOnboarding(account.artistOnboarding, input.onboarding) : undefined;
      if (input.profile !== undefined) applyArtistProfile(state, { name: currentArtist.name, ...input.profile });
      if (preferences) account.artistPreferences = preferences;
      if (onboarding) account.artistOnboarding = onboarding;
      save(state);
      return { artist: publicArtist(state.artists.find(a => a.id === account.id)!), preferences: account.artistPreferences ?? emptyArtistPreferences(), onboarding: account.artistOnboarding ?? emptyArtistOnboarding() };
    },
    getMyArtistPreferences(): ArtistPreferences {
      return currentAccount(read(), 'artist').artistPreferences ?? emptyArtistPreferences();
    },
    updateMyArtistPreferences(input: ArtistPreferencesUpdate): ArtistPreferences {
      const state = read(), account = currentAccount(state, 'artist');
      const patch = artistPreferencesUpdate(input);
      // The caller never supplies the owner. Preserve unspecified nested fields.
      account.artistPreferences = mergeArtistPreferences(account.artistPreferences, patch);
      save(state);
      return account.artistPreferences;
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
      const project = ownedProject(state, id);
      project.archivedAt = new Date().toISOString();
      project.status = 'closed';
      save(state);
    },
    getProject(id: number): ProjectDetail | null {
      const state = read();
      const project = visibleProjects(state).find((item) => item.id === id);
      if (!project) return null;
      const viewer = sessionUser(state);
      return {
        project: projectDto(state, project), artist: publicArtist(state.artists.find((item) => item.id === project.artistId)!),
        backers: publicBackers(state, id),
        viewerVisibility: viewer?.role === 'investor' ? (() => {
          const settings = state.visibility.find(item => item.projectId === id && item.investorId === viewer.investorId);
          return { showName: settings?.showName ?? false, showAmount: settings?.showAmount ?? false };
        })() : undefined,
        supporters: state.supports.filter((item) => item.projectId === id).map((item) => ({
          artistId: item.artistId, name: state.artists.find((artist) => artist.id === item.artistId)?.name ?? '',
          picture: state.artists.find((artist) => artist.id === item.artistId)?.picture ?? null, createdAt: item.createdAt,
        })),
        viewerHasSupported: state.supports.some((item) => item.projectId === id && item.artistId === viewer?.artistId),
      };
    },
    listArtists(params: ListArtistsParams = {}): ArtistSummary[] {
      const state = read();
      const query = params.search?.trim(), search = normalizeTaxonomyTerm(query ?? '').trim();
      return state.artists.filter((artist) => !query || artist.name.toLowerCase().includes(query.toLowerCase()) || (!!search && artistSearchText(artist).includes(search))).map((artist) => {
        const projects = visibleProjects(state).filter((item) => item.artistId === artist.id);
        const ids = new Set(state.projects.filter(item => item.artistId === artist.id
          && (item.archivedAt || projects.some(project => project.id === item.id))).map(item => item.id));
        return { ...publicArtist(artist), projectCount: projects.length,
          totalRaised: sumMoney(state.investments.filter((item) => ids.has(item.projectId!)).map(item => item.amount)),
          supportersCount: new Set(state.supports.filter((item) => ids.has(item.projectId)).map((item) => item.artistId)).size };
      });
    },
    getPublicArtist(id: number): PublicArtistProfile | null {
      const state = read(), artist = state.artists.find(item => item.id === id);
      if (!artist) return null;
      const projects = state.projects.filter(p => p.artistId === id && ['published','funding','funded','closed'].includes(p.status ?? 'draft') && !p.archivedAt).map(p => projectDto(state, p));
      return { artist: publicArtist(artist), projects, opportunityProjectIds: projects.filter(p => p.status === 'funding').map(p => p.id) };
    },
    getArtist(id: number): ArtistDetail | null {
      const state = read();
      const artist = state.artists.find((item) => item.id === id);
      if (!artist) return null;
      const projects = visibleProjects(state).filter((item) => item.artistId === id).map((item) => projectDto(state, item));
      const ids = new Set(state.projects.filter(item => item.artistId === id
        && (item.archivedAt || projects.some(project => project.id === item.id))).map(item => item.id));
      return { artist: publicArtist(artist), projects, totalRaised: sumMoney(state.investments.filter(item => ids.has(item.projectId!)).map(item => item.amount)),
        totalGoal: sumMoney(projects.map(item => item.goalAmount)),
        backersCount: new Set(state.investments.filter((item) => ids.has(item.projectId!)).map((item) => item.investorId)).size };
    },
    createInvestment(input: InvestmentInput): Investment {
      const state = read();
      const investor = currentAccount(state, 'investor');
      const project = state.projects.find((item) => item.id === input.projectId);
      check(project?.status === 'funding' && !project.archivedAt, 'This project is not open for contributions.');
      check(isMoney(input.amount, 100, 10_000_000),
        'Enter a USD preview amount from 100 to 10,000,000 with at most two decimal places.');
      const artist = state.artists.find((item) => item.id === project.artistId)!;
      const investment: StoredInvestment = {
        id: state.nextId++, investorId: investor.id, projectId: project.id, projectTitle: project.title,
        artistId: artist.id, artistName: artist.name, amount: Math.round(input.amount * 100) / 100,
        currency: CURRENCY, status: 'preview', createdAt: new Date().toISOString(),
      };
      const existing = state.visibility.find(item => item.projectId === project.id && item.investorId === investor.id);
      setVisibility(state, project.id, investor.id, input.publicVisibility ?? existing ?? { showName: false, showAmount: false });
      state.investments.push(investment);
      save(state);
      return investment;
    },
    updateProjectVisibility(projectId: number, value: PublicVisibility): PublicVisibility {
      const state = read();
      const investor = currentAccount(state, 'investor');
      check(state.investments.some(item => item.projectId === projectId && item.investorId === investor.id), 'You have not backed this project.');
      setVisibility(state, projectId, investor.id, value);
      save(state);
      return validateVisibility(value);
    },
    listReceivedInvestments(): ReceivedInvestment[] {
      const state = read();
      const artist = currentAccount(state, 'artist');
      return state.investments.filter(item => item.artistId === artist.id).map(item => {
        const { publicVisibility: _visibility, ...receipt } = investmentDto(state, item);
        return { ...receipt, investorName: state.accounts.find(account => account.id === item.investorId)?.name ?? '' };
      }).reverse();
    },
    listMyInvestments(): Investment[] {
      const state = read();
      const account = state.accounts.find((item) => item.id === state.currentAccountId);
      return account?.role === 'investor' ? state.investments.filter((item) => item.investorId === account.id).map(item => investmentDto(state, item)).reverse() : [];
    },
    getInvestment(id: number): Investment | null {
      const state = read();
      const viewer = sessionUser(state);
      const investment = state.investments.find((item) => item.id === id && item.investorId === viewer?.investorId);
      return investment ? investmentDto(state, investment) : null;
    },
    toggleProjectSupport(id: number): SupportState {
      const state = read();
      const artist = currentAccount(state, 'artist');
      const project = state.projects.find((item) => item.id === id);
      check(project?.status === 'funding' && !project.archivedAt, 'This project is not open for support.');
      check(project.artistId !== artist.id, 'Choose another artist to support.');
      const supported = !state.supports.some((item) => item.projectId === id && item.artistId === artist.id);
      if (supported) state.supports.push({ projectId: id, artistId: artist.id, createdAt: new Date().toISOString() });
      else state.supports = state.supports.filter((item) => item.projectId !== id || item.artistId !== artist.id);
      save(state);
      return { supported, supportsCount: state.supports.filter((item) => item.projectId === id).length };
    },
  };
}
