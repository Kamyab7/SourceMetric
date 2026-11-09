import { useQuery } from '@tanstack/vue-query';
import { listSchema, annotationSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
export const useAnnotations = () =>
  useQuery({
    queryKey: ['annotations'],
    queryFn: () => api('/annotations?limit=100', listSchema(annotationSchema)),
  });
