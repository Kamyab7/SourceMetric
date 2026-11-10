<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { repositoryMetricsSchema, type RepositoryRange } from '@sourcemetric/contracts';
import { api, number, utc } from '../../shared/api';
import RepositoryChart from './RepositoryChart.vue';
const props = defineProps<{ range: RepositoryRange }>();
const metric = ref<'stars' | 'forks' | 'clones' | 'uniques'>('stars');
const query = computed(() => new URLSearchParams(props.range).toString());
const metrics = useQuery({
  queryKey: computed(() => ['repository-metrics', query.value]),
  queryFn: () => api('/repository-metrics?' + query.value, repositoryMetricsSchema),
});
</script>
<template>
  <section class="card bg-base-100 border border-base-300 panel">
    <div class="section-heading">
      <h2>Repository metrics</h2>
      <div class="actions">
        <RouterLink
          class="btn btn-sm btn-ghost"
          :to="'/repositories' + (range.projectId ? '?projectId=' + range.projectId : '')"
          >Manage repositories</RouterLink
        ><a class="btn btn-sm btn-ghost" :href="'/api/v1/repository-exports?' + query"
          >Export repository CSV</a
        >
      </div>
    </div>
    <p v-if="metrics.error.value" role="alert" class="error">{{ metrics.error.value.message }}</p>
    <p v-if="metrics.isPending.value" class="empty">Loading repository metrics…</p>
    <template v-if="metrics.data.value">
      <p v-if="!metrics.data.value.repositories.length" class="empty">
        No repositories in this view. Track a GitHub repository to start collecting.
      </p>
      <template v-else>
        <p v-if="metrics.data.value.truncated" role="alert" class="error">
          Results truncated. Select a shorter range or one repository. Comparisons are unavailable.
        </p>
        <div class="stats">
          <article v-for="key in ['stars', 'forks'] as const" :key="key">
            <span class="eyebrow">{{ key }}</span
            ><strong>{{ number(metrics.data.value[key].latest) }}</strong
            ><span class="muted small"
              >Latest as of range end · net change {{ number(metrics.data.value[key].change)
              }}<br />{{
                metrics.data.value[key].complete ? 'Complete coverage' : 'Partial coverage'
              }}
              · vs. previous
              {{
                metrics.data.value[key].comparison === null
                  ? 'N/A'
                  : number(metrics.data.value[key].comparison) + '%'
              }}</span
            >
          </article>
          <article>
            <span class="eyebrow">Clones</span
            ><strong>{{ number(metrics.data.value.clones.total) }}</strong
            ><span class="muted small"
              >Observed complete UTC days ·
              {{ metrics.data.value.clones.complete ? 'complete coverage' : 'partial coverage'
              }}<br />vs. previous
              {{
                metrics.data.value.clones.comparison === null
                  ? 'N/A'
                  : number(metrics.data.value.clones.comparison) + '%'
              }}</span
            >
          </article>
        </div>
        <p class="muted small">
          Stars and forks are snapshots; change is measured between observations inside the range.
          Clone totals include fully contained, non-provisional daily buckets. Missing days are
          unknown. Daily unique cloners cannot be added into a period-wide unique count. All times
          UTC.
        </p>
        <label
          >Chart metric<select class="select select-bordered" v-model="metric">
            <option value="stars">Stars</option>
            <option value="forks">Forks</option>
            <option value="clones">Daily clones</option>
            <option value="uniques">Daily unique cloners</option>
          </select></label
        >
        <RepositoryChart :metrics="metrics.data.value" :metric="metric" />
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Snapshots collected</th>
                <th>Traffic collected</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in metrics.data.value.repositories" :key="r.id">
                <td>
                  <RouterLink :to="'/repositories/' + r.id">{{ r.fullName }}</RouterLink>
                </td>
                <td>{{ utc(r.lastSuccess) }}</td>
                <td>{{ utc(r.trafficSuccess) }}</td>
                <td>
                  {{ r.archived ? 'Archived' : r.status
                  }}<span v-if="r.trafficError"> · {{ r.trafficError }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>
