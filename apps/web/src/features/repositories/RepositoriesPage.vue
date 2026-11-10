<script setup lang="ts">
import { RefreshCw, Archive, ArchiveRestore, Unlink, Trash2, FolderPlus } from '@lucide/vue';
import StatusBadge from '../../shared/StatusBadge.vue';
import { ref, computed, watch } from 'vue';
import Pagination from '../../shared/Pagination.vue';
import { usePagination } from '../../shared/pagination';
import { useRoute } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import { useRepositories } from './queries';
import { useProjects } from '../projects/queries';
import { mutate, utc } from '../../shared/api';
const total = ref(0);
const { page, pageSize } = usePagination(total);
const route = useRoute(),
  projectId = ref(String(route.query.projectId ?? '')),
  repositories = useRepositories(projectId, page, pageSize),
  allRepositories = useRepositories(),
  projects = useProjects(),
  repository = ref(''),
  error = ref(''),
  busy = ref(false),
  client = useQueryClient(),
  existingId = ref('');
const resolved = ref('');
async function resolve() {
  await action(async () => {
    const data = await mutate('/repositories/resolve', 'POST', { repository: repository.value });
    resolved.value = data.fullName + ' · ' + data.stars + ' stars · ' + data.forks + ' forks';
  });
}
watch(
  () => repositories.data.value?.total,
  (value) => {
    if (value !== undefined) total.value = value;
  },
  { immediate: true },
);
watch(projectId, () => {
  page.value = 1;
});
const project = computed(() => projects.data.value?.items.find((p) => p.id === projectId.value));
async function action(run: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await run();

    await client.invalidateQueries();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function remove(id: string) {
  if (
    confirm(
      'Permanently delete this repository and ALL its observations and associations? This cannot be undone.',
    )
  )
    action(() => mutate('/repositories/' + id + '?confirm=delete-history', 'DELETE'));
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">YOUR REPOSITORIES</p>
      <h1>{{ project ? project.name + ' repositories' : 'Tracked repositories' }}</h1>
      <p class="muted">Clones, stars, and forks. A retained view of repository activity.</p>
    </div>
    <span class="badge badge-soft badge-primary border-0">Up to 20 active repositories</span>
  </div>
  <section class="card bg-base-100 border border-base-300 panel">
    <form
      class="inline-form"
      @submit.prevent="
        action(() =>
          mutate('/repositories', 'POST', {
            repository,
            ...(projectId ? { projectId } : {}),
          }),
        )
      "
    >
      <label
        >GitHub repository<input
          class="input input-bordered w-full"
          v-model="repository"
          required
          maxlength="240"
          placeholder="owner/repo or https://github.com/owner/repo" /></label
      ><label
        >Project<select
          class="select select-bordered"
          v-model="projectId"
          aria-label="Repository project"
        >
          <option value="">No project / all repositories</option>
          <option v-for="p in projects.data.value?.items" :key="p.id" :value="p.id">
            {{ p.name }}{{ p.archived ? ' (archived)' : '' }}
          </option>
        </select></label
      ><button class="btn btn-ghost" type="button" :disabled="busy || !repository" @click="resolve">
        Resolve</button
      ><button class="btn btn-primary" :disabled="busy">+ Track repository</button>
    </form>
    <p v-if="resolved" role="status">{{ resolved }}</p>
    <p class="muted small">
      GitHub.com only. Configure the GITHUB_TOKEN Worker secret. Collection runs hourly for
      repositories due every six hours.
    </p>
    <form
      v-if="projectId"
      class="inline-form"
      @submit.prevent="
        action(() => mutate('/projects/' + projectId + '/repositories/' + existingId, 'PUT', {}))
      "
    >
      <label
        >Associate an existing repository<select
          class="select select-bordered"
          v-model="existingId"
          required
        >
          <option disabled value="">Select a tracked repository</option>
          <option v-for="p in allRepositories.data.value?.items" :key="p.id" :value="p.id">
            {{ p.fullName }}
          </option>
        </select></label
      ><button
        class="btn btn-sm btn-soft btn-secondary border-0 shadow-none text-secondary"
        :disabled="busy"
      >
        <FolderPlus :size="14" aria-hidden="true" />Add to project
      </button>
    </form>
  </section>
  <p v-if="error || repositories.error.value" role="alert" class="error">
    {{ error || repositories.error.value?.message }}
  </p>
  <section class="card bg-base-100 border border-base-300 panel">
    <div class="section-heading">
      <h2>Your repositories</h2>
      <span class="muted">{{ repositories.data.value?.total ?? 0 }} tracked</span>
    </div>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Visibility</th>
            <th>Last collected</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in repositories.data.value?.items" :key="p.id">
            <td>
              <RouterLink :to="'/repositories/' + p.id"
                ><strong>{{ p.fullName }}</strong></RouterLink
              >
              <p class="small muted">
                {{ p.provider }}
              </p>
            </td>
            <td>
              {{ p.private ? 'Private' : 'Public' }}
              <p class="small muted">
                {{ p.trafficError ?? 'GitHub' }}
              </p>
            </td>
            <td class="small">{{ utc(p.lastSuccess) }}</td>
            <td>
              <StatusBadge :status="p.archived ? 'archived' : p.status" />
            </td>
            <td>
              <div class="actions">
                <button
                  class="btn btn-sm btn-soft btn-primary border-0 shadow-none text-primary"
                  :disabled="busy || p.archived"
                  @click="action(() => mutate('/repository-sync/' + p.id + '/refresh', 'POST', {}))"
                >
                  <RefreshCw :size="14" aria-hidden="true" />Refresh</button
                ><button
                  class="btn btn-sm btn-soft btn-warning border-0 shadow-none text-warning"
                  :disabled="busy"
                  @click="
                    action(() =>
                      mutate('/repositories/' + p.id, 'PATCH', { archived: !p.archived }),
                    )
                  "
                >
                  <component
                    :is="p.archived ? ArchiveRestore : Archive"
                    :size="14"
                    aria-hidden="true"
                  />{{ p.archived ? 'Restore' : 'Archive' }}</button
                ><button
                  v-if="projectId"
                  class="btn btn-sm btn-soft btn-secondary border-0 shadow-none text-secondary"
                  @click="
                    action(() =>
                      mutate('/projects/' + projectId + '/repositories/' + p.id, 'DELETE'),
                    )
                  "
                >
                  <Unlink :size="14" aria-hidden="true" />Unlink</button
                ><button
                  v-if="p.archived"
                  class="btn btn-sm btn-soft btn-error border-0 shadow-none text-error"
                  @click="remove(p.id)"
                >
                  <Trash2 :size="14" aria-hidden="true" />Delete history
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="repositories.data.value?.total === 0" class="empty">
      No repositories yet. Add a repository ID above to start collecting.
    </p>
    <Pagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
      :busy="repositories.isFetching.value"
      label="repositories"
    />
  </section>
</template>
