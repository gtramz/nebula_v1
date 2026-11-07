import type { Artist, Investment, ProjectInput, PublicVisibility, SessionUserRole } from './types.js';
import { isMoney } from './money.js';

type Account = {
  id: number;
  role: SessionUserRole;
  name: string;
  email: string;
  salt: string;
  passwordDigest: string;
  createdAt?: string;
  lastLoginAt?: string;
};
export type StoredProject = ProjectInput & { id: number; artistId: number; createdAt: string; archivedAt?: string };
export type StoredInvestment = Investment & { investorId: number };
export type State = {
  version: 3;
  imports?: string[];
  authEvents?: { type: 'registered' | 'login' | 'login_failed' | 'logout' | 'demo_cleared'; accountId: number | null; at: string }[];
  visibility: (PublicVisibility & { projectId: number; investorId: number; publicId: string })[];
  nextId: number;
  currentAccountId: number | null;
  accounts: Account[];
  artists: Artist[];
  projects: StoredProject[];
  investments: StoredInvestment[];
  supports: { projectId: number; artistId: number; createdAt: string }[];
};

export class PreviewDataError extends Error {
  constructor(message = 'The saved preview data is damaged or incompatible. Download a backup before starting a new preview.') {
    super(message);
    this.name = 'PreviewDataError';
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const string = (value: unknown): value is string => typeof value === 'string';
const date = (value: unknown) => string(value) && Number.isFinite(Date.parse(value));
const optionalStrings = (value: Record<string, unknown>, fields: string[]) => fields.every(key => value[key] == null || string(value[key]));
const image = (value: unknown) => value == null || (string(value) && value.length <= 1_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value));
const arrayOf = (value: unknown, valid: (item: unknown) => boolean): value is unknown[] => Array.isArray(value) && value.every(valid);

export function parseState(raw: string): State {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new PreviewDataError(); }
  if (!record(value) || value.version !== 3) throw new PreviewDataError();
  const valid = (value.imports === undefined || arrayOf(value.imports, item => string(item) && /^[a-f0-9]{64}$/.test(item)))
    && (value.authEvents === undefined || arrayOf(value.authEvents, item => record(item)
      && ['registered', 'login', 'login_failed', 'logout', 'demo_cleared'].includes(String(item.type))
      && (item.accountId === null || id(item.accountId)) && date(item.at)))
    && arrayOf(value.visibility, item => record(item) && id(item.projectId) && id(item.investorId)
      && string(item.publicId) && item.publicId.length > 0 && typeof item.showName === 'boolean' && typeof item.showAmount === 'boolean')
    && id(value.nextId) && (value.currentAccountId === null || id(value.currentAccountId))
    && arrayOf(value.accounts, item => record(item) && id(item.id) && (item.role === 'artist' || item.role === 'investor')
      && string(item.name) && string(item.email) && string(item.salt) && string(item.passwordDigest)
      && (item.createdAt === undefined || date(item.createdAt)) && (item.lastLoginAt === undefined || date(item.lastLoginAt)))
    && arrayOf(value.artists, item => record(item) && id(item.id) && string(item.name) && image(item.picture)
      && optionalStrings(item, ['username', 'genre', 'basedIn', 'bio', 'recordLabel']))
    && arrayOf(value.projects, item => record(item) && id(item.id) && id(item.artistId) && string(item.title)
      && string(item.category) && isMoney(item.goalAmount, 0.01, 100_000_000) && item.currency === 'USD'
      && date(item.createdAt) && (item.archivedAt === undefined || date(item.archivedAt))
      && string(item.status) && ['draft', 'published', 'funding', 'funded', 'closed'].includes(item.status) && image(item.coverUrl)
      && optionalStrings(item, ['subcategory', 'format', 'pitch', 'story', 'returnModel', 'targetReleaseDate'])
      && (item.useOfFunds === undefined || arrayOf(item.useOfFunds, fund => record(fund) && string(fund.label)
        && typeof fund.percentage === 'number' && Number.isFinite(fund.percentage) && fund.percentage >= 0 && fund.percentage <= 100)))
    && arrayOf(value.investments, item => record(item) && id(item.id) && id(item.investorId) && id(item.projectId)
      && id(item.artistId) && string(item.projectTitle) && string(item.artistName) && isMoney(item.amount, 100, 10_000_000)
      && item.currency === 'USD' && item.status === 'preview' && date(item.createdAt))
    && arrayOf(value.supports, item => record(item) && id(item.projectId) && id(item.artistId) && date(item.createdAt));
  if (!valid) throw new PreviewDataError();
  const state = { ...value, version: 3 } as State;
  const ids = [...state.accounts, ...state.projects, ...state.investments].map(item => item.id);
  const artistIds = new Set(state.artists.map(item => item.id));
  const projectIds = new Set(state.projects.map(item => item.id));
  const accountIs = (accountId: number, role: SessionUserRole) => state.accounts.some(item => item.id === accountId && item.role === role);
  if (new Set(ids).size !== ids.length || ids.some(item => item >= state.nextId)
    || artistIds.size !== state.artists.length
    || (state.currentAccountId !== null && !state.accounts.some(item => item.id === state.currentAccountId))
    || state.artists.some(item => !accountIs(item.id, 'artist'))
    || state.accounts.some(item => item.role === 'artist' && !artistIds.has(item.id))
    || state.projects.some(item => !artistIds.has(item.artistId))
    || state.investments.some(item => !accountIs(item.investorId, 'investor') || !artistIds.has(item.artistId!))
    || state.supports.some(item => !artistIds.has(item.artistId) || !projectIds.has(item.projectId))
    || new Set(state.visibility.map(item => `${item.projectId}:${item.investorId}`)).size !== state.visibility.length
    || new Set(state.visibility.map(item => item.publicId)).size !== state.visibility.length
    || state.visibility.some(item => !projectIds.has(item.projectId) || !accountIs(item.investorId, 'investor'))) {
    throw new PreviewDataError();
  }
  return state;
}
