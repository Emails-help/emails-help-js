/**
 * MX lookup.
 *
 * The contract matters more than the code: `null` means the lookup failed
 * and we do not know, `[]` means the domain genuinely publishes no MX
 * records. A caller that collapses the two will tell someone their domain
 * cannot receive mail because a resolver timed out.
 *
 * `node:dns` is imported dynamically so that the rest of the package stays
 * usable in a browser or an edge runtime, where there is no resolver and
 * this one method simply reports that it could not look.
 */
export async function mxHosts(domain: string, timeout: number): Promise<string[] | null> {
  let resolveMx: (hostname: string) => Promise<Array<{ exchange: string; priority: number }>>;

  try {
    const dns = await import('node:dns');
    resolveMx = dns.promises.resolveMx;
  } catch {
    // No resolver in this runtime. Not an absence of records.
    return null;
  }

  try {
    const records = await withTimeout(resolveMx(domain), timeout);

    return records
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((record) => record.exchange.toLowerCase().replace(/\.$/, ''));
  } catch (error) {
    // ENODATA and NOTFOUND are answers: this domain has no MX records.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND') return [];

    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('dns timeout')), ms);
      // Do not hold the event loop open for a lookup nobody is waiting on.
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}
