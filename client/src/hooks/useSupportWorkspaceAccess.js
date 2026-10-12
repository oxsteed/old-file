import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';

// Navbar and footer share one request. Account changes get a distinct query,
// and an unresolved or failed request never exposes the workspace shortcut.
export function useSupportWorkspaceAccess(user) {
  const userId = user?.id;
  const query = useQuery({
    queryKey: ['support-workspace-access', userId ?? null],
    enabled: userId != null,
    queryFn: async ({ signal }) => {
      const { data } = await api.get('/support/agent/me', { signal });
      return Array.isArray(data?.data) && data.data.length > 0;
    },
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
  });
  return userId != null && query.isSuccess && !query.isFetching && query.data === true;
}
