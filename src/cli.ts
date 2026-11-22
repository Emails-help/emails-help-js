#!/usr/bin/env node
import { resolve } from './resolve.ts';
import type { Method, Resolution, Server } from './types.ts';

/**
 * `npx emails-help someone@example.com`
 *
 * The CLI exists because it is the cheapest way for somebody to find out
 * whether this package is worth installing: one command, no project, no
 * install. It prints what was found AND how, because the second half is
 * the part other tools leave out.
 */

const USAGE = `
emails-help — look up IMAP and SMTP settings for an address or domain

  npx emails-help <address|domain> [options]

Options
  --json              Print the full result as JSON
  --offline           Use only the bundled dataset; make no network calls
  --live              Fetch the newest dataset from emails.help
  --no-infer          Never fall back to MX-based inference
  --timeout <ms>      Per-request timeout (default 5000)
  -h, --help          Show this

Examples
  npx emails-help posteo.de
  npx emails-help me@fastmail.com --json
  npx emails-help mycompany.com          # resolves custom domains via MX
`;

function flag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function value(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function line(label: string, server: Server | null): string {
  if (server === null) return `  ${label.padEnd(6)} —`;

  const security = server.security ?? 'not stated';
  const caveat = server.securityDocumented ? '' : '  (encryption not documented by the provider)';

  return `  ${label.padEnd(6)} ${server.host}:${server.port ?? '?'}  ${security}${caveat}`;
}

function print(result: Resolution): void {
  if (!result.found) {
    console.log(`\nNo settings found for ${result.domain}.\n`);
    console.log('Tried:');
    for (const step of result.trail) {
      console.log(`  ${step.method.padEnd(12)} ${step.outcome}${step.detail ? `  — ${step.detail}` : ''}`);
    }
    console.log('');
    return;
  }

  console.log(`\n${result.provider ?? result.domain}`);
  console.log(`  found via ${result.method} · confidence: ${result.confidence}`);

  if (!result.clientAccess) {
    console.log('\n  This provider offers no IMAP or SMTP access at all.');
    console.log('  That is the answer, not missing data — use its own app or bridge.\n');
    return;
  }

  console.log('');
  console.log(line('IMAP', result.imap));
  if (result.pop3 !== null) console.log(line('POP3', result.pop3));
  console.log(line('SMTP', result.smtp));

  if (result.smtp?.alternative !== undefined) {
    const alt = result.smtp.alternative;
    console.log(`  ${''.padEnd(6)} alternative port ${alt.port ?? '?'}  ${alt.security ?? 'not stated'}`);
  }

  if (result.username !== null) console.log(`\n  username   ${result.username}`);
  if (result.authentication !== null) console.log(`  auth       ${result.authentication}`);

  if (result.undocumented.length > 0) {
    console.log(`\n  Not documented by the provider: ${result.undocumented.join(', ')}`);
  }

  for (const note of result.notes) console.log(`\n  Note: ${note}`);

  if (result.sources.length > 0) {
    console.log('\n  Sources:');
    for (const source of result.sources) console.log(`    ${source}`);
  }

  if (result.guide !== null) console.log(`\n  Guide: ${result.guide}`);
  if (result.verified !== null) console.log(`  Last checked: ${result.verified}`);

  console.log('');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const target = argv.find((arg) => !arg.startsWith('-') && argv[argv.indexOf(arg) - 1] !== '--timeout');

  if (target === undefined || flag(argv, '-h') || flag(argv, '--help')) {
    console.log(USAGE);
    process.exit(target === undefined ? 1 : 0);
  }

  let methods: Method[] | undefined;
  if (flag(argv, '--offline')) methods = ['dataset'];
  else if (flag(argv, '--no-infer')) methods = ['dataset', 'autoconfig', 'well-known', 'ispdb'];

  const timeoutRaw = value(argv, '--timeout');

  const result = await resolve(target, {
    methods,
    live: flag(argv, '--live'),
    timeout: timeoutRaw === undefined ? undefined : Number.parseInt(timeoutRaw, 10),
  });

  if (flag(argv, '--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    print(result);
  }

  // A miss is not an error, but a script should be able to branch on it.
  process.exit(result.found ? 0 : 2);
}

main().catch((error: unknown) => {
  console.error(`emails-help: ${(error as Error).message}`);
  process.exit(1);
});
