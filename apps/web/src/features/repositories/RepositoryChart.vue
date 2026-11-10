<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { init, use, type ECharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { RepositoryMetrics } from '@sourcemetric/contracts';
use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
const props = defineProps<{
  metrics: RepositoryMetrics;
  metric: 'stars' | 'forks' | 'clones' | 'uniques' | 'views' | 'visitors';
}>();
const element = ref<HTMLDivElement>();
let chart: ECharts | undefined, observer: ResizeObserver | undefined;
function render() {
  const m = props.metrics,
    daily = ['clones', 'uniques', 'views', 'visitors'].includes(props.metric);
  const dailyRows = new Map(
    (['views', 'visitors'].includes(props.metric) ? m.viewDays : m.days).map((d) => [
      d.repositoryId + '|' + d.day,
      d,
    ]),
  );
  chart?.setOption(
    {
      color: ['#38d9f5', '#a78bfa', '#fbbf24', '#34d399'],
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        confine: true,
        formatter: (params: unknown) =>
          (
            params as {
              seriesName: string;
              data: { name: string; value: [number, number | null] };
            }[]
          )
            .map(
              (p) =>
                p.seriesName + '\n' + p.data.name + '\nValue: ' + (p.data.value[1] ?? 'unknown'),
            )
            .join('\n\n'),
      },
      legend: { bottom: 0, textStyle: { color: '#91a1b8' } },
      grid: { left: 65, right: 25, top: 24, bottom: 60 },
      xAxis: {
        type: 'time',
        splitNumber: 6,
        min: Date.parse(m.from),
        max: Date.parse(m.to),
        axisLabel: { formatter: (v: number) => new Date(v).toISOString().slice(5, 10) },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#203047' } } },
      series: m.repositories.map((r) => {
        const data = [];
        if (daily) {
          for (
            let t = Math.floor(Date.parse(m.from) / 86400000) * 86400000;
            t < Date.parse(m.to);
            t += 86400000
          ) {
            const day = new Date(t).toISOString(),
              d = dailyRows.get(r.id + '|' + day);
            data.push({
              value: [
                t,
                d ? (['clones', 'views'].includes(props.metric) ? d.count : d.uniques) : null,
              ],
              name:
                day +
                (d
                  ? ' · observed ' + d.observedAt + (d.provisional ? ' · provisional' : '')
                  : ' · unknown'),
            });
          }
        } else {
          const points = m.snapshots.filter((p) => p.repositoryId === r.id);
          for (let i = 0; i < points.length; i++) {
            const p = points[i]!;
            if (
              i > 0 &&
              Date.parse(p.observedAt) - Date.parse(points[i - 1]!.observedAt) > 7 * 3600000
            )
              data.push({
                value: [Date.parse(points[i - 1]!.observedAt) + 1, null],
                name: 'Collection gap',
              });
            data.push({
              value: [Date.parse(p.observedAt), p[props.metric as 'stars' | 'forks']],
              name: p.observedAt,
            });
          }
        }
        return { name: r.fullName, type: 'line', connectNulls: false, showSymbol: false, data };
      }),
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
watch(() => [props.metrics, props.metric], render);
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
    :aria-label="'GitHub ' + metric + ' by repository. Missing data is left empty; times are UTC.'"
  />
</template>
