<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { cloudflareUsageSchema } from '@sourcemetric/contracts';
import { api, number, utc } from '../../shared/api';

const usage = useQuery({
  queryKey: ['cloudflare-usage', new Date().toISOString().slice(0, 10)],
  queryFn: () => api('/cloudflare/usage', cloudflareUsageSchema),
  staleTime: 60_000,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});
const format = (value: number, unit: string) =>
  unit === 'bytes'
    ? value >= 1_000_000_000
      ? number(value / 1_000_000_000) + ' GB'
      : value >= 1_000_000
        ? number(value / 1_000_000) + ' MB'
        : number(value) + ' bytes'
    : number(value);
</script>

<template>
  <section class="usage-page" aria-labelledby="cloudflare-usage-title">
    <div class="page-heading">
      <div>
        <p class="eyebrow">FREE TIER · THIS DEPLOYMENT</p>
        <h1 id="cloudflare-usage-title">Cloudflare usage</h1>
      </div>
    </div>
    <p>SourceMetric usage only. Other apps may consume the same account allowance.</p>
    <p class="muted small">
      Daily counters start at midnight UTC. Storage shows the latest available daily measurement.
      Analytics may be delayed or sampled.
    </p>
    <div class="actions">
      <button
        class="btn btn-outline btn-sm"
        :disabled="usage.isFetching.value"
        @click="usage.refetch()"
      >
        Refresh
      </button>
      <span v-if="usage.data.value" class="small muted"
        >Last updated: {{ utc(usage.data.value.fetchedAt) }}</span
      >
    </div>
    <p v-if="usage.isFetching.value" role="status">Loading Cloudflare usage…</p>
    <p v-if="usage.error.value" class="error" role="alert">{{ usage.error.value.message }}</p>
    <template v-if="usage.data.value">
      <p v-if="usage.data.value.demo" class="badge badge-warning">Demo · synthetic usage</p>
      <div v-if="!usage.data.value.configured" class="usage-setup" role="status">
        <h3>Set up usage reporting</h3>
        <p>
          Create a separate Cloudflare API token with Account Analytics: Read for this account. Set
          CLOUDFLARE_ANALYTICS_API_TOKEN in your deployment environment and rerun pnpm deploy.
        </p>
        <p class="small">
          Manual deployments also need the account ID, Worker name, D1 database ID, and KV namespace
          ID. See the
          <a
            href="https://github.com/Kamyab7/SourceMetric/blob/master/docs/deployment.md#cloudflare-usage-panel"
            target="_blank"
            rel="noopener noreferrer"
            >deployment guide</a
          >.
        </p>
      </div>
      <template v-else>
        <p class="small muted">Daily allowances reset: {{ utc(usage.data.value.resetsAt) }}</p>
        <div class="usage-metrics">
          <article v-for="metric in usage.data.value.metrics" :key="metric.id" class="usage-metric">
            <h3>
              {{ metric.label }}
              <span class="small muted">{{ metric.period === 'daily' ? '· today' : '' }}</span>
            </h3>
            <template
              v-if="
                metric.status === 'available' &&
                metric.used !== null &&
                metric.remaining !== null &&
                metric.percent !== null
              "
            >
              <p>
                <strong>{{ format(metric.used, metric.unit) }}</strong> /
                {{ format(metric.allowance, metric.unit) }}
                <span class="muted">({{ number(metric.percent) }}%)</span>
              </p>
              <progress
                class="progress progress-primary"
                :aria-label="metric.label + ' allowance used'"
                :value="Math.min(metric.percent, 100)"
                max="100"
              ></progress>
              <p class="small">
                {{ format(metric.remaining, metric.unit) }} remaining{{
                  metric.allowanceScope === 'account'
                    ? ', excluding other apps'
                    : ' in this database'
                }}
              </p>
              <p v-if="metric.period === 'storage'" class="small muted">
                Latest sample day: {{ metric.measuredAt?.slice(0, 10) }} UTC (daily maximum)
              </p>
            </template>
            <p v-else class="small error">Unavailable. {{ metric.message }}</p>
          </article>
        </div>
      </template>
    </template>
    <p class="small muted usage-sources">
      Free tier references:
      <a
        href="https://developers.cloudflare.com/workers/platform/limits/"
        target="_blank"
        rel="noopener noreferrer"
        >Workers limits</a
      >
      ·
      <a
        href="https://developers.cloudflare.com/d1/platform/limits/"
        target="_blank"
        rel="noopener noreferrer"
        >D1 limits</a
      >
      ·
      <a
        href="https://developers.cloudflare.com/kv/platform/pricing/"
        target="_blank"
        rel="noopener noreferrer"
        >KV allowances</a
      >
    </p>
  </section>
</template>

<style scoped>
.usage-page p {
  margin-block: 0.75rem;
}
.usage-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.usage-metric,
.usage-setup {
  padding: 1rem;
  border: 1px solid var(--color-base-300);
  border-radius: 0.5rem;
}
.usage-sources {
  margin-top: 1.5rem;
}
@media (max-width: 600px) {
  .usage-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
