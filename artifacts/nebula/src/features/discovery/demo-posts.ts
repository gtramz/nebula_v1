// Presentation-only fixtures. Never insert these into the account/project store.
export type DemoOffer = {
  id: string;
  need: string;
  deliverable: string;
  compensation: { kind: 'split'; percent: number } | { kind: 'fee'; amount: number; currency: 'USD' };
};

export type DemoProject = {
  title: string;
  artist: string;
  stage: string;
  description: string;
  raised: number;
  goal: number;
  useOfFunds: { label: string; percent: number }[];
  offers: DemoOffer[];
};

export type DemoPost = {
  social?: { stars: number; comments: number; starred: boolean; saved: boolean };
  id: string;
  title: string;
  author: string;
  artistId?: number;
  coverUrl?: string | null;
  initials: string;
  genre: string;
  description: string;
  media: { kind: 'video' | 'audio'; src: string; durationSeconds: number };
  tone: 'cyan' | 'amber' | 'violet';
  stars: number;
  remixAllowed: boolean;
  original?: { postId: string; title: string; author: string; available?: boolean };
  project?: DemoProject;
  projectId?: number;
  comments: { id: string; author: string; text: string }[];
};

export const DEMO_POSTS: DemoPost[] = [
  {
    id: 'after-hours', title: 'after hours', author: 'Luna Vale', initials: 'LV', genre: 'alternative / electronic',
    description: 'A late-night idea, looking for another voice. Where would you take the second verse?',
    media: { kind: 'video', src: '/discovery-demo/after-hours.webm', durationSeconds: 8 }, tone: 'cyan', stars: 128, remixAllowed: true,
    comments: [{ id: 'c1', author: 'Sol Rivera', text: 'That space before the melody comes in. ✦' }],
    project: {
      title: 'After Hours EP', artist: 'Luna Vale', stage: 'Funding · in production',
      description: 'Four tracks about the city after everyone goes home. Warm synths, intimate vocals and enough space for unexpected collaborations. This sketch is the starting point for the second track.',
      raised: 2400, goal: 6000,
      useOfFunds: [{ label: 'Production', percent: 50 }, { label: 'Mix & master', percent: 30 }, { label: 'Visuals', percent: 20 }],
      offers: [
        { id: 'verse', need: 'Guest verse', deliverable: 'One original 16-bar verse, dry vocal stems and a reference mix. English or Spanish; intimate delivery.', compensation: { kind: 'split', percent: 15 } },
        { id: 'master', need: 'Mastering', deliverable: 'Master the four-track EP for digital release. Deliver WAV masters and one revision per track.', compensation: { kind: 'fee', amount: 400, currency: 'USD' } },
      ],
    },
  },
  {
    id: 'soft-signal', title: 'soft signal', author: 'Sol Rivera', initials: 'SR', genre: 'ambient / instrumental',
    description: 'No brief, no deadline. Just a small loop for the end of your day. Headphones on.',
    media: { kind: 'audio', src: '/discovery-demo/soft-signal.wav', durationSeconds: 8 }, tone: 'amber', stars: 86, remixAllowed: false,
    comments: [],
  },
  {
    id: 'after-hours-rework', title: 'a different orbit', author: 'Nico Sur', initials: 'NS', genre: 'electronic / rework',
    description: 'A slower response to Luna’s original sketch. Same starting point, a different atmosphere.',
    media: { kind: 'audio', src: '/discovery-demo/orbit.wav', durationSeconds: 8 }, tone: 'violet', stars: 42, remixAllowed: true,
    original: { postId: 'after-hours', title: 'after hours', author: 'Luna Vale' },
    comments: [{ id: 'c2', author: 'Luna Vale', text: 'Love hearing where you took this.' }],
  },
];

export const formatDemoUSD = (amount: number) => `USD ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
