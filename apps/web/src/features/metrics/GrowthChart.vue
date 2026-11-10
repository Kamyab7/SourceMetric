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
      color: ['#3ecf8e', '#93b8ec', '#e8b95b', '#c4a7e7', '#f08080', '#a7d8bf'],
      tooltip: {
        trigger: 'axis',
        confine: true,
        renderMode: 'richText',
        backgroundColor: '#202020',
        borderColor: '#404040',
        textStyle: { color: '#ededed' },
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
      textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif', color: '#a3a3a3' },
      legend: { bottom: 0, textStyle: { color: '#a3a3a3' } },
      grid: { left: 65, right: 25, top: 24, bottom: 60 },
      xAxis: {
        type: 'time',
        min: Date.parse(props.metrics.from),
        max: Date.parse(props.metrics.to),
        axisLabel: {
          color: '#a3a3a3',
          formatter: (v: number) => new Date(v).toISOString().slice(5, 10),
        },
      },
      yAxis: {
        type: 'value',
        name: 'Observed downloads',
        nameTextStyle: { color: '#a3a3a3' },
        axisLabel: { color: '#a3a3a3' },
        splitLine: { lineStyle: { color: '#333333' } },
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
                lineStyle: { color: '#a7d8bf', type: 'dashed' },
                data: [
                  ...new Map(props.metrics.annotations.map((n) => [n.occurredAt, n])).values(),
                ].map((n) => ({
                  xAxis: Date.parse(n.occurredAt),
                  label: { show: false, formatter: n.title },
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
