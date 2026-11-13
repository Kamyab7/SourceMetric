<script setup lang="ts">
import RepositorySyncPanel from '../repositories/RepositorySyncPanel.vue';
import StatusBadge from '../../shared/StatusBadge.vue';
import { ref, watch } from 'vue';
import Pagination from '../../shared/Pagination.vue';
import { usePagination } from '../../shared/pagination';
import { useSync } from './queries';
import { number, utc } from '../../shared/api';
const attemptTotal = ref(0),
  packageTotal = ref(0);
const attempts = usePagination(attemptTotal),
  jobs = usePagination(packageTotal);
const sync = useSync(attempts.page, attempts.pageSize, jobs.page, jobs.pageSize);
watch(
  () => sync.data.value,
  (data) => {
    if (data) {
      attemptTotal.value = data.attemptTotal;
      packageTotal.value = data.packageTotal;
    }
  },
  { immediate: true },
);
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">COLLECTION HEALTH</p>
      <h1>Every observation accounted for.</h1>
      <p class="muted">
        Hourly checks. Six-hour collection intervals. History retained indefinitely.
      </p>
    </div>
  </div>
  <p v-if="sync.error.value" class="error">{{ sync.error.value.message }}</p>
  <div class="stats">
    <article>
      <span class="eyebrow">STORED OBSERVATIONS</span
      ><strong>{{ number(sync.data.value?.observationCount) }}</strong
      ><span class="small muted">No automatic deletion</span>
    </article>
    <article>
      <span class="eyebrow">PACKAGES</span><strong>{{ packageTotal }}</strong
      ><span class="small muted">Up to four per collector invocation</span>
    </article>
  </div>
  <section class="card bg-base-100 border border-base-300 panel">
    <h2>Collection schedule</h2>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Last attempt</th>
            <th>Last success</th>
            <th>Next attempt</th>
            <th>Status / error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in sync.data.value?.packages" :key="p.id">
            <td>{{ p.displayName }}</td>
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
      :total="packageTotal"
      :busy="sync.isFetching.value"
      label="collection schedule"
    />
  </section>
  <section class="card bg-base-100 border border-base-300 panel">
    <h2>Recent collection attempts</h2>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Started</th>
            <th>Status</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in sync.data.value?.attempts" :key="a.id">
            <td>
              {{ a.packageName }}
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
      label="collection attempts"
    />
  </section>
  <RepositorySyncPanel />
</template>
