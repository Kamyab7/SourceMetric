<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useRepository } from './queries';
import RepositoryMetricsPanel from './RepositoryMetricsPanel.vue';
const route = useRoute(),
  id = computed(() => String(route.params.repositoryId)),
  repository = useRepository(id);
const end = new Date();
end.setUTCHours(0, 0, 0, 0);
const days = ref('30'),
  from = ref(new Date(end.getTime() - 30 * 86400000).toISOString().slice(0, 10)),
  to = ref(end.toISOString().slice(0, 10));
const range = computed(() => ({
  repositoryId: id.value,
  from:
    days.value === 'custom'
      ? new Date((from.value || end.toISOString().slice(0, 10)) + 'T00:00:00Z').toISOString()
      : new Date(end.getTime() - Number(days.value) * 86400000).toISOString(),
  to:
    days.value === 'custom'
      ? new Date((to.value || end.toISOString().slice(0, 10)) + 'T00:00:00Z').toISOString()
      : end.toISOString(),
}));
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">GITHUB REPOSITORY</p>
      <h1>{{ repository.data.value?.fullName ?? 'Repository' }}</h1>
      <p class="muted">{{ repository.data.value?.description }}</p>
    </div>
    <a
      v-if="repository.data.value"
      class="btn btn-ghost"
      :href="repository.data.value.url"
      target="_blank"
      rel="noopener noreferrer"
      >View on GitHub</a
    >
  </div>
  <p v-if="repository.error.value" class="error" role="alert">
    {{ repository.error.value.message }}
  </p>
  <div class="toolbar">
    <label
      >Range<select class="select select-bordered" v-model="days" aria-label="Range">
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="custom">Custom</option>
      </select></label
    ><template v-if="days === 'custom'"
      ><input
        class="input input-bordered"
        type="date"
        aria-label="Start date UTC"
        v-model="from"
        required /><input
        class="input input-bordered"
        type="date"
        aria-label="End date UTC"
        v-model="to"
        required
    /></template>
  </div>
  <RepositoryMetricsPanel :range="range" />
</template>
