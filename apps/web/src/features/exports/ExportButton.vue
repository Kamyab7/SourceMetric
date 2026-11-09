<script setup lang="ts">
import type { MetricRange } from '@sourcemetric/contracts';
import { rangeQuery } from '../metrics/queries';
defineProps<{ range: MetricRange }>();
</script>
<template>
  <a class="button secondary" :href="'/api/v1/exports?' + rangeQuery(range)">↓ Export CSV</a>
</template>
