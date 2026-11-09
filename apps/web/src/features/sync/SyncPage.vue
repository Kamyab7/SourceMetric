<script setup lang="ts">
import { useSync } from './queries';
import { number, utc } from '../../shared/api';
const sync = useSync();
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">COLLECTION HEALTH</p>
      <h1>Every observation accounted for.</h1>
      <p class="muted">
        Hourly checks. Six-hour collection intervals. History retained indefinitely.
      </p>
    </div>
  </div>
  <p v-if="sync.error.value" class="error">{{ sync.error.value.message }}</p>
  <div class="stats">
    <article>
      <span class="eyebrow">STORED OBSERVATIONS</span
      ><strong>{{ number(sync.data.value?.observationCount) }}</strong
      ><span class="small muted">No automatic deletion</span>
    </article>
    <article>
      <span class="eyebrow">PACKAGES</span
      ><strong>{{ sync.data.value?.packages.length ?? 0 }}</strong
      ><span class="small muted">Up to four per collector invocation</span>
    </article>
  </div>
  <section class="card bg-base-100 border border-base-300 panel">
    <h2>Collection schedule</h2>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Last attempt</th>
            <th>Last success</th>
            <th>Next attempt</th>
            <th>Status / error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in sync.data.value?.packages" :key="p.id">
            <td>{{ p.displayName }}</td>
            <td>{{ utc(p.lastAttempt) }}</td>
            <td>{{ utc(p.lastSuccess) }}</td>
            <td>{{ p.archived ? 'Archived' : utc(p.nextAttempt) }}</td>
            <td>
              <span class="badge badge-outline" :class="{ warning: !!p.lastError }">{{
                p.status
              }}</span>
              <p class="error small">{{ p.lastError }}</p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <section class="card bg-base-100 border border-base-300 panel">
    <h2>Recent collection attempts</h2>
    <table class="table">
      <thead>
        <tr>
          <th>Package</th>
          <th>Started</th>
          <th>Status</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in sync.data.value?.attempts" :key="a.id">
          <td>
            {{
              sync.data.value?.packages.find((p) => p.id === a.packageId)?.displayName ??
              a.packageId
            }}
          </td>
          <td>{{ utc(a.startedAt) }}</td>
          <td>{{ a.status }}</td>
          <td>{{ a.error ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
  <p class="muted small">
    Stored observations grow with packages × versions × collections. Review D1 storage usage in
    Cloudflare; free-tier hosting is not unlimited.
  </p>
</template>
