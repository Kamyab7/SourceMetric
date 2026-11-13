<script setup lang="ts">
import { Pencil, Trash2, X } from '@lucide/vue';
import Pagination from '../../shared/Pagination.vue';
import { usePagination } from '../../shared/pagination';
import { ref, watch } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import type { Annotation } from '@sourcemetric/contracts';
import { useAnnotations } from './queries';
import { useProjects } from '../projects/queries';
import { usePackages } from '../packages/queries';
import { mutate, utc } from '../../shared/api';
const total = ref(0);
const { page, pageSize } = usePagination(total);
const notes = useAnnotations(page, pageSize),
  projects = useProjects(),
  packages = usePackages(),
  client = useQueryClient();
watch(
  () => notes.data.value?.total,
  (value) => {
    if (value !== undefined) total.value = value;
  },
  { immediate: true },
);
const editing = ref(''),
  title = ref(''),
  body = ref(''),
  kind = ref('campaign'),
  target = ref(''),
  date = ref(new Date().toISOString().slice(0, 16)),
  error = ref(''),
  busy = ref(false);
function edit(note: Annotation) {
  editing.value = note.id;
  title.value = note.title;
  body.value = note.body;
  kind.value = note.kind;
  target.value = (note.projectId ? 'project:' : 'package:') + (note.projectId ?? note.packageId);
  date.value = note.occurredAt.slice(0, 16);
}
function reset() {
  editing.value = '';
  title.value = '';
  body.value = '';
}
async function save() {
  if (!target.value) return;
  const [type, id] = target.value.split(':');
  await action(() =>
    mutate(
      '/annotations' + (editing.value ? '/' + editing.value : ''),
      editing.value ? 'PUT' : 'POST',
      {
        title: title.value,
        body: body.value,
        kind: kind.value,
        occurredAt: new Date(date.value + 'Z').toISOString(),
        ...(type === 'project' ? { projectId: id } : { packageId: id }),
      },
    ),
  );
}
async function action(run: () => Promise<unknown>) {
  error.value = '';
  busy.value = true;
  try {
    await run();
    reset();
    await client.invalidateQueries();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">ADD CONTEXT</p>
      <h1>Releases & campaigns</h1>
      <p class="muted">Remember what happened when your growth changed.</p>
    </div>
  </div>
  <form class="card bg-base-100 border border-base-300 panel note-form" @submit.prevent="save">
    <h2>{{ editing ? 'Edit note' : 'Add a note' }}</h2>
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <label
        >Project or package<select
          class="select select-bordered h-11 w-full"
          v-model="target"
          required
        >
          <option disabled value="">Choose a target</option>
          <optgroup label="Projects">
            <option v-for="p in projects.data.value?.items" :key="p.id" :value="'project:' + p.id">
              {{ p.name }}
            </option>
          </optgroup>
          <optgroup label="Packages">
            <option v-for="p in packages.data.value?.items" :key="p.id" :value="'package:' + p.id">
              {{ p.displayName }}
            </option>
          </optgroup>
        </select></label
      ><label
        >Date and time (UTC)<input
          class="input input-bordered h-11 w-full"
          v-model="date"
          type="datetime-local"
          required
      /></label>
    </div>
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <label
        >Title<input
          class="input input-bordered h-11 w-full"
          v-model="title"
          maxlength="120"
          required
          placeholder="Launch blog post" /></label
      ><label
        >Kind<select class="select select-bordered h-11 w-full" v-model="kind">
          <option value="campaign">Campaign</option>
          <option value="release">Release</option>
        </select></label
      >
    </div>
    <label
      >Notes<textarea
        class="textarea textarea-bordered min-h-40 w-full resize-y"
        v-model="body"
        maxlength="2000"
        rows="6"
        placeholder="Add details about the release or campaign…"
      />
    </label>
    <div class="actions">
      <button class="btn btn-primary" :disabled="busy">Save note</button
      ><button
        v-if="editing"
        type="button"
        class="btn btn-sm btn-soft btn-secondary border-0 shadow-none text-secondary"
        @click="reset"
      >
        <X :size="14" aria-hidden="true" />Cancel
      </button>
    </div>
  </form>
  <p v-if="error || notes.error.value" class="error" role="alert">
    {{ error || notes.error.value?.message }}
  </p>
  <section class="card bg-base-100 border border-base-300 panel">
    <article v-for="note in notes.data.value?.items" :key="note.id" class="annotation-entry">
      <div class="section-heading">
        <div>
          <span
            class="badge badge-soft border-0"
            :class="note.kind === 'release' ? 'badge-secondary' : 'badge-primary'"
            >{{ note.kind }}{{ note.automatic ? ' · discovered' : '' }}</span
          >
          <h3>{{ note.title }}</h3>
          <p class="small muted">{{ utc(note.occurredAt) }}</p>
        </div>
        <div class="actions">
          <button
            class="btn btn-sm btn-soft btn-secondary border-0 shadow-none text-secondary"
            @click="edit(note)"
          >
            <Pencil :size="14" aria-hidden="true" />Edit</button
          ><button
            class="btn btn-sm btn-soft btn-error border-0 shadow-none text-error"
            @click="action(() => mutate('/annotations/' + note.id, 'DELETE'))"
          >
            <Trash2 :size="14" aria-hidden="true" />Delete
          </button>
        </div>
      </div>
      <p class="preserve">{{ note.body }}</p>
    </article>
    <p v-if="notes.data.value?.total === 0" class="empty">
      No notes yet. Add a release or campaign to give your metrics context.
    </p>
    <p class="small muted">Automatic version notes use discovery time, not publication time.</p>
    <Pagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
      :busy="notes.isFetching.value"
      label="notes"
    />
  </section>
</template>
