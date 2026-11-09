<script setup lang="ts">
import { ref } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import type { Annotation } from '@sourcemetric/contracts';
import { useAnnotations } from './queries';
import { useProjects } from '../projects/queries';
import { usePackages } from '../packages/queries';
import { mutate, utc } from '../../shared/api';
const notes = useAnnotations(),
  projects = useProjects(),
  packages = usePackages(),
  client = useQueryClient();
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
  <form class="panel note-form" @submit.prevent="save">
    <h2>{{ editing ? 'Edit note' : 'Add a note' }}</h2>
    <div class="two-columns">
      <label
        >Project or package<select v-model="target" required>
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
      ><label>Date and time (UTC)<input v-model="date" type="datetime-local" required /></label>
    </div>
    <div class="two-columns">
      <label
        >Title<input
          v-model="title"
          maxlength="120"
          required
          placeholder="Launch blog post" /></label
      ><label
        >Kind<select v-model="kind">
          <option value="campaign">Campaign</option>
          <option value="release">Release</option>
        </select></label
      >
    </div>
    <label>Notes<textarea v-model="body" maxlength="2000" rows="3" /></label>
    <div class="actions">
      <button :disabled="busy">Save note</button
      ><button v-if="editing" type="button" class="secondary" @click="reset">Cancel</button>
    </div>
  </form>
  <p v-if="error || notes.error.value" class="error" role="alert">
    {{ error || notes.error.value?.message }}
  </p>
  <section class="panel">
    <article v-for="note in notes.data.value?.items" :key="note.id" class="timeline">
      <div class="section-heading">
        <div>
          <span class="badge">{{ note.kind }}{{ note.automatic ? ' · discovered' : '' }}</span>
          <h3>{{ note.title }}</h3>
          <p class="small muted">{{ utc(note.occurredAt) }}</p>
        </div>
        <div class="actions">
          <button class="secondary small" @click="edit(note)">Edit</button
          ><button
            class="danger small"
            @click="action(() => mutate('/annotations/' + note.id, 'DELETE'))"
          >
            Delete
          </button>
        </div>
      </div>
      <p class="preserve">{{ note.body }}</p>
    </article>
    <p v-if="notes.data.value?.total === 0" class="empty">
      No notes yet. Add a release or campaign to give your metrics context.
    </p>
    <p class="small muted">
      Showing up to 100 latest notes. Automatic version notes use discovery time, not publication
      time.
    </p>
  </section>
</template>
