<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { MetricRange } from '@sourcemetric/contracts';
import { useProjects } from '../projects/queries';
import { usePackages, usePackage } from '../packages/queries';
import Pagination from '../../shared/Pagination.vue';
import { usePagination, useClientPagination } from '../../shared/pagination';
import { useMetrics, useVersions } from './queries';
import { number, utc } from '../../shared/api';
import GrowthChart from './GrowthChart.vue';
import ExportButton from '../exports/ExportButton.vue';
const route = useRoute(),
  projects = useProjects();
const projectId = computed(() => String(route.params.projectId ?? '')),
  packageId = computed(() => String(route.params.packageId ?? ''));
const packages = usePackages(projectId),
  pkg = usePackage(packageId);
const days = ref('30'),
  channel = ref<MetricRange['channel']>('all');
const end = new Date();
end.setUTCHours(0, 0, 0, 0);
const customFrom = ref(new Date(end.getTime() - 30 * 86400000).toISOString().slice(0, 10)),
  customTo = ref(end.toISOString().slice(0, 10));
const range = computed<MetricRange>(() => ({
  from:
    days.value === 'custom'
      ? new Date(
          (customFrom.value || new Date(end.getTime() - 30 * 86400000).toISOString().slice(0, 10)) +
            'T00:00:00Z',
        ).toISOString()
      : new Date(end.getTime() - Number(days.value) * 86400000).toISOString(),
  to:
    days.value === 'custom'
      ? new Date((customTo.value || end.toISOString().slice(0, 10)) + 'T00:00:00Z').toISOString()
      : end.toISOString(),
  channel: channel.value,
  ...(projectId.value ? { projectId: projectId.value } : {}),
  ...(packageId.value ? { packageId: packageId.value } : {}),
}));
const metrics = useMetrics(range);
const versionTotal = ref(0);
const versionPages = usePagination(versionTotal);
const versions = useVersions(range, versionPages.page, versionPages.pageSize);
watch(
  () => versions.data.value?.total,
  (value) => {
    if (value !== undefined) versionTotal.value = value;
  },
  { immediate: true },
);
const notes = useClientPagination(computed(() => metrics.data.value?.annotations ?? []));
watch(range, () => {
  versionPages.page.value = 1;
  notes.page.value = 1;
});

