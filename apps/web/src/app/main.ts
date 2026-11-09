import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import App from './App.vue';
import './style.css';
const dashboard = () => import('../features/metrics/DashboardPage.vue');
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: dashboard },
    { path: '/projects/:projectId', component: dashboard },
    { path: '/packages/:packageId', component: dashboard },
    { path: '/projects', component: () => import('../features/projects/ProjectsPage.vue') },
    { path: '/packages', component: () => import('../features/packages/PackagesPage.vue') },
    {
      path: '/annotations',
      component: () => import('../features/annotations/AnnotationsPage.vue'),
    },
    { path: '/sync', component: () => import('../features/sync/SyncPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
});
createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount('#app');
