import { useEffect, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type AccountRegistration, type LocalLogin, type ArtistProfileInput } from './store';
import { isServerMode } from './remote';
import { getLocalStore } from './browser';
import type { InvestmentInput, ListArtistsParams, ListProjectsParams, ProjectInput, ProjectUpdate, PublicVisibility } from './types';

export * from './types';
export type { ArtistProfileInput } from './store';
export { PreviewDataError } from './store';
export { getLocalStore, initializeLocalStore, exportBrowserBackup } from './browser';
export { CURRENCY, sumMoney } from './money';
export { isServerMode, apiRequest, transferBrowserAccount } from './remote';
export type { Publication, PublicationInput, UploadedMedia, RemixInput, RemixAttribution, Waveform } from './publications';

type LocalQueryOptions = { query?: { enabled?: boolean; queryKey?: QueryKey; staleTime?: number; retry?: boolean } };

function useLocalQuery<T>(key: QueryKey, read: () => T | Promise<T>, options?: LocalQueryOptions) {
  const store = getLocalStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const queryClient = useQueryClient();
  useEffect(() => { void queryClient.invalidateQueries(); }, [snapshot, queryClient]);
  const user = store.getCurrentUser();
  return useQuery({ ...options?.query,
    queryKey: [...(options?.query?.queryKey ?? key), 'viewer', user?.role ?? 'guest', user?.artistId ?? user?.investorId ?? null],
    refetchOnWindowFocus: isServerMode(),
    queryFn: () => Promise.resolve(read()), networkMode: 'always', retry: false });
}

function useLocalMutation<T, V>(write: (variables: V) => T | Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation<T, Error, V>({
    networkMode: 'always',
    mutationFn: async (variables) => write(variables),
    onSuccess: async () => {
      queryClient.removeQueries({ type: 'inactive' });
      await queryClient.invalidateQueries();
    },
  });
}

export const getGetProjectQueryKey = (id: number) => ['project', id] as const;
export const getGetArtistQueryKey = (id: number) => ['artist', id] as const;
export const getListMyInvestmentsQueryKey = () => ['pledges'] as const;
export const getGetInvestmentQueryKey = (id: number) => ['pledge', id] as const;

export function useListProjects(params: ListProjectsParams = {}, options?: LocalQueryOptions) {
  return useLocalQuery(['projects', params], () => getLocalStore().listProjects(params), options);
}
export function useListArtists(params: ListArtistsParams = {}, options?: LocalQueryOptions) {
  return useLocalQuery(['artists', params], () => getLocalStore().listArtists(params), options);
}
export function useGetProject(id: number, options?: LocalQueryOptions) {
  return useLocalQuery(getGetProjectQueryKey(id), () => getLocalStore().getProject(id), options);
}
export function useGetArtist(id: number, options?: LocalQueryOptions) {
  return useLocalQuery(getGetArtistQueryKey(id), () => getLocalStore().getArtist(id), options);
}
export function useListMyInvestments(options?: LocalQueryOptions) {
  return useLocalQuery(getListMyInvestmentsQueryKey(), () => getLocalStore().listMyInvestments(), options);
}
export function useGetInvestment(id: number, options?: LocalQueryOptions) {
  return useLocalQuery(getGetInvestmentQueryKey(id), () => getLocalStore().getInvestment(id), options);
}
export function useRegisterAccount() {
  return useLocalMutation((variables: { data: AccountRegistration }) => getLocalStore().register(variables.data));
}
export function useLogin() {
  return useLocalMutation((variables: { data: LocalLogin }) => getLocalStore().login(variables.data));
}
export function useLogout() {
  return useLocalMutation((_variables: void) => getLocalStore().logout());
}
export function useUpdateArtistProfile() {
  return useLocalMutation((variables: { data: ArtistProfileInput }) => getLocalStore().updateArtist(variables.data));
}
export function useCreateProject() {
  return useLocalMutation((variables: { data: ProjectInput }) => getLocalStore().createProject(variables.data));
}
export function useUpdateProject() {
  return useLocalMutation((variables: { id: number; data: ProjectUpdate }) => getLocalStore().updateProject(variables.id, variables.data));
}
export function useDeleteProject() {
  return useLocalMutation((variables: { id: number }) => getLocalStore().deleteProject(variables.id));
}
export function useCreateInvestment() {
  return useLocalMutation((variables: { data: InvestmentInput }) => getLocalStore().createInvestment(variables.data));
}
export function useToggleProjectSupport() {
  return useLocalMutation((variables: { id: number }) => getLocalStore().toggleProjectSupport(variables.id));
}
export function useResetPreview() {
  return useLocalMutation((_variables: void) => getLocalStore().clearDemoData());
}

export function useAuthEvents() {
  return useLocalQuery(['account-activity'], () => getLocalStore().listAuthEvents());
}

export function useReceivedInvestments() {
  return useLocalQuery(['received'], () => getLocalStore().listReceivedInvestments());
}
export function useUpdateProjectVisibility() {
  return useLocalMutation((variables: { projectId: number; data: PublicVisibility }) => getLocalStore().updateProjectVisibility(variables.projectId, variables.data));
}

export type { CollaborationOffer, OfferInput, Compensation, Collaboration, CollaborationDetail } from './collaborations';
export type { ArtistNotification, NotificationKind, NotificationPage, NotificationSummary } from './notifications';
