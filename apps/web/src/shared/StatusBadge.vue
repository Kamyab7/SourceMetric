<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ status: string; label?: string }>();
const tone = computed(
  () =>
    ({
      success: 'badge-success',
      partial: 'badge-warning',
      failed: 'badge-error',
      interrupted: 'badge-warning',
      queued: 'badge-warning',
      running: 'badge-info',
      archived: 'badge-neutral',
    })[props.status] ?? 'badge-neutral',
);
</script>
<template>
  <span class="badge badge-soft border-0" :class="tone">{{ label ?? status }}</span>
</template>
