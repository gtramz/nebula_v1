/** Administration metadata, not copyright or a recording. Visibility is contextual. */
export type Song = { id: number; ownerId: number; title: string; description: string; revision: number; createdAt: string; updatedAt: string };
export type SongEntry = { workId?: number; revision?: number; title: string; description: string };
export type Tracklist = { revision: number; songs: (Song & { references: string[] })[] };
export const musicalProject = (category: string) => ['single','ep','album'].includes(category.toLowerCase());
export const songProjectHref = (projectId: number, workId?: number | null) => `/project/${projectId}${workId ? `?song=${workId}` : ''}`;
