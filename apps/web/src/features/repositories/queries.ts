import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { listSchema, repositorySchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
import { allPages } from '../../shared/pagination';
export const useRepositories = (projectId?: Ref<string>, page?: Ref<number>, size?: Ref<number>) =>
  useQuery({
    queryKey: computed(() => [
      'repositories',
      projectId?.value ?? '',
      page?.value ?? 'all',
      size?.value ?? 100,
    ]),
    queryFn: () => {
      const path = '/repositories' + (projectId?.value ? '?projectId=' + projectId.value : '');
      return page
        ? api(
            path +
              (path.includes('?') ? '&' : '?') +
              'limit=' +
              size!.value +
              '&offset=' +
              (page.value - 1) * size!.value,
            listSchema(repositorySchema),
          )
        : allPages(path, repositorySchema);
    },
  });
export const useRepository = (id: Ref<string>) =>
  useQuery({
    queryKey: computed(() => ['repository', id.value]),
    queryFn: () => api('/repositories/' + id.value, repositorySchema),
    enabled: computed(() => !!id.value),
  });
