<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import { usePackages } from './queries';
import { useProjects } from '../projects/queries';
import { mutate, number, utc } from '../../shared/api';
const route = useRoute(),
  projectId = ref(String(route.query.projectId ?? '')),
  packages = usePackages(projectId),
  allPackages = usePackages(),
  projects = useProjects(),
  packageId = ref(''),
  error = ref(''),
  busy = ref(false),
  client = useQueryClient(),
  existingId = ref('');
const project = computed(() => projects.data.value?.items.find((p) => p.id === projectId.value));
async function action(run: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await run();
    packageId.value = '';
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
      'Permanently delete this package and ALL its observations, notes, and associations? This cannot be undone.',
    )
  )
    action(() => mutate('/packages/' + id + '?confirm=delete-history', 'DELETE'));
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">YOUR REGISTRY</p>
      <h1>{{ project ? project.name + ' packages' : 'Tracked packages' }}</h1>
      <p class="muted">NuGet today. A growing view of adoption over time.</p>
    </div>
    <span class="badge badge-outline">Up to 20 active packages</span>
  </div>
  <section class="card bg-base-100 border border-base-300 panel">
    <form
      class="inline-form"
      @submit.prevent="
        action(() =>
          mutate('/packages', 'POST', {
            provider: 'nuget',
            packageId,
            ...(projectId ? { projectId } : {}),
          }),
        )
      "
    >
      <label
        >NuGet package ID<input
          class="input input-bordered w-full"
          v-model="packageId"
          required
          pattern="[a-zA-Z0-9_.-]{1,100}"
          placeholder="e.g. Newtonsoft.Json" /></label
      ><label
        >Project<select class="select select-bordered" v-model="projectId">
          <option value="">No project / all packages</option>
          <option v-for="p in projects.data.value?.items" :key="p.id" :value="p.id">
            {{ p.name }}{{ p.archived ? ' (archived)' : '' }}
          </option>
        </select></label
      ><button class="btn btn-primary" :disabled="busy">+ Track package</button>
    </form>
    <p class="muted small">
      Only listed nuget.org packages. Collection runs hourly for packages due every six hours.
    </p>
    <form
      v-if="projectId"
      class="inline-form"
      @submit.prevent="
        action(() => mutate('/projects/' + projectId + '/packages/' + existingId, 'PUT', {}))
      "
    >
      <label
        >Associate an existing package<select
          class="select select-bordered"
          v-model="existingId"
          required
        >
          <option disabled value="">Select a tracked package</option>
          <option v-for="p in allPackages.data.value?.items" :key="p.id" :value="p.id">
            {{ p.displayName }}
          </option>
        </select></label
      ><button class="btn btn-outline secondary" :disabled="busy">Add to project</button>
    </form>
  </section>
  <p v-if="error || packages.error.value" role="alert" class="error">
    {{ error || packages.error.value?.message }}
  </p>
  <section class="card bg-base-100 border border-base-300 panel">
    <div class="section-heading">
      <h2>Your packages</h2>
      <span class="muted">{{ packages.data.value?.total ?? 0 }} tracked</span>
    </div>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Latest versions</th>
            <th>Last collected</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in packages.data.value?.items" :key="p.id">
            <td>
              <RouterLink :to="'/packages/' + p.id"
                ><strong>{{ p.displayName }}</strong></RouterLink
              >
              <p class="small muted">
                {{ number(p.observationCount) }} observations · {{ p.provider }}
              </p>
            </td>
            <td>
              {{ p.latestStable ?? '—' }}
              <p class="small muted">
                {{ p.latestPrerelease ? 'Pre: ' + p.latestPrerelease : '' }}
              </p>
            </td>
            <td class="small">{{ utc(p.lastSuccess) }}</td>
            <td>
              <span class="badge badge-outline" :class="{ warning: p.status === 'failed' }">{{
                p.archived ? 'archived' : p.status
              }}</span>
            </td>
            <td>
              <div class="actions">
                <button
                  class="btn btn-outline secondary small"
                  :disabled="busy || p.archived"
                  @click="action(() => mutate('/sync/' + p.id + '/refresh', 'POST', {}))"
                >
                  Refresh</button
                ><button
                  class="btn btn-outline secondary small"
                  :disabled="busy"
                  @click="
                    action(() => mutate('/packages/' + p.id, 'PATCH', { archived: !p.archived }))
                  "
                >
                  {{ p.archived ? 'Restore' : 'Archive' }}</button
                ><button
                  v-if="projectId"
                  class="btn btn-outline secondary small"
                  @click="
                    action(() => mutate('/projects/' + projectId + '/packages/' + p.id, 'DELETE'))
                  "
                >
                  Unlink</button
                ><button
                  v-if="p.archived"
                  class="btn btn-error btn-outline danger small"
                  @click="remove(p.id)"
                >
                  Delete history
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="packages.data.value?.total === 0" class="empty">
      No packages yet. Add a package ID above to start collecting.
    </p>
  </section>
</template>
