<script setup lang="ts">
import { useProjects } from '../features/projects/queries';
const projects = useProjects();
</script>
<template>
  <div class="shell">
    <aside>
      <RouterLink to="/" class="brand"
        ><span class="brand-icon">S<span>↗</span></span
        >SourceMetric</RouterLink
      >
      <p class="workspace-label">MAINTAINER WORKSPACE</p>
      <nav>
        <RouterLink to="/" exact-active-class="selected">◫ <span>Overview</span></RouterLink
        ><RouterLink to="/packages">⬡ <span>Packages</span></RouterLink
        ><RouterLink to="/projects">▤ <span>Projects</span></RouterLink
        ><RouterLink to="/annotations">✎ <span>Releases & campaigns</span></RouterLink
        ><RouterLink to="/sync">↻ <span>Collection health</span></RouterLink>
      </nav>
      <p class="workspace-label">YOUR PROJECTS</p>
      <nav>
        <RouterLink
          v-for="p in projects.data.value?.items.filter((p) => !p.archived)"
          :key="p.id"
          :to="'/projects/' + p.id"
          ><span class="project-dot" /> {{ p.name }}</RouterLink
        >
      </nav>
      <div class="sidebar-footer">
        <span class="live-dot" /> Private workspace
        <p>Self-hosted. Your data stays yours.</p>
        <a href="/cdn-cgi/access/logout">Sign out ↗</a>
      </div>
    </aside>
    <div class="main">
      <header>
        <span>Workspace <span class="muted">/ NuGet insights</span></span
        ><span class="badge">● Cloudflare Access</span>
      </header>
      <main><RouterView :key="$route.fullPath" /></main>
      <footer>SourceMetric <span>Built for the people building open source. · UTC</span></footer>
    </div>
  </div>
</template>
