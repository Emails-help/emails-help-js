import { autoconfigUrls, fetchClientConfig, ispdbUrl, type ParsedConfig } from './autoconfig.ts';
import { bundledDataset, fromRow, liveDataset, rowForDomain, rowForMx, type Dataset } from './dataset.ts';
import { mxHosts } from './mx.ts';
import type { Method, Resolution, ResolveOptions } from './types.ts';

const ALL_METHODS: Method[] = ['dataset', 'autoconfig', 'well-known', 'ispdb', 'autodiscover', 'mx'];

/** Reduce an address or a URL-ish string to a bare domain. */
export function toDomain(input: string): string {
  let value = input.trim().toLowerCase();

  const at = value.lastIndexOf('@');
  if (at !== -1) value = value.slice(at + 1);

  value = value.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '');
  value = value.replace(/^\.+|\.+$/g, '');

  // A trailing port, and the brackets an IPv6 literal arrives in.
  value = value.replace(/^\[|\]$/g, '').replace(/:\d+$/, '');

  return value;
}

function empty(input: string, domain: string): Resolution {
  return {
    input,
    domain,
    found: false,
    method: null,
    confidence: null,
    provider: null,
    clientAccess: true,
    imap: null,
    pop3: null,
    smtp: null,
    username: null,
    authentication: null,
    undocumented: [],
    notes: [],
    sources: [],
    guide: null,
    verified: null,
    checkedAt: new Date().toISOString(),
    trail: [],
  };
}

function applyConfig(result: Resolution, config: ParsedConfig, method: Method, source: string): Resolution {
  return {
    ...result,
    found: true,
    method,
    // A config file published by the domain itself, or by Mozilla on its
    // behalf, is the operator stating the values. That is documentation.
    confidence: 'documented',
    provider: config.provider,
    imap: config.imap,
    pop3: config.pop3,
    smtp: config.smtp,
    username: config.username,
    sources: [source],
  };
}

/**
 * Resolve the mail settings for an address or a domain.
 *
 * Methods are tried in order and the first hit wins. The order is not
 * arbitrary: a value the provider documents beats a value a third party
 * holds, which beats a value nothing states at all. The last method, `mx`,
 * returns `confidence: 'inferred'` — it has matched the domain's mail host
 * to a known provider and is handing back that provider's settings, which
 * is usually right and is never stated.
 */
export async function resolve(input: string, options: ResolveOptions = {}): Promise<Resolution> {
  const {
    methods = ALL_METHODS,
    timeout = 5000,
    live = false,
    endpoint,
    fetch: fetchImpl = globalThis.fetch,
  } = options;

  const domain = toDomain(input);
  let result = empty(input, domain);

  if (domain === '' || !domain.includes('.')) {
    return result;
  }

  let dataset: Dataset | null = null;
  const needsDataset = methods.includes('dataset') || methods.includes('mx');

  if (needsDataset) {
    if (live) {
      try {
        dataset = await liveDataset(endpoint, fetchImpl, timeout);
      } catch (error) {
        // A live fetch that fails falls back to the bundled copy rather
        // than taking the whole resolution down with it.
        dataset = bundledDataset();
        result.trail.push({ method: 'dataset', outcome: 'error', detail: (error as Error).message });
      }
    } else {
      dataset = bundledDataset();
    }
  }

  for (const method of methods) {
    try {
      if (method === 'dataset') {
        const row = dataset === null ? null : rowForDomain(dataset, domain);

        if (row !== null) {
          result.trail.push({ method, outcome: 'hit' });
          return { ...result, ...fromRow(row), method };
        }

        result.trail.push({ method, outcome: 'miss' });
        continue;
      }

      if (method === 'autoconfig' || method === 'well-known') {
        const target = autoconfigUrls(domain).find((entry) => entry.method === method);
        if (target === undefined) continue;

        const config = await fetchClientConfig(target.url, fetchImpl, timeout);

        if (config !== null) {
          result.trail.push({ method, outcome: 'hit' });
          return applyConfig(result, config, method, target.url);
        }

        result.trail.push({ method, outcome: 'miss' });
        continue;
      }

      if (method === 'ispdb') {
        const url = ispdbUrl(domain);
        const config = await fetchClientConfig(url, fetchImpl, timeout);

        if (config !== null) {
          result.trail.push({ method, outcome: 'hit' });
          return applyConfig(result, config, method, url);
        }

        result.trail.push({ method, outcome: 'miss' });
        continue;
      }

      if (method === 'autodiscover') {
        // Microsoft's POX autodiscover needs a POST with an email address
        // and is answered by a different schema. Deliberately not guessed
        // at here: a wrong implementation that sometimes returns something
        // is worse than one that honestly reports it did not look.
        result.trail.push({ method, outcome: 'miss', detail: 'not implemented' });
        continue;
      }

      if (method === 'mx') {
        const hosts = await mxHosts(domain, timeout);

        if (hosts === null) {
          result.trail.push({ method, outcome: 'error', detail: 'MX lookup failed' });
          continue;
        }

        const row = dataset === null ? null : rowForMx(dataset, hosts);

        if (row !== null) {
          result.trail.push({ method, outcome: 'hit', detail: hosts[0] });

          return {
            ...result,
            ...fromRow(row),
            method,
            // The provider documents these values. Nobody documents that
            // THIS domain uses that provider — the MX records only make it
            // very likely. That gap is what `inferred` records.
            confidence: 'inferred',
            notes: [
              ...fromRow(row).notes,
              `Matched by MX record (${hosts[0]}). The provider documents these settings; that this domain uses the provider is inferred, not stated.`,
            ],
          };
        }

        result.trail.push({ method, outcome: 'miss', detail: hosts[0] ?? 'no MX records' });
      }
    } catch (error) {
      result.trail.push({ method, outcome: 'error', detail: (error as Error).message });
    }
  }

  return result;
}
