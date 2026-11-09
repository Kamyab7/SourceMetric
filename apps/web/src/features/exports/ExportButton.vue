<script setup lang="ts">
import { Download } from '@lucide/vue';
import type { MetricRange } from '@sourcemetric/contracts';
import { rangeQuery } from '../metrics/queries';
defineProps<{ range: MetricRange }>();
</script>
<template>
  <a class="btn btn-outline secondary" :href="'/api/v1/exports?' + rangeQuery(range)"
    ><Download :size="15" aria-hidden="true" /> Export CSV</a
  >
</template>
