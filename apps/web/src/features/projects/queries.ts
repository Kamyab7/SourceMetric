import { useQuery } from '@tanstack/vue-query';
import { listSchema, projectSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: () => api('/projects?limit=100', listSchema(projectSchema)),
  });
