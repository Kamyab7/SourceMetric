import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { listSchema, packageSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
import { allPages } from '../../shared/pagination';
export const usePackages = (projectId?: Ref<string>, page?: Ref<number>, size?: Ref<number>) =>
  useQuery({
    queryKey: computed(() => [
      'packages',
      projectId?.value ?? '',
      page?.value ?? 'all',
      size?.value ?? 100,
    ]),
    queryFn: () => {
      const path = '/packages' + (projectId?.value ? '?projectId=' + projectId.value : '');
      return page
        ? api(
            path +
              (path.includes('?') ? '&' : '?') +
              'limit=' +
              size!.value +
              '&offset=' +
              (page.value - 1) * size!.value,
            listSchema(packageSchema),
          )
        : allPages(path, packageSchema);
    },
  });
export const usePackage = (id: Ref<string>) =>
  useQuery({
    queryKey: computed(() => ['package', id.value]),
    queryFn: () => api('/packages/' + id.value, packageSchema),
    enabled: computed(() => !!id.value),
  });
