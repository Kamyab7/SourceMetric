<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
const props = withDefaults(
  defineProps<{ page: number; pageSize: number; total: number; busy?: boolean; label: string }>(),
  { busy: false },
);
const emit = defineEmits<{ 'update:page': [number]; 'update:pageSize': [number] }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const first = computed(() =>
  props.total ? Math.min(props.total, (props.page - 1) * props.pageSize + 1) : 0,
);
</script>
<template>
  <nav
    :aria-label="label + ' pagination'"
    class="flex flex-wrap items-center justify-between gap-3 mt-5 border-t border-base-300 pt-4"
  >
    <p class="small muted" aria-live="polite">
      {{ first }}–{{ Math.min(page * pageSize, total) }} of {{ total }}
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <label class="flex-row items-center gap-2"
        >Per page<select
          class="select select-sm w-20"
          :aria-label="label + ' items per page'"
          :value="pageSize"
          :disabled="busy"
          @change="
            emit('update:pageSize', Number(($event.target as HTMLSelectElement).value));
            emit('update:page', 1);
          "
        >
          <option v-for="n in [10, 20, 50]" :key="n" :value="n">{{ n }}</option>
        </select></label
      >
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn btn-sm btn-ghost border-0 shadow-none"
          :aria-label="'Previous ' + label + ' page'"
          :disabled="busy || page <= 1"
          @click="emit('update:page', page - 1)"
        >
          <ChevronLeft :size="15" aria-hidden="true" /></button
        ><span class="btn btn-sm btn-ghost pointer-events-none" aria-live="polite"
          >{{ page }} / {{ pages }}</span
        ><button
          type="button"
          class="btn btn-sm btn-ghost border-0 shadow-none"
          :aria-label="'Next ' + label + ' page'"
          :disabled="busy || page >= pages"
          @click="emit('update:page', page + 1)"
        >
          <ChevronRight :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>
  </nav>
</template>
