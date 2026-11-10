<script setup lang="ts">
import StatusBadge from '../../shared/StatusBadge.vue';
import { computed, ref, watch } from 'vue';
import Pagination from '../../shared/Pagination.vue';
import { usePagination } from '../../shared/pagination';
import { useQuery } from '@tanstack/vue-query';
import { repositorySyncSchema } from '@sourcemetric/contracts';
import { api, utc } from '../../shared/api';
const attemptTotal = ref(0),
  repositoryTotal = ref(0);
const attempts = usePagination(attemptTotal),
  jobs = usePagination(repositoryTotal);
const sync = useQuery({
  queryKey: computed(() => [
    'repository-sync',
    attempts.page.value,
    attempts.pageSize.value,
    jobs.page.value,
    jobs.pageSize.value,
  ]),
  queryFn: () =>
    api(
      '/repository-sync?' +
        new URLSearchParams({
          limit: String(attempts.pageSize.value),
          offset: String((attempts.page.value - 1) * attempts.pageSize.value),
          repositoryLimit: String(jobs.pageSize.value),
          repositoryOffset: String((jobs.page.value - 1) * jobs.pageSize.value),
        }),
      repositorySyncSchema,
    ),
  refetchInterval: 60000,
});
watch(
  () => sync.data.value,
  (data) => {
    if (data) {
      attemptTotal.value = data.attemptTotal;
      repositoryTotal.value = data.repositoryTotal;
    }
  },
  { immediate: true },
);
</script>
<template>
  <h2>Repository collection health</h2>
  <p class="muted small">
    Separate budget: four repositories per hourly invocation. Traffic errors retain successful star
    and fork snapshots.
  </p>
  <p v-if="sync.error.value" class="error" role="alert">{{ sync.error.value.message }}</p>
  <section class="card bg-base-100 border border-base-300 panel">
    <h2>Repository collection schedule</h2>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Last attempt</th>
            <th>Last success</th>
            <th>Next attempt</th>
            <th>Status / error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in sync.data.value?.repositories" :key="p.id">
            <td>{{ p.fullName }}</td>
            <td class="whitespace-nowrap">{{ utc(p.lastAttempt) }}</td>
            <td class="whitespace-nowrap">{{ utc(p.lastSuccess) }}</td>
            <td class="whitespace-nowrap">{{ p.archived ? 'Archived' : utc(p.nextAttempt) }}</td>
            <td>
              <StatusBadge :status="p.archived ? 'archived' : p.status" />
              <p
                v-if="p.lastError"
                class="mt-1 max-w-40 break-words text-[10px] leading-relaxed text-error/80"
              >
                {{ p.lastError }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pagination
      v-model:page="jobs.page.value"
      v-model:page-size="jobs.pageSize.value"
      :total="repositoryTotal"
      :busy="sync.isFetching.value"
      label="repository schedule"
    />
  </section>
  <section class="card bg-base-100 border border-base-300 panel">
    <h2>Recent repository attempts</h2>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Started</th>
            <th>Status</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in sync.data.value?.attempts" :key="a.id">
            <td>
              {{ a.repositoryName }}
            </td>
            <td>{{ utc(a.startedAt) }}</td>
            <td><StatusBadge :status="a.status" /></td>
            <td
              class="max-w-48 break-words text-xs"
              :class="a.error ? 'text-error/80' : 'text-slate-500'"
            >
              {{ a.error ?? '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pagination
      v-model:page="attempts.page.value"
      v-model:page-size="attempts.pageSize.value"
      :total="attemptTotal"
      :busy="sync.isFetching.value"
      label="repository attempts"
    />
  </section>
  <p class="muted small">
    Repository snapshots and attempt history grow with each collection. Review D1 storage usage in
    Cloudflare; free-tier hosting is not unlimited.
  </p>
</template>
