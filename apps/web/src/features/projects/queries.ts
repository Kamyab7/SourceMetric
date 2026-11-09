import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { listSchema, projectSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
import { allPages } from '../../shared/pagination';
export const useProjects = (page?: Ref<number>, size?: Ref<number>) =>
  useQuery({
    queryKey: computed(() => ['projects', page?.value ?? 'all', size?.value ?? 100]),
    queryFn: () =>
      page
        ? api(
            '/projects?limit=' + size!.value + '&offset=' + (page.value - 1) * size!.value,
            listSchema(projectSchema),
          )
        : allPages('/projects', projectSchema),
  });
