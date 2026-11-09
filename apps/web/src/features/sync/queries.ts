import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { syncSchema } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
export const useSync = (
  page: Ref<number>,
  size: Ref<number>,
  packagePage: Ref<number>,
  packageSize: Ref<number>,
) =>
  useQuery({
    queryKey: computed(() => [
      'sync',
      page.value,
      size.value,
      packagePage.value,
      packageSize.value,
    ]),
    queryFn: () =>
      api(
        '/sync?limit=' +
          size.value +
          '&offset=' +
          (page.value - 1) * size.value +
          '&packageLimit=' +
          packageSize.value +
          '&packageOffset=' +
          (packagePage.value - 1) * packageSize.value,
        syncSchema,
      ),
    refetchInterval: 60000,
  });
