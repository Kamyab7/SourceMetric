// Optional deployment secret; intentionally absent from committed Wrangler vars.
interface Env {
  GITHUB_TOKEN?: string;
  CLOUDFLARE_ANALYTICS_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKER_NAME?: string;
  CLOUDFLARE_D1_DATABASE_ID?: string;
  CLOUDFLARE_KV_NAMESPACE_ID?: string;
}
