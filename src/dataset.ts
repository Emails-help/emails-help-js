import { DATASET } from './data.generated.ts';
import type { Resolution, Security, Server, SmtpServer } from './types.ts';

/**
 * The emails.help dataset: one row per mail service, every value traceable
 * to the provider's own documentation.
 *
 * A copy is bundled with each release. `npm run sync` refreshes it before
 * publishing. Consumers who want the newest rows without waiting for a
 * release can pass `{ live: true }`, but the bundled copy is the default
 * because an offline lookup that cannot fail is worth more than a few weeks
 * of freshness.
 */

export interface DatasetServer {
  host: string;
  port: number | null;
  security: Security;
  security_documented: boolean;
}

export interface DatasetRow {
  slug: string;
  name: string;
  domains: string[];
  mx_patterns: string[];
  client_access: boolean;
  incoming?: { imap?: DatasetServer; pop3?: DatasetServer };
  outgoing?: {
    smtp?: DatasetServer & { alternative?: { port: number | null; security: Security } };
  };
  username?: string | null;
  authentication?: string | null;
  notes: string[];
  undocumented: string[];
  sources: string[];
  guide: string | null;
  verified: string | null;
}

export interface Dataset {
  version: number;
  generated_at: string;
  source: string;
  /** The dataset's own statement of what a null in it means. */
  about?: string;
  licence: string;
  count: number;
  providers: DatasetRow[];

  /**
   * The envelope accepts fields this package does not know about, so a new
   * key on the published dataset cannot break anyone's build. Rows are
   * deliberately NOT forgiving in the same way: a field appearing or
   * changing shape inside a provider row is exactly the drift the weekly
   * CI sync is there to catch.
   */
  [key: string]: unknown;
}

const DEFAULT_ENDPOINT = 'https://emails.help/api/email-providers.json';

/**
 * The copy shipped inside this package.
 *
 * It is compiled in as a module rather than read off disk. That costs a
 * little bundle size and buys three things: the package works unchanged in
 * a browser, a Worker or any edge runtime with no filesystem; there is no
 * path resolution to break between the ESM and CJS builds; and an offline
 * lookup has no failure mode at all.
 */
export function bundledDataset(): Dataset {
  return DATASET;
}

export async function liveDataset(
  endpoint: string = DEFAULT_ENDPOINT,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  timeout = 5000,
): Promise<Dataset> {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetchImpl(endpoint, { signal, headers: { accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`emails-help: dataset endpoint returned ${response.status}`);
  }

  return (await response.json()) as Dataset;
}

/**
 * Find the row for a domain.
 *
 * Two ways in. An exact match on an address domain is the common one. The
 * MX-suffix match is what makes a custom domain resolvable: a business on
 * Google Workspace has its own domain and Google's MX records, and the
 * second rule catches it where the first cannot.
 */
export function rowForDomain(dataset: Dataset, domain: string): DatasetRow | null {
  const needle = domain.toLowerCase().trim();
  if (needle === '') return null;

  for (const row of dataset.providers) {
    if (row.domains.some((known) => known.toLowerCase() === needle)) {
      return row;
    }
  }

  return null;
}

/** Find the row whose MX patterns match any of these MX hostnames. */
export function rowForMx(dataset: Dataset, mxHosts: string[]): DatasetRow | null {
  const hosts = mxHosts.map((host) => host.toLowerCase().replace(/\.$/, ''));

  for (const row of dataset.providers) {
    for (const pattern of row.mx_patterns) {
      const suffix = pattern.toLowerCase();
      if (suffix !== '' && hosts.some((host) => host === suffix || host.endsWith(`.${suffix}`))) {
        return row;
      }
    }
  }

  return null;
}

function toServer(server: DatasetServer | undefined): Server | null {
  if (server === undefined) return null;

  return {
    host: server.host,
    port: server.port,
    security: server.security,
    securityDocumented: server.security_documented,
  };
}

/** Turn a dataset row into a resolution. */
export function fromRow(row: DatasetRow): Omit<Resolution, 'input' | 'domain' | 'method' | 'checkedAt' | 'trail'> {
  const smtpRow = row.outgoing?.smtp;
  let smtp: SmtpServer | null = toServer(smtpRow);

  if (smtp !== null && smtpRow?.alternative !== undefined) {
    smtp = { ...smtp, alternative: smtpRow.alternative };
  }

  return {
    found: true,
    // A row that publishes a server but leaves a field unstated is a
    // weaker answer than one that states everything, and the caller
    // deserves to be able to tell them apart without reading the array.
    confidence: row.undocumented.length > 0 ? 'undocumented' : 'documented',
    provider: row.name,
    clientAccess: row.client_access,
    imap: toServer(row.incoming?.imap),
    pop3: toServer(row.incoming?.pop3),
    smtp,
    username: row.username ?? null,
    authentication: row.authentication ?? null,
    undocumented: row.undocumented,
    notes: row.notes,
    sources: row.sources,
    guide: row.guide,
    verified: row.verified,
  };
}
