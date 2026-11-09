<script setup lang="ts">
import { ref } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import { useProjects } from './queries';
import { mutate, utc } from '../../shared/api';
const projects = useProjects(),
  name = ref(''),
  error = ref(''),
  busy = ref(false),
  client = useQueryClient();
async function action(run: () => Promise<unknown>) {
  error.value = '';
  busy.value = true;
  try {
    await run();
    name.value = '';
    await client.invalidateQueries();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function rename(id: string, current: string) {
  const next = prompt('Project name', current);
  if (next?.trim()) action(() => mutate('/projects/' + id, 'PATCH', { name: next }));
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">ORGANIZE</p>
      <h1>Projects</h1>
      <p class="muted">Bring related packages together. Shared packages are counted once.</p>
    </div>
  </div>
  <form
    class="card bg-base-100 border border-base-300 panel inline-form"
    @submit.prevent="action(() => mutate('/projects', 'POST', { name }))"
  >
    <label
      >Project name<input
        class="input input-bordered w-full"
        v-model="name"
        required
        maxlength="120"
        placeholder="My developer toolkit" /></label
    ><button class="btn btn-primary" :disabled="busy">Create project</button>
  </form>
  <p v-if="error || projects.error.value" class="error" role="alert">
    {{ error || projects.error.value?.message }}
  </p>
  <div class="project-grid">
    <article
      v-for="project in projects.data.value?.items"
      :key="project.id"
      class="card bg-base-100 border border-base-300 panel"
    >
      <span class="badge badge-outline">{{ project.archived ? 'Archived' : 'Project' }}</span>
      <h2>
        <RouterLink :to="'/projects/' + project.id">{{ project.name }} ↗</RouterLink>
      </h2>
      <p class="muted small">Created {{ utc(project.createdAt) }}</p>
      <div class="actions">
        <button class="btn btn-outline secondary" @click="rename(project.id, project.name)">
          Rename</button
        ><button
          class="btn btn-outline secondary"
          @click="
            action(() =>
              mutate('/projects/' + project.id, 'PATCH', { archived: !project.archived }),
            )
          "
        >
          {{ project.archived ? 'Restore' : 'Archive' }}</button
        ><RouterLink :to="'/packages?projectId=' + project.id">Manage packages →</RouterLink>
      </div>
    </article>
  </div>
  <p v-if="projects.data.value?.total === 0" class="empty">
    Create your first project to group your packages.
  </p>
</template>
