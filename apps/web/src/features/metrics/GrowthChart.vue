<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { init, use, type ECharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { Metrics, TrackedPackage } from '@sourcemetric/contracts';
use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);
const props = defineProps<{ metrics: Metrics; packages: TrackedPackage[] }>();
const element = ref<HTMLDivElement>();
let chart: ECharts | undefined;
let observer: ResizeObserver | undefined;
function render() {
  if (!chart) return;
  const ids = [...new Set(props.metrics.points.map((p) => p.packageId))];
  chart.setOption(
    {
      color: ['#18785b', '#c48031', '#6289b1', '#9d6db2'],
      tooltip: {
        trigger: 'axis',
        confine: true,
        renderMode: 'richText',
        formatter: (params: unknown) => {
          const rows = params as {
            seriesName: string;
            data: { name: string; value: [number, number | null] };
          }[];
          return rows
            .map(
              (p) =>
                p.seriesName +
                '\n' +
                p.data.name +
                '\nObserved growth: ' +
                (p.data.value[1] ?? 'unavailable'),
            )
            .join('\n\n');
        },
      },
      legend: { bottom: 0 },
      grid: { left: 65, right: 25, top: 24, bottom: 60 },
      xAxis: {
        type: 'time',
        axisLabel: { formatter: (v: number) => new Date(v).toISOString().slice(5, 10) },
      },
      yAxis: {
        type: 'value',
        name: 'Observed downloads',
        splitLine: { lineStyle: { color: '#edf0ec' } },
      },
      series: ids.map((id, index) => ({
        name: props.packages.find((p) => p.id === id)?.displayName ?? id,
        type: 'line',
        connectNulls: false,
        showSymbol: true,
        symbolSize: 5,
        data: props.metrics.points
          .filter((p) => p.packageId === id)
          .map((p) => ({
            value: [Date.parse(p.observedAt), p.growth],
            name: (p.intervalStart ?? 'Baseline') + ' → ' + p.observedAt + ' (' + p.quality + ')',
          })),
        markLine:
          index === 0
            ? {
                symbol: 'none',
                silent: true,
                lineStyle: { color: '#c48031', type: 'dashed' },
                data: props.metrics.annotations.map((n) => ({
                  xAxis: Date.parse(n.occurredAt),
                  label: { formatter: n.title },
                })),
              }
            : undefined,
      })),
    },
    true,
  );
}
onMounted(() => {
  chart = init(element.value);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(element.value!);
  render();
});
watch(() => [props.metrics, props.packages], render, { deep: true });
onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>
<template>
  <div
    ref="element"
    class="chart"
    role="img"
    aria-label="Observed download growth by package. Values represent collection intervals, with gaps and baselines left empty."
  />
</template>
