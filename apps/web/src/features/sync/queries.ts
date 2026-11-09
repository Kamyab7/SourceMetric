import { useQuery } from '@tanstack/vue-query';
import { syncSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
export const useSync = () =>
  useQuery({ queryKey: ['sync'], queryFn: () => api('/sync', syncSchema), refetchInterval: 60000 });
