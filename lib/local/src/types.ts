export interface HealthStatus {
  status: string;
}

export interface ApiMessage {
  error: string;
}

export interface InvestorRegistration {
  /**
     * @minLength 1
     * @maxLength 120
     */
  name: string;
  /** @maxLength 254 */
  email: string;
  /**
     * @minLength 8
     * @maxLength 128
     */
  password: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export type SessionUserRole = typeof SessionUserRole[keyof typeof SessionUserRole];


export const SessionUserRole = {
  investor: 'investor',
  artist: 'artist',
} as const;

export interface Artist {
  id: number;
  name: string;
  /** @nullable */
  username?: string | null;
  /** @nullable */
  picture?: string | null;
  /** @nullable */
  genre?: string | null;
  /** @nullable */
  basedIn?: string | null;
  /** @nullable */
  bio?: string | null;
  /** @nullable */
  recordLabel?: string | null;
}

export interface SessionUser {
  role: SessionUserRole;
  /** @nullable */
  investorId?: number | null;
  /** @nullable */
  artistId?: number | null;
  name: string;
  /** @nullable */
  email?: string | null;
  /** @nullable */
  picture?: string | null;
  artist?: Artist | null;
}


export interface ArtistSummary {
  id: number;
  name: string;
  /** @nullable */
  picture?: string | null;
  /** @nullable */
  genre?: string | null;
  /** @nullable */
  basedIn?: string | null;
  projectCount: number;
  totalRaised: number;
  supportersCount: number;
}

export interface UseOfFundsItem {
  /** @maxLength 120 */
  label: string;
  /**
     * @minimum 0
     * @maximum 100
     */
  percentage: number;
}

export interface Project {
  id: number;
  artistId: number;
  artistName: string;
  /** @nullable */
  artistPicture?: string | null;
  title: string;
  category: string;
  /** @nullable */
  subcategory?: string | null;
  /** @nullable */
  format?: string | null;
  /** @nullable */
  pitch?: string | null;
  /** @nullable */
  story?: string | null;
  /** @nullable */
  coverUrl?: string | null;
  goalAmount: number;
  raisedAmount: number;
  backersCount: number;
  supportsCount: number;
  currency: 'USD';
  /** @nullable */
  returnModel?: string | null;
  useOfFunds?: UseOfFundsItem[];
  /** @nullable */
  targetReleaseDate?: string | null;
  status: string;
  createdAt: string;
}

export interface ArtistDetail {
  artist: Artist;
  projects: Project[];
  totalRaised: number;
  totalGoal: number;
  backersCount: number;
}

export type ProjectInputCurrency = typeof ProjectInputCurrency[keyof typeof ProjectInputCurrency];


export const ProjectInputCurrency = {
  USD: 'USD',
} as const;

export type ProjectInputStatus = typeof ProjectInputStatus[keyof typeof ProjectInputStatus];


export const ProjectInputStatus = {
  draft: 'draft',
  published: 'published',
  funding: 'funding',
  funded: 'funded',
  closed: 'closed',
} as const;

export interface ProjectInput {
  /**
     * @minLength 1
     * @maxLength 160
     */
  title: string;
  /**
     * @minLength 1
     * @maxLength 60
     */
  category: string;
  /**
     * @maxLength 60
     * @nullable
     */
  subcategory?: string | null;
  /**
     * @maxLength 60
     * @nullable
     */
  format?: string | null;
  /**
     * @maxLength 4000
     * @nullable
     */
  pitch?: string | null;
  /**
     * @maxLength 12000
     * @nullable
     */
  story?: string | null;
  /**
     * @maxLength 2048
     * @nullable
     */
  coverUrl?: string | null;
  /**
     * @maximum 100000000
     * @exclusiveMinimum 0
     */
  goalAmount: number;
  currency?: ProjectInputCurrency;
  /**
     * @maxLength 400
     * @nullable
     */
  returnModel?: string | null;
  useOfFunds?: UseOfFundsItem[];
  /** @nullable */
  targetReleaseDate?: string | null;
  status?: ProjectInputStatus;
}

export type ProjectUpdateStatus = typeof ProjectUpdateStatus[keyof typeof ProjectUpdateStatus];


export const ProjectUpdateStatus = {
  draft: 'draft',
  published: 'published',
  funding: 'funding',
  funded: 'funded',
  closed: 'closed',
} as const;

export interface ProjectUpdate {
  /**
     * @minLength 1
     * @maxLength 160
     */
  title?: string;
  /**
     * @minLength 1
     * @maxLength 60
     */
  category?: string;
  /**
     * @maxLength 60
     * @nullable
     */
  subcategory?: string | null;
  /**
     * @maxLength 60
     * @nullable
     */
  format?: string | null;
  /**
     * @maxLength 4000
     * @nullable
     */
  pitch?: string | null;
  /**
     * @maxLength 12000
     * @nullable
     */
  story?: string | null;
  /**
     * @maxLength 2048
     * @nullable
     */
  coverUrl?: string | null;
  /**
     * @maximum 100000000
     * @exclusiveMinimum 0
     */
  goalAmount?: number;
  /**
     * @maxLength 400
     * @nullable
     */
  returnModel?: string | null;
  useOfFunds?: UseOfFundsItem[];
  /** @nullable */
  targetReleaseDate?: string | null;
  status?: ProjectUpdateStatus;
}

export interface PublicVisibility {
  showName: boolean;
  showAmount: boolean;
}

export interface BackerEntry {
  publicId: string;
  name: string | null;
  amount: number | null;
}

export interface SupporterEntry {
  artistId: number;
  name: string;
  /** @nullable */
  picture?: string | null;
  createdAt: string;
}

export interface ProjectDetail {
  project: Project;
  artist: Artist;
  backers: BackerEntry[];
  supporters: SupporterEntry[];
  viewerHasSupported?: boolean;
  viewerVisibility?: PublicVisibility;
}

export interface SupportState {
  supported: boolean;
  supportsCount: number;
}

export interface InvestmentInput {
  publicVisibility?: PublicVisibility;
  /** @nullable */
  projectId?: number | null;
  /** @nullable */
  artistId?: number | null;
  /**
     * @maximum 10000000
     * @exclusiveMinimum 0
     */
  amount: number;
}

export interface Investment {
  publicVisibility?: PublicVisibility;
  projectArchived?: boolean;
  id: number;
  /** @nullable */
  projectId?: number | null;
  /** @nullable */
  projectTitle?: string | null;
  /** @nullable */
  artistId?: number | null;
  /** @nullable */
  artistName?: string | null;
  amount: number;
  currency: 'USD';
  status: string;
  createdAt: string;
}

export interface ReceivedInvestment extends Investment {
  investorName: string;
}

export interface OverviewStats {
  totalRaised: number;
  activeProjects: number;
  artistsCount: number;
  backersCount: number;
}

export type ActivityItemKind = typeof ActivityItemKind[keyof typeof ActivityItemKind];


export const ActivityItemKind = {
  investment: 'investment',
  support: 'support',
  project_created: 'project_created',
} as const;

export interface ActivityItem {
  kind: ActivityItemKind;
  at: string;
  /** @nullable */
  amount?: number | null;
  /** @nullable */
  projectId?: number | null;
  /** @nullable */
  projectTitle?: string | null;
  /** @nullable */
  artistId?: number | null;
  /** @nullable */
  artistName?: string | null;
}

export type ListArtistsParams = {
search?: string;
};

export type ListProjectsParams = {
category?: string;
status?: string;
search?: string;
};
