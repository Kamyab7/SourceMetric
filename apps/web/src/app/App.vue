<script setup lang="ts">
import {
  Menu,
  Activity,
  Boxes,
  GitFork,
  FolderKanban,
  Megaphone,
  LayoutDashboard,
  ShieldCheck,
  FlaskConical,
  LogOut,
  ChevronRight,
} from '@lucide/vue';
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { healthSchema } from '@sourcemetric/contracts';
import { api } from '../shared/api';
import { useProjects } from '../features/projects/queries';
const menuOpen = ref(true);
const route = useRoute();
const projects = useProjects();
const health = useQuery({
  queryKey: ['health'],
  queryFn: () => api('/health', healthSchema),
  staleTime: Infinity,
});
const activeProjects = computed(() => projects.data.value?.items.filter((p) => !p.archived) ?? []);
const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/repositories', label: 'Repositories', icon: GitFork },
  { to: '/packages', label: 'Packages', icon: Boxes },
  { to: '/annotations', label: 'Releases & campaigns', icon: Megaphone },
  { to: '/sync', label: 'Collection health', icon: Activity },
];
const breadcrumbLabel = computed(
  () =>
    navigation.find((item) =>
      item.to === '/'
        ? route.path === '/'
        : route.path === item.to || route.path.startsWith(`${item.to}/`),
    )?.label ?? 'Overview',
);
</script>
<template>
  <div class="shell">
    <aside id="workspace-sidebar" :class="{ 'sidebar-collapsed': !menuOpen }" :inert="!menuOpen">
      <RouterLink to="/" class="brand" aria-label="SourceMetric home">
        <img
          src="/brand/sourcemetric-wordmark-v2.svg"
          alt="SourceMetric"
          width="200"
          height="41"
          class="w-full h-auto"
        />
      </RouterLink>
      <p class="workspace-label">WORKSPACE</p>
      <nav class="menu w-full p-0 gap-1" aria-label="Main navigation">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          exact-active-class="selected"
          :aria-label="item.label"
          ><component :is="item.icon" :size="22" :stroke-width="1.6" aria-hidden="true" /><span>{{
            item.label
          }}</span></RouterLink
        >
      </nav>
      <p class="workspace-label">YOUR PROJECTS</p>
      <nav class="menu w-full p-0" aria-label="Projects">
        <RouterLink v-for="p in activeProjects.slice(0, 8)" :key="p.id" :to="'/projects/' + p.id"
          ><span class="project-dot" />{{ p.name
          }}<ChevronRight :size="16" class="ml-auto" aria-hidden="true"
        /></RouterLink>
        <RouterLink v-if="activeProjects.length > 8" to="/projects"
          >View all {{ activeProjects.length }} projects<ChevronRight :size="16" aria-hidden="true"
        /></RouterLink>
      </nav>
      <div v-if="!health.data.value?.demo" class="sidebar-footer">
        <a class="sign-out-link" href="/cdn-cgi/access/logout"
          ><LogOut :size="22" :stroke-width="1.6" aria-hidden="true" /><span>Sign out</span></a
        >
      </div>
    </aside>
    <div class="main">
      <header>
        <div class="flex min-w-0 items-center gap-3">
          <button
            class="btn btn-ghost btn-square btn-sm shrink-0 text-primary"
            type="button"
            :aria-label="menuOpen ? 'Collapse navigation' : 'Expand navigation'"
            :aria-expanded="menuOpen"
            aria-controls="workspace-sidebar"
            @click="menuOpen = !menuOpen"
          >
            <Menu :size="22" :stroke-width="1.6" aria-hidden="true" />
          </button>
          <span class="flex items-center gap-3"
            ><span class="text-primary">Workspace</span
            ><ChevronRight :size="12" aria-hidden="true" /><span class="muted">{{
              breadcrumbLabel
            }}</span></span
          >
        </div>
        <span class="flex items-center gap-2 text-sm font-medium text-slate-300"
          ><component
            :is="health.data.value?.demo ? FlaskConical : ShieldCheck"
            :size="18"
            class="text-primary"
            aria-hidden="true"
          />{{ health.data.value?.demo ? 'Demo · synthetic data' : 'Cloudflare Access' }}</span
        >
      </header>
      <main>
        <div
          v-if="health.data.value?.demo"
          role="status"
          class="alert alert-info alert-soft mb-6 text-sm"
        >
          Demo workspace · Realistic synthetic data. Read-only; no live registry calls. Restart pnpm
          run demo to reset.
        </div>
        <RouterView :key="$route.fullPath" />
      </main>
      <footer>
        <span class="flex items-center gap-2"
          ><img
            src="/brand/sourcemetric-mark-v2.svg"
            alt=""
            width="18"
            height="18"
            aria-hidden="true"
          />SourceMetric</span
        >
      </footer>
    </div>
  </div>
</template>
