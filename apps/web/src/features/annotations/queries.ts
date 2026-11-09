import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { listSchema, annotationSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
export const useAnnotations = (page: Ref<number>, size: Ref<number>) =>
  useQuery({
    queryKey: computed(() => ['annotations', page.value, size.value]),
    queryFn: () =>
      api(
        '/annotations?limit=' + size.value + '&offset=' + (page.value - 1) * size.value,
        listSchema(annotationSchema),
      ),
  });