const title = computed(() =>
  packageId.value
    ? (pkg.data.value?.displayName ?? 'Package')
    : projectId.value
      ? (projects.data.value?.items.find((p) => p.id === projectId.value)?.name ?? 'Project')
      : 'Your open source, in perspective.',
);
const shownPackages = computed(
  () =>
    packages.data.value?.items.filter((p) => !packageId.value || p.id === packageId.value) ?? [],
);
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">GROWTH OVERVIEW</p>
      <h1>{{ title }}</h1>
      <p class="muted">A longer view of your packages. Every observation stays yours.</p>
    </div>
    <ExportButton :range="range" />
  </div>
  <section v-if="packageId && pkg.data.value" class="card bg-base-100 border border-base-300 panel">
    <p>{{ pkg.data.value.description }}</p>
    <div class="actions small muted">
      <span>Stable: {{ pkg.data.value.latestStable ?? '—' }}</span>
      <span>Prerelease: {{ pkg.data.value.latestPrerelease ?? '—' }}</span>
      <span>Last success: {{ utc(pkg.data.value.lastSuccess) }}</span>
      <span class="badge badge-outline">{{
        pkg.data.value.archived ? 'Archived' : pkg.data.value.status
      }}</span>
    </div>
  </section>
  <div class="toolbar">
    <div class="segmented">
      <button
        v-for="d in ['7', '30', '90', 'custom']"
        :key="d"
        class="btn btn-ghost"
        :class="{ active: days === d }"
        @click="days = d"
      >
        {{ d === 'custom' ? 'Custom' : d + ' days' }}
      </button>
    </div>
    <template v-if="days === 'custom'"
      ><input
        class="input input-bordered w-full"
        v-model="customFrom"
        type="date"
        aria-label="Start date UTC" /><input
        class="input input-bordered w-full"
        v-model="customTo"
        type="date"
        aria-label="End date UTC" /></template
    ><select class="select select-bordered" v-model="channel" aria-label="Version channel">
      <option value="all">All versions</option>
      <option value="stable">Stable versions</option>
      <option value="prerelease">Prerelease versions</option></select
    ><span class="muted small">All dates UTC</span>
  </div>
  <p v-if="metrics.error.value" role="alert" class="error">{{ metrics.error.value.message }}</p>
  <p v-if="metrics.isPending.value" class="empty">Loading your metrics…</p>
  <template v-if="metrics.data.value">
    <div class="stats">
      <article>
        <span class="eyebrow">LATEST DOWNLOAD COUNTER</span
        ><strong>{{ number(metrics.data.value.latestTotal) }}</strong
        ><span class="muted small">Latest counter as of range end</span>
      </article>
      <article>
        <span class="eyebrow">OBSERVED GROWTH</span
        ><strong>{{ number(metrics.data.value.growth) }}</strong
        ><span class="muted small">{{
          metrics.data.value.complete
            ? 'Downloads across observed intervals'
            : 'Partial coverage — available measured intervals only'
        }}</span>
      </article>
      <article>
        <span class="eyebrow">VS. PREVIOUS PERIOD</span
        ><strong>{{
          metrics.data.value.comparison == null
            ? 'N/A'
            : number(metrics.data.value.comparison) + '%'
        }}</strong
        ><span class="muted small"
          >Previous growth: {{ number(metrics.data.value.previousGrowth) }}</span
        >
      </article>
    </div>
    <section class="card bg-base-100 border border-base-300 panel">
      <div class="section-heading">
        <div>
          <h2>Growth over time</h2>
          <p class="muted small">Observed intervals, not reconstructed daily downloads.</p>
        </div>
        <span class="badge badge-outline" :class="{ warning: metrics.data.value.stale }">{{
          metrics.data.value.stale ? 'Data needs attention' : 'Collection active'
        }}</span>
      </div>
      <GrowthChart
        v-if="metrics.data.value.points.length"
        :metrics="metrics.data.value"
        :packages="shownPackages"
      />
      <div v-else class="empty">
        <h3>Your history starts here.</h3>
        <p>
          Add a NuGet package to begin. The first collection establishes a baseline; the next shows
          growth.
        </p>
        <RouterLink class="button" to="/packages">Track a package →</RouterLink>
      </div>
      <p v-if="metrics.data.value.truncated" class="error">
        This range exceeds the chart limit. Select a shorter range.
      </p>
      <p class="small muted">
        Tracking since {{ utc(metrics.data.value.trackingSince) }}. Gaps are not filled; counter
        corrections establish a new baseline. Hover points for interval details.
      </p>
    </section>
    <div class="two-columns">
      <section class="card bg-base-100 border border-base-300 panel">
        <h2>Available version downloads</h2>
        <p class="muted small">
          Latest returned counters, not unique users or active installations.
        </p>
        <p v-if="versions.error.value" class="error" role="alert">
          {{ versions.error.value.message }}
        </p>
        <div v-else-if="versions.isPending.value" class="empty compact">Loading versions…</div>
        <div v-else-if="!versions.data.value?.items.length" class="empty compact">
          No version observations yet.
        </div>
        <table class="table" v-else>
          <thead>
            <tr>
              <th>Version</th>
              <th>Downloads</th>
              <th>Observed UTC</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in versions.data.value?.items" :key="v.packageId + v.version">
              <td>
                <RouterLink :to="'/packages/' + v.packageId"
                  >{{ shownPackages.find((p) => p.id === v.packageId)?.displayName }}<br /><span
                    class="muted"
                    >{{ v.version }}</span
                  ></RouterLink
                >
              </td>
              <td>{{ number(v.downloads) }}</td>
              <td class="small">{{ utc(v.observedAt) }}</td>
            </tr>
          </tbody>
        </table>
        <Pagination
          v-model:page="versionPages.page.value"
          v-model:page-size="versionPages.pageSize.value"
          :total="versionTotal"
          :busy="versions.isFetching.value"
          label="versions"
        />
      </section>
      <section class="card bg-base-100 border border-base-300 panel">
        <h2>Releases & campaigns</h2>
        <p class="muted small">Context for changes in growth. Timing shows correlation.</p>
        <div v-if="!metrics.data.value.annotations.length" class="empty compact">
          No notes in this period. <RouterLink to="/annotations">Add a note</RouterLink>
        </div>
        <div class="max-h-[520px] overflow-y-auto pr-2">
          <article v-for="note in notes.items.value" :key="note.id" class="annotation-entry">
            <span class="badge badge-outline">{{ note.kind }}</span>
            <h3>{{ note.title }}</h3>
            <p class="small muted">{{ utc(note.occurredAt) }}</p>
            <p>{{ note.body }}</p>
          </article>
        </div>
        <Pagination
          v-model:page="notes.page.value"
          v-model:page-size="notes.pageSize.value"
          :total="notes.total.value"
          :busy="metrics.isFetching.value"
          label="dashboard notes"
        />
      </section>
    </div>
  </template>
</template>
