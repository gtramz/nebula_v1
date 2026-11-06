import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getLocalStore, type AccountRegistration, type LocalLogin, type ArtistProfileInput } from './store';
import type { InvestmentInput, ListArtistsParams, ListProjectsParams, ProjectInput, ProjectUpdate } from './types';

export * from './types';
export type { ArtistProfileInput } from './store';
export { getLocalStore } from './store';

type LocalQueryOptions = { query?: { enabled?: boolean; queryKey?: QueryKey; staleTime?: number; retry?: boolean } };

function useLocalQuery<T>(key: QueryKey, read: () => T, options?: LocalQueryOptions) {
  return useQuery({ queryKey: key, queryFn: () => Promise.resolve(read()), networkMode: 'always', retry: false, ...options?.query });
}

function useLocalMutation<T, V>(write: (variables: V) => T | Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation<T, Error, V>({
    networkMode: 'always',
    mutationFn: async (variables) => write(variables),
    onSuccess: async () => { await queryClient.invalidateQueries(); },
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
  return useLocalMutation((_variables: void) => getLocalStore().reset());
}
