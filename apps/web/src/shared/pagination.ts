import { computed, ref, watch, type Ref } from 'vue';
import { api } from './api';
import { listSchema } from '@sourcemetric/contracts';
import type { z } from 'zod';
export function usePagination(total: Ref<number>, initialSize = 10) {
  const page = ref(1),
    pageSize = ref(initialSize);
  const offset = computed(() => (page.value - 1) * pageSize.value);
  watch(pageSize, () => {
    page.value = 1;
  });
  watch([total, pageSize], () => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(total.value / pageSize.value)));
  });
  return { page, pageSize, offset };
}
export function useClientPagination<T>(items: Ref<T[]>, initialSize = 10) {
  const total = computed(() => items.value.length);
  const state = usePagination(total, initialSize);
  return {
    ...state,
    total,
    items: computed(() =>
      items.value.slice(state.offset.value, state.offset.value + state.pageSize.value),
    ),
  };
}
export async function allPages<T extends z.ZodType>(path: string, item: T) {
  const items: z.infer<T>[] = [];
  let total = 0;
  do {
    const page = await api(
      path + (path.includes('?') ? '&' : '?') + 'limit=100&offset=' + items.length,
      listSchema(item),
    );
    total = page.total;
    items.push(...page.items);
    if (page.items.length === 0) break;
  } while (items.length < total);
  return { items, total };
}
