// Deterministic synthetic NuGet data; no network or Cloudflare account required.
export const demoIds = {
  projects: [1, 2, 3].map((n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0')),
  packages: [1, 2, 3, 4, 5, 6].map((n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0')),
};
const DAY = 86400000,
  HOUR = 3600000;
const sqlValue = (value) =>
  value == null
    ? 'NULL'
    : typeof value === 'number'
      ? String(value)
      : "'" + String(value).replaceAll("'", "''") + "'";
export function createDemoFixture(now = new Date()) {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 210 * DAY);
  const at = (hours) => new Date(start.getTime() + hours * HOUR).toISOString();
  const tables = new Map();
  function row(table, columns, values) {
    if (!tables.has(table)) tables.set(table, { columns: [], rows: [] });
    const data = tables.get(table);
    for (const column of columns) if (!data.columns.includes(column)) data.columns.push(column);
    data.rows.push(Object.fromEntries(columns.map((column, i) => [column, values[i]])));
  }
  const projectNames = ['Nebula Platform', 'Pulse Observability', 'Orbit Developer Tools'];
  projectNames.forEach((name, n) =>
    row('projects', ['id', 'name', 'created_at'], [demoIds.projects[n], name, at(0)]),
  );
  const names = [
    'Nebula.Core',
    'Nebula.Http',
    'Pulse.Logging',
    'Pulse.Telemetry',
    'Orbit.Testing',
    'Orbit.Assertions',
  ];
  const descriptions = [
    'Composable primitives for modern .NET applications.',
    'Resilient HTTP clients with retries, policies, and observability.',
    'Structured logging built for distributed services.',
    'Lightweight metrics and tracing for production .NET workloads.',
    'Fast, expressive integration testing for developer teams.',
    'Readable assertions with detailed failure diagnostics.',
  ];
  let randomState = 42;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const slots = 210 * 4 + Math.floor((now.getTime() - end.getTime()) / (6 * HOUR));
  names.forEach((name, n) => {
    const id = demoIds.packages[n],
      base = [240000, 92000, 175000, 46000, 115000, 23000][n];
    const counts = [Math.round(base * 0.8), Math.round(base * 0.2), 0];
    const versions = ['1.8.0', '2.0.0', '2.1.0-preview.1'];
    const releaseSlot = 165 * 4,
      previewSlot = 195 * 4;
    versions.forEach((version, v) =>
      row(
        'package_versions',
        ['package_id', 'version', 'prerelease', 'first_seen'],
        [id, version, v === 2 ? 1 : 0, at(v === 0 ? 0 : (v === 1 ? releaseSlot : previewSlot) * 6)],
      ),
    );
    let lastSuccess = at(0);
    for (let slot = 0; slot <= slots; slot++) {
      const day = slot / 4;
      // Older irregularities remain visible through a custom/90-day historical view.
      if (n === 5 && slot >= 320 && slot <= 322) continue;
      const weekday = new Date(at(slot * 6)).getUTCDay(),
        weekend = weekday === 0 || weekday === 6 ? 0.62 : 1;
      const campaign = day > 206 && day < 209 ? 2.6 : day > 188 && day < 191 ? 1.8 : 1;
      const increment = Math.round(
        (24 + n * 13) * (1 + day / 140) * weekend * campaign * (0.75 + random() * 0.5),
      );
      if (slot > 0) {
        const modern = slot >= releaseSlot ? 0.7 : 0,
          preview = slot >= previewSlot ? 0.09 : 0;
        counts[0] += Math.round(increment * (1 - modern - preview));
        counts[1] += Math.round(increment * modern);
        counts[2] += Math.round(increment * preview);
        if (n === 5 && slot === 400) counts[0] -= 1500;
      }
      const timestamp = at(slot * 6),
        collection = 'demo-' + n + '-' + slot;
      const addObservation = (scope, version, value) =>
        row(
          'observations',
          [
            'package_id',
            'metric',
            'scope',
            'version',
            'kind',
            'value',
            'observed_at',
            'availability',
            'quality',
            'collection_id',
          ],
          [
            id,
            'downloads',
            scope,
            version,
            'cumulative',
            value,
            timestamp,
            'available',
            'source',
            collection,
          ],
        );
      addObservation(
        'package',
        '',
        counts.reduce((a, b) => a + b, 0),
      );
      counts.forEach((value, v) => {
        if (v === 0 || (v === 1 && slot >= releaseSlot) || (v === 2 && slot >= previewSlot))
          addObservation('version', versions[v], value);
      });
      lastSuccess = timestamp;
    }
    row(
      'packages',
      [
        'id',
        'provider',
        'canonical_id',
        'display_name',
        'description',
        'latest_stable',
        'latest_prerelease',
        'created_at',
        'last_success',
      ],
      [
        id,
        'nuget',
        name.toLowerCase(),
        name,
        descriptions[n],
        '2.0.0',
        '2.1.0-preview.1',
        at(0),
        lastSuccess,
      ],
    );
    const failed = n === 5,
      attempt = failed ? new Date(now.getTime() - 30 * 60000).toISOString() : lastSuccess;
    row(
      'collection_jobs',
      ['package_id', 'next_attempt', 'last_attempt', 'last_error', 'failures', 'status'],
      [
        id,
        new Date(Date.parse(lastSuccess) + 6 * HOUR).toISOString(),
        attempt,
        failed ? 'RATE_LIMITED' : null,
        failed ? 1 : 0,
        failed ? 'failed' : 'success',
      ],
    );
    row(
      'project_packages',
      ['project_id', 'package_id'],
      [demoIds.projects[Math.floor(n / 2)], id],
    );
    for (let j = 0; j < 8; j++) {
      const when = new Date(Date.parse(lastSuccess) - j * 6 * HOUR).toISOString();
      row(
        'sync_attempts',
        ['id', 'package_id', 'started_at', 'finished_at', 'status', 'error'],
        [
          'demo-attempt-' + n + '-' + j,
          id,
          j === 0 ? attempt : when,
          j === 0 ? attempt : when,
          failed && j === 0 ? 'failed' : 'success',
          failed && j === 0 ? 'RATE_LIMITED' : null,
        ],
      );
    }
    [releaseSlot, previewSlot].forEach((slot, v) =>
      row(
        'annotations',
        ['id', 'package_id', 'kind', 'title', 'body', 'occurred_at', 'automatic'],
        [
          '30000000-0000-4000-8000-' + String(n * 10 + v + 1).padStart(12, '0'),
          id,
          'release',
          versions[v + 1] + ' released',
          'Synthetic release event: explore how adoption shifts between package versions.',
          at(slot * 6),
          0,
        ],
      ),
    );
  });
  row('project_packages', ['project_id', 'package_id'], [demoIds.projects[2], demoIds.packages[0]]);
  const campaigns = [
    [
      0,
      207,
      'Launch week: developer newsletter',
      'A tutorial and code sample drove a sustained increase in package discovery.',
    ],
    [1, 189, 'Community spotlight', 'Featured in a community roundup about observability tooling.'],
    [
      2,
      204,
      'Integration testing workshop',
      'Shared examples and migration recipes during a live workshop.',
    ],
    [0, 202, 'HTTP resilience guide', 'Published a practical guide with runnable code samples.'],
  ];
  campaigns.forEach(([project, day, title, body], n) =>
    row(
      'annotations',
      ['id', 'project_id', 'kind', 'title', 'body', 'occurred_at', 'automatic'],
      [
        '40000000-0000-4000-8000-' + String(n + 1).padStart(12, '0'),
        demoIds.projects[project],
        'campaign',
        title,
        body,
        at(day * 24),
        0,
      ],
    ),
  );
  // Foreign-key-safe import order. Only the dedicated demo database is reset.
  const sql = ['DELETE FROM projects;', 'DELETE FROM packages;'];
  for (const table of [
    'projects',
    'packages',
    'project_packages',
    'collection_jobs',
    'package_versions',
    'sync_attempts',
    'observations',
    'annotations',
  ]) {
    const data = tables.get(table);
    for (let i = 0; i < data.rows.length; i += 150)
      sql.push(
        'INSERT INTO ' +
          table +
          '(' +
          data.columns.join(',') +
          ') VALUES ' +
          data.rows
            .slice(i, i + 150)
            .map(
              (values) =>
                '(' + data.columns.map((column) => sqlValue(values[column])).join(',') + ')',
            )
            .join(',') +
          ';',
      );
  }
  return {
    sql: sql.join('\n'),
    counts: Object.fromEntries([...tables].map(([key, data]) => [key, data.rows.length])),
  };
}
