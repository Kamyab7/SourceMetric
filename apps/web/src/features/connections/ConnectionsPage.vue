<script setup lang="ts">
import { ref } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { connectionsSchema } from '@sourcemetric/contracts';
import { api, mutate, utc } from '../../shared/api';
import Pagination from '../../shared/Pagination.vue';
const client = useQueryClient();
const page = ref(1);
const pageSize = ref(50);
const copied = ref(false);
const error = ref('');
const busy = ref<string | null>(null);
const connections = useQuery({
  queryKey: ['connections', page, pageSize],
  queryFn: () =>
    api(
      `/connections?limit=${pageSize.value}&offset=${(page.value - 1) * pageSize.value}`,
      connectionsSchema,
    ),
});
async function copy() {
  try {
    await navigator.clipboard.writeText(connections.data.value?.mcpUrl ?? '');
    copied.value = true;
  } catch {
    error.value = 'Copy failed. Select and copy the URL below.';
  }
}
async function revoke(id: string) {
  busy.value = id;
  error.value = '';
  try {
    await mutate(`/connections/${id}`, 'DELETE');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Revocation failed.';
  } finally {
    await client.invalidateQueries({ queryKey: ['connections'] });
    busy.value = null;
  }
}
</script>
<template>
  <section class="space-y-6">
    <div>
      <h1 class="text-3xl font-semibold">AI connections</h1>
      <p class="muted mt-2">Give AI clients read-only access to your SourceMetric statistics.</p>
    </div>
    <p v-if="connections.isPending.value" role="status">Loading connections…</p>
    <p v-if="connections.error.value" role="alert" class="text-error">
      {{ connections.error.value.message }}
    </p>
    <p v-if="error" role="alert" class="text-error">{{ error }}</p>
    <template v-if="connections.data.value">
      <div class="card bg-base-200 p-6 space-y-3">
        <label for="mcp-url" class="font-medium">MCP server URL</label>
        <div class="flex flex-wrap gap-2">
          <input
            id="mcp-url"
            class="input input-bordered flex-1 min-w-64"
            :value="connections.data.value.mcpUrl"
            readonly
          /><button class="btn btn-primary" @click="copy">
            {{ copied ? 'Copied' : 'Copy URL' }}
          </button>
        </div>
        <p class="text-sm font-normal muted">
          Approved clients can read all projects, NuGet downloads, GitHub statistics, private
          repository names and traffic, and release/campaign context. They cannot edit data or
          trigger collection.
        </p>
        <p v-if="connections.data.value.demo" class="text-warning">
          OAuth approval is disabled in this demo.
        </p>
      </div>
      <section class="card bg-base-100 border border-base-300 panel">
        <div class="section-heading">
          <h2>Your approved connections</h2>
          <span class="muted">{{ connections.data.value.total }} connections</span>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Permissions</th>
                <th>Approved</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="connection in connections.data.value.items" :key="connection.id">
                <td>
                  <strong>{{ connection.clientName }}</strong>
                </td>
                <td>{{ connection.permissions.join(', ') }}</td>
                <td class="small">{{ utc(connection.createdAt) }}</td>
                <td class="small">{{ utc(connection.expiresAt) }}</td>
                <td>
                  <span
                    class="badge badge-soft border-0"
                    :class="
                      connection.revokedAt
                        ? 'badge-neutral'
                        : Date.parse(connection.expiresAt) <= Date.now()
                          ? 'badge-warning'
                          : 'badge-success'
                    "
                  >
                    {{
                      connection.revokedAt
                        ? 'Revoked'
                        : Date.parse(connection.expiresAt) <= Date.now()
                          ? 'Expired'
                          : 'Active'
                    }}
                  </span>
                  <p v-if="connection.revokedAt" class="small muted">
                    {{ utc(connection.revokedAt) }}
                  </p>
                </td>
                <td>
                  <div class="actions">
                    <button
                      class="btn btn-sm btn-soft btn-error border-0 shadow-none text-error"
                      :disabled="
                        Boolean(busy) ||
                        connections.data.value.demo ||
                        Boolean(connection.revokedAt && !connection.cleanupPending)
                      "
                      @click="revoke(connection.id)"
                    >
                      {{
                        busy === connection.id
                          ? 'Revoking…'
                          : connection.cleanupPending
                            ? 'Retry grant cleanup'
                            : connection.revokedAt
                              ? 'Revoked'
                              : 'Revoke'
                      }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!connections.data.value.items.length" class="empty">
          No connections yet. Start by adding the MCP server in your AI client.
        </p>
        <Pagination
          :total="connections.data.value.total"
          :page="page"
          :page-size="pageSize"
          :busy="connections.isFetching.value"
          label="connections"
          @update:page="page = $event"
          @update:page-size="pageSize = $event"
        />
      </section>
    </template>
  </section>
</template>
