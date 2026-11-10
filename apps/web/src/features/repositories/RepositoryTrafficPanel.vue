<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { trafficListSchema, type RepositoryRange } from '@sourcemetric/contracts';
import { api, utc } from '../../shared/api';
import Pagination from '../../shared/Pagination.vue';
import { usePagination } from '../../shared/pagination';
import TrafficSnapshotCard from './TrafficSnapshotCard.vue';
const props = defineProps<{ range: RepositoryRange }>();
const total = ref(0),
  pagination = usePagination(total);
const query = computed(() =>
  new URLSearchParams({
    ...props.range,
    limit: String(pagination.pageSize.value),
    offset: String((pagination.page.value - 1) * pagination.pageSize.value),
  }).toString(),
);
const traffic = useQuery({
  queryKey: computed(() => ['repository-traffic', query.value]),
  queryFn: () => api('/repository-traffic?' + query.value, trafficListSchema),
});
watch(
  () => traffic.data.value?.total,
  (value) => {
    if (value !== undefined) total.value = value;
  },
);
watch(
  () => [props.range.from, props.range.to, props.range.projectId, props.range.repositoryId],
  () => {
    pagination.page.value = 1;
  },
);
</script>
<template>
  <section class="card bg-base-100 border border-base-300 panel">
    <div class="section-heading">
      <h2>Visitors, content &amp; referrals</h2>
    </div>
    <p class="muted small">
      Unique visitors are per repository and snapshot. They cannot be added across days,
      repositories, content, or referring sites. Snapshot history is available up to the selected
      range end.
    </p>
    <p v-if="traffic.error.value" role="alert" class="error">{{ traffic.error.value.message }}</p>
    <p v-if="traffic.isPending.value" class="empty">Loading traffic…</p>
    <p v-if="traffic.data.value?.total === 0" class="empty">No repositories in this view.</p>
    <article
      v-for="r in traffic.data.value?.items"
      :key="r.repositoryId"
      class="mt-6"
      :aria-label="r.repositoryName + ' traffic'"
    >
      <h3>
        <RouterLink :to="'/repositories/' + r.repositoryId">{{ r.repositoryName }}</RouterLink>
      </h3>
      <p
        v-for="status in r.statuses.filter((s) => s.error)"
        :key="status.metric"
        class="small text-warning"
      >
        {{ status.metric }}: {{ status.status }} · {{ status.error }} · Last success
        {{ utc(status.lastSuccess) }}
      </p>
      <div class="grid gap-4 mt-3">
        <TrafficSnapshotCard
          v-for="metric in ['views', 'paths', 'referrers'] as const"
          :key="metric"
          :repository-id="r.repositoryId"
          :metric="metric"
          :range="range"
          :summary="r.snapshots.find((s) => s.metric === metric)"
        />
      </div>
    </article>
    <Pagination
      v-model:page="pagination.page.value"
      v-model:page-size="pagination.pageSize.value"
      :total="total"
      :busy="traffic.isFetching.value"
      label="traffic repositories"
    />
  </section>
</template>
