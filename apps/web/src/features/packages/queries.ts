import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { listSchema, packageSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
export const usePackages = (projectId?: Ref<string>) =>
  useQuery({
    queryKey: computed(() => ['packages', projectId?.value ?? '']),
    queryFn: () =>
      api(
        '/packages?limit=100' + (projectId?.value ? '&projectId=' + projectId.value : ''),
        listSchema(packageSchema),
      ),
  });
export const usePackage = (id: Ref<string>) =>
  useQuery({
    queryKey: computed(() => ['package', id.value]),
    queryFn: () => api('/packages/' + id.value, packageSchema),
    enabled: computed(() => !!id.value),
  });
