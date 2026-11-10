<script setup lang="ts">
import { Pencil, Archive, ArchiveRestore, ArrowUpRight } from '@lucide/vue';
import Pagination from '../../shared/Pagination.vue';
import { usePagination } from '../../shared/pagination';
import { ref, watch } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import { useProjects } from './queries';
import { mutate, utc } from '../../shared/api';
const total = ref(0);
const { page, pageSize } = usePagination(total);
const projects = useProjects(page, pageSize),
  name = ref(''),
  error = ref(''),
  busy = ref(false),
  client = useQueryClient();
watch(
  () => projects.data.value?.total,
  (value) => {
    if (value !== undefined) total.value = value;
  },
  { immediate: true },
);
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
  <section class="card bg-base-100 border border-base-300 panel">
    <form
      class="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      @submit.prevent="action(() => mutate('/projects', 'POST', { name }))"
    >
      <div class="min-w-0">
        <label for="project-name" class="mb-2 block text-xs text-slate-400">Project name</label>
        <input
          id="project-name"
          class="input input-bordered h-11 w-full"
          v-model="name"
          required
          maxlength="120"
          placeholder="My developer toolkit"
        />
      </div>
      <button class="btn btn-primary h-11 w-full sm:w-auto" :disabled="busy">Create project</button>
    </form>
  </section>
  <p v-if="error || projects.error.value" class="error" role="alert">
    {{ error || projects.error.value?.message }}
  </p>
  <div class="project-grid">
    <article
      v-for="project in projects.data.value?.items"
      :key="project.id"
      class="card bg-base-100 border border-base-300 panel"
    >
      <span class="badge badge-soft badge-primary border-0">{{
        project.archived ? 'Archived' : 'Project'
      }}</span>
      <h2>
        <RouterLink :to="'/projects/' + project.id">{{ project.name }} ↗</RouterLink>
      </h2>
      <p class="muted small">Created {{ utc(project.createdAt) }}</p>
      <div class="actions">
        <button
          class="btn btn-sm btn-soft btn-secondary border-0 shadow-none text-secondary"
          @click="rename(project.id, project.name)"
        >
          <Pencil :size="14" aria-hidden="true" />Rename</button
        ><button
          class="btn btn-sm btn-soft btn-warning border-0 shadow-none text-warning"
          @click="
            action(() =>
              mutate('/projects/' + project.id, 'PATCH', { archived: !project.archived }),
            )
          "
        >
          <component
            :is="project.archived ? ArchiveRestore : Archive"
            :size="14"
            aria-hidden="true"
          />{{ project.archived ? 'Restore' : 'Archive' }}</button
        ><RouterLink
          class="btn btn-sm btn-soft btn-primary border-0 shadow-none text-primary"
          :to="'/packages?projectId=' + project.id"
          ><ArrowUpRight :size="14" aria-hidden="true" />Manage packages</RouterLink
        >
      </div>
      <RouterLink class="btn btn-sm btn-ghost" :to="'/repositories?projectId=' + project.id"
        >Manage repositories</RouterLink
      >
    </article>
  </div>
  <Pagination
    v-model:page="page"
    v-model:page-size="pageSize"
    :total="total"
    :busy="projects.isFetching.value"
    label="projects"
  />
  <p v-if="projects.data.value?.total === 0" class="empty">
    Create your first project to group your packages.
  </p>
</template>
