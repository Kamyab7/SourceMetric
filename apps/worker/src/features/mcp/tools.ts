import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  idSchema,
  paginationSchema,
  rangeSchema,
  repositoryRangeSchema,
  trafficMetricSchema,
} from '@sourcemetric/contracts';
import { listProjects } from '../projects/repository';
import { listPackages } from '../packages/repository';
import { listRepositories } from '../repositories/repository';
import { getMetrics } from '../metrics/use-cases';
import { pagedVersions } from '../metrics/repository';
import { repositoryMetrics } from '../repositories/metrics';
import { listTraffic, trafficHistory, trafficSnapshot } from '../repositories/traffic';
import { AppError } from '../../platform/errors';

export function toolResult(data: unknown): CallToolResult {
  const structuredContent = data as Record<string, unknown>;
  const result = {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024 - 1024)
    throw new AppError(
      400,
      'RESULT_TOO_LARGE',
      'Result exceeds 1 MiB. Narrow the date range or filters, or reduce the page size.',
    );
  return result;
}

export function createStatsServer(db: D1Database) {
  const server = new McpServer({ name: 'SourceMetric', version: '1.0.0' });
  function read(
    name: string,
    description: string,
    shape: z.ZodRawShape,
    query: (args: Record<string, unknown>) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          return toolResult(await query(args));
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  error instanceof AppError
                    ? `${error.code}: ${error.message}`
                    : error instanceof z.ZodError
                      ? 'INVALID_INPUT: ' + error.issues[0]?.message
                      : 'QUERY_FAILED: Statistics could not be read.',
              },
            ],
          };
        }
      },
    );
  }
  const page = paginationSchema.shape;
  const scopedPage = { ...page, projectId: idSchema.optional() };
  read(
    'list_projects',
    'List tracked projects, including archived projects. Paginated.',
    page,
    async (a) => {
      const p = paginationSchema.parse(a);
      return listProjects(db, p.limit, p.offset);
    },
  );
  read(
    'list_packages',
    'List tracked NuGet packages and collection freshness. Optionally filter by project.',
    scopedPage,
    async (a) => {
      const p = paginationSchema.parse(a);
      return listPackages(db, p.limit, p.offset, idSchema.optional().parse(a.projectId));
    },
  );
  read(
    'list_repositories',
    'List tracked GitHub repositories, including private repository names. Optionally filter by project.',
    scopedPage,
    async (a) => {
      const p = paginationSchema.parse(a);
      return listRepositories(db, p.limit, p.offset, idSchema.optional().parse(a.projectId));
    },
  );
  read(
    'get_package_metrics',
    'Read NuGet download totals, growth, history, quality, freshness and release/campaign context. UTC range required, at most 366 days. Missing data is not zero.',
    rangeSchema.shape,
    (a) => getMetrics(db, rangeSchema.parse(a)),
  );
  read(
    'list_package_versions',
    'Read paginated NuGet version downloads as of the range end, with stable/prerelease filtering.',
    { ...rangeSchema.shape, ...page },
    (a) => {
      const p = paginationSchema.parse(a);
      return pagedVersions(db, rangeSchema.parse(a), p.limit, p.offset);
    },
  );
  read(
    'get_repository_metrics',
    'Read stars, forks, clones and views, growth, history and completeness. Daily unique visitors cannot be added into period-unique visitors. UTC range required, at most 366 days.',
    repositoryRangeSchema.shape,
    (a) => repositoryMetrics(db, repositoryRangeSchema.parse(a)),
  );
  read(
    'list_repository_traffic',
    'Read latest available traffic snapshot summaries as of range end, with endpoint collection statuses. Pagination is by repository. Snapshots cover rolling 14-day windows, not the requested date interval.',
    { ...repositoryRangeSchema.shape, ...page },
    (a) => listTraffic(db, repositoryRangeSchema.parse(a), paginationSchema.parse(a)),
  );
  read(
    'list_traffic_history',
    'Read traffic snapshot history up to range end, including snapshots older than range start. Each snapshot represents a rolling 14-day window; overlapping snapshots must not be summed.',
    {
      ...repositoryRangeSchema.shape,
      ...page,
      repositoryId: idSchema,
      metric: trafficMetricSchema,
    },
    (a) =>
      trafficHistory(
        db,
        idSchema.parse(a.repositoryId),
        trafficMetricSchema.parse(a.metric),
        repositoryRangeSchema.parse(a),
        paginationSchema.parse(a),
      ),
  );
  read(
    'get_traffic_snapshot',
    'Read a stored 14-day traffic snapshot, including popular paths or referring sites. Missing counts remain null.',
    { id: idSchema },
    (a) => trafficSnapshot(db, idSchema.parse(a.id)),
  );
  return server;
}

export async function serveStats(request: Request, db: D1Database) {
  const server = createStatsServer(db);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 16384,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
