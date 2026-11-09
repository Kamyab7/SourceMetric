<script setup lang="ts">
import {
  Activity,
  Boxes,
  FolderKanban,
  Megaphone,
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  ChevronRight,
} from '@lucide/vue';
import { useProjects } from '../features/projects/queries';
const projects = useProjects();
const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/packages', label: 'Packages', icon: Boxes },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/annotations', label: 'Releases & campaigns', icon: Megaphone },
  { to: '/sync', label: 'Collection health', icon: Activity },
];
</script>
<template>
  <div class="shell">
    <aside>
      <RouterLink to="/" class="brand" aria-label="SourceMetric home">
        <img
          src="/brand/sourcemetric-wordmark.svg"
          alt="SourceMetric"
          width="200"
          height="41"
          class="w-full h-auto"
        />
      </RouterLink>
      <p class="workspace-label">WORKSPACE / CONTROL CENTER</p>
      <nav class="menu w-full p-0 gap-1" aria-label="Main navigation">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          exact-active-class="selected"
          :aria-label="item.label"
          ><component :is="item.icon" :size="18" :stroke-width="1.6" aria-hidden="true" /><span>{{
            item.label
          }}</span></RouterLink
        >
      </nav>
      <p class="workspace-label">YOUR PROJECTS</p>
      <nav class="menu w-full p-0" aria-label="Projects">
        <RouterLink
          v-for="p in projects.data.value?.items.filter((p) => !p.archived)"
          :key="p.id"
          :to="'/projects/' + p.id"
          ><span class="project-dot" />{{ p.name
          }}<ChevronRight :size="13" class="ml-auto" aria-hidden="true"
        /></RouterLink>
      </nav>
      <div class="sidebar-footer">
        <div class="flex items-center gap-2">
          <span class="status status-success" /> Private workspace
        </div>
        <p>Self-hosted. Your data stays yours.</p>
        <a class="flex items-center gap-2" href="/cdn-cgi/access/logout"
          ><LogOut :size="14" aria-hidden="true" />Sign out</a
        >
      </div>
    </aside>
    <div class="main">
      <header>
        <span class="flex items-center gap-3"
          ><span class="text-primary">Workspace</span
          ><ChevronRight :size="12" aria-hidden="true" /><span class="muted"
            >NuGet insights</span
          ></span
        ><span class="badge badge-outline gap-2"
          ><ShieldCheck :size="13" aria-hidden="true" />Cloudflare Access</span
        >
      </header>
      <main><RouterView :key="$route.fullPath" /></main>
      <footer>
        <span class="flex items-center gap-2"
          ><img
            src="/brand/sourcemetric-mark.svg"
            alt=""
            width="18"
            height="18"
            aria-hidden="true"
          />SourceMetric</span
        ><span>OPEN SOURCE INTELLIGENCE · UTC</span>
      </footer>
    </div>
  </div>
</template>
