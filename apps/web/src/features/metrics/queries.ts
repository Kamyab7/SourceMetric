import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { metricsSchema, type MetricRange } from '@sourcemetric/contracts';
import { api } from '../../shared/api';
export function rangeQuery(range: MetricRange) {
  return new URLSearchParams(
    Object.entries(range).filter(([, v]) => v !== undefined) as [string, string][],
  ).toString();
}
export const useMetrics = (range: Ref<MetricRange>) =>
  useQuery({
    queryKey: computed(() => ['metrics', range.value]),
    queryFn: () => api('/metrics?' + rangeQuery(range.value), metricsSchema),
  });
