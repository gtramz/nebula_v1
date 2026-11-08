import type { HomeFacetOptions } from './opportunity-search.js';
import type { Project } from './types.js';
import type { CollaborationOffer } from './collaborations.js';

// Read model only: no new project, financial, or ownership records.
export type OpportunityProject = { project: Project; offers: CollaborationOffer[] };
/** Only describes the viewer's ordering; never includes private preference values. */
export type HomeForYouSummary = { basis: 'preferences' | 'profile' | 'mixed' | 'general'; reason?: 'no-signals' | 'no-matches' };
export type OpportunityPage = { items: OpportunityProject[]; nextCursor: number | null; eligibleCount?: number; followedArtistCount?: number; nextPageCursor?: string | null; facets?: HomeFacetOptions; forYou?: HomeForYouSummary };
