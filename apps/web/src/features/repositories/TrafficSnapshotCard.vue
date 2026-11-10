<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import {
  trafficSnapshotSchema,
  trafficDetailSchema,
  listSchema,
  type TrafficMetric,
  type RepositoryRange,
} from '@sourcemetric/contracts';
import type { z } from 'zod';
import { api, number, utc } from '../../shared/api';
import { contentUrl } from './content-url';
import Pagination from '../../shared/Pagination.vue';
import { usePagination } from '../../shared/pagination';
const props = defineProps<{
  repositoryId: string;
  metric: TrafficMetric;
  range: RepositoryRange;
  summary?: z.infer<typeof trafficSnapshotSchema>;
}>();
const title = computed(
  () =>
    ({ views: 'Visitors', paths: 'Popular content', referrers: 'Referring sites' })[props.metric],
);
const selected = ref(''),
  historyOpen = ref(false),
  total = ref(0),
  pagination = usePagination(total);
const snapshotId = computed(() => selected.value || props.summary?.id || '');
const detail = useQuery({
  queryKey: computed(() => ['traffic-snapshot', snapshotId.value]),
  queryFn: () => api('/repository-traffic/snapshots/' + snapshotId.value, trafficDetailSchema),
  enabled: computed(() => !!snapshotId.value),
});
const history = useQuery({
  queryKey: computed(() => [
    'traffic-history',
    props.repositoryId,
    props.metric,
    props.range.to,
    pagination.page.value,
    pagination.pageSize.value,
  ]),
  queryFn: () =>
    api(
      '/repository-traffic/history?' +
        new URLSearchParams({
          ...props.range,
          repositoryId: props.repositoryId,
          metric: props.metric,
          limit: String(pagination.pageSize.value),
          offset: String((pagination.page.value - 1) * pagination.pageSize.value),
        }),
      listSchema(trafficSnapshotSchema),
    ),
  enabled: historyOpen,
});
watch(
  () => history.data.value?.total,
  (value) => {
    if (value !== undefined) total.value = value;
  },
);
watch(
  () => [props.range.from, props.range.to, props.summary?.id],
  () => {
    selected.value = '';
    pagination.page.value = 1;
  },
);
</script>
<template>
  <section
    class="panel border border-base-300 rounded-xl min-w-0"
    :aria-label="title + ' snapshot'"
  >
    <div class="section-heading">
      <h4 class="font-semibold">{{ title }}</h4>
      <button
        class="btn btn-sm btn-ghost"
        type="button"
        :aria-expanded="historyOpen"
        @click="historyOpen = !historyOpen"
      >
        Snapshot history
      </button>
    </div>
    <p v-if="!snapshotId" class="muted small">No successful snapshot collected.</p>
    <p v-if="detail.error.value || history.error.value" class="error" role="alert">
      {{ detail.error.value?.message || history.error.value?.message }}
    </p>
    <p v-if="detail.isFetching.value" class="muted small">Loading snapshot…</p>
    <template v-if="detail.data.value">
      <p class="muted small">
        GitHub rolling 14-day snapshot · Collected {{ utc(detail.data.value.observedAt)
        }}<span
          v-if="detail.data.value.observedAt < range.from"
          class="badge badge-warning badge-soft"
          >Stale: before selected range</span
        >
      </p>
      <p class="muted small">
        These counts cover GitHub’s rolling window at collection time, not the selected dashboard
        period.
      </p>
      <div v-if="metric === 'views'" class="flex gap-8 py-4">
        <p>
          <strong class="text-xl">{{ number(detail.data.value.count) }}</strong
          ><br />Views over 14 days
        </p>
        <p>
          <strong class="text-xl">{{ number(detail.data.value.uniques) }}</strong
          ><br />Unique visitors over 14 days
        </p>
      </div>
      <template v-else>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>{{ metric === 'paths' ? 'Content' : 'Referrer' }}</th>
                <th>Views</th>
                <th>Unique visitors</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.data.value.items" :key="item.identity">
                <td>
                  <a
                    v-if="metric === 'paths' && contentUrl(item.identity)"
                    :href="contentUrl(item.identity)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ item.title || item.identity }}</a
                  ><span v-else>{{ item.title || item.identity }}</span>
                  <p v-if="item.title" class="small muted break-all">{{ item.identity }}</p>
                </td>
                <td>{{ number(item.count) }}</td>
                <td>{{ number(item.uniques) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!detail.data.value.items.length" class="muted small">
          GitHub returned no {{ metric === 'paths' ? 'popular content' : 'referring sites' }} in
          this snapshot.
        </p>
      </template>
    </template>
    <div v-if="historyOpen" class="mt-4">
      <button v-if="selected" class="btn btn-sm btn-ghost" @click="selected = ''">
        Use latest snapshot at range end
      </button>
      <ul class="flex flex-wrap gap-2">
        <li v-for="s in history.data.value?.items" :key="s.id">
          <button
            class="btn btn-sm"
            :class="s.id === snapshotId ? 'btn-primary' : 'btn-ghost'"
            :aria-pressed="s.id === snapshotId"
            @click="selected = s.id"
          >
            {{ utc(s.observedAt) }}
          </button>
        </li>
      </ul>
      <p v-if="history.data.value?.total === 0" class="muted small">
        No snapshots at or before the selected range end.
      </p>
      <Pagination
        v-model:page="pagination.page.value"
        v-model:page-size="pagination.pageSize.value"
        :total="total"
        :busy="history.isFetching.value"
        :label="metric + ' snapshot history'"
      />
    </div>
  </section>
</template>
