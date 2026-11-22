import type { Security, Server, SmtpServer } from './types.ts';

/**
 * Thunderbird's client configuration format, and the places it is published.
 *
 * No XML dependency. The format is small, fixed and machine-generated, and
 * pulling a parser in to read six elements would be the only runtime
 * dependency in this package. The reader below is deliberately narrow: it
 * finds server blocks and the fields inside them, and ignores everything
 * else in the document.
 */

export interface ParsedConfig {
  provider: string | null;
  imap: Server | null;
  pop3: Server | null;
  smtp: SmtpServer | null;
  username: string | null;
}

/** The URLs a mail client tries, in the order Thunderbird tries them. */
export function autoconfigUrls(domain: string): Array<{ method: 'autoconfig' | 'well-known'; url: string }> {
  return [
    { method: 'autoconfig', url: `https://autoconfig.${domain}/mail/config-v1.1.xml` },
    { method: 'well-known', url: `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml` },
  ];
}

export function ispdbUrl(domain: string): string {
  return `https://autoconfig.thunderbird.net/v1.1/${domain}`;
}

function tagText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match === null ? null : match[1].trim();
}

/**
 * The XML format writes `SSL` and `STARTTLS`; the dataset writes `ssl` and
 * `starttls`. Normalising here means a caller never has to care which
 * lookup produced the answer.
 */
function toSecurity(raw: string | null): Security {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'SSL':
      return 'ssl';
    case 'STARTTLS':
      return 'starttls';
    case 'PLAIN':
    case 'NONE':
      return 'none';
    default:
      return null;
  }
}

function serverBlocks(xml: string, element: 'incomingServer' | 'outgoingServer'): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    blocks.push(match[0]);
  }

  return blocks;
}

function typeOf(block: string): string {
  return (/\btype\s*=\s*["']([^"']+)["']/i.exec(block)?.[1] ?? '').toLowerCase();
}

function toServer(block: string): Server | null {
  const host = tagText(block, 'hostname');
  if (host === null || host === '') return null;

  const port = tagText(block, 'port');

  return {
    host,
    port: port === null ? null : Number.parseInt(port, 10),
    security: toSecurity(tagText(block, 'socketType')),
    // A published autoconfig file states its socket type as a matter of
    // format. If the element is missing the file is simply incomplete, and
    // that is an unstated value exactly as a provider's silence is.
    securityDocumented: tagText(block, 'socketType') !== null,
  };
}

/**
 * Read a clientConfig document.
 *
 * Where a provider lists several servers of one type, the first is taken:
 * the format treats order as preference and Thunderbird does the same.
 */
export function parseClientConfig(xml: string): ParsedConfig | null {
  if (!/<clientConfig\b/i.test(xml)) return null;

  const incoming = serverBlocks(xml, 'incomingServer');
  const outgoing = serverBlocks(xml, 'outgoingServer');

  const imapBlock = incoming.find((block) => typeOf(block) === 'imap');
  const popBlock = incoming.find((block) => typeOf(block) === 'pop3');
  const smtpBlock = outgoing.find((block) => typeOf(block) === 'smtp') ?? outgoing[0];

  const imap = imapBlock === undefined ? null : toServer(imapBlock);
  const pop3 = popBlock === undefined ? null : toServer(popBlock);
  const smtp = smtpBlock === undefined ? null : toServer(smtpBlock);

  if (imap === null && pop3 === null && smtp === null) return null;

  const usernameBlock = imapBlock ?? popBlock ?? smtpBlock;

  return {
    provider: tagText(xml, 'displayName'),
    imap,
    pop3,
    smtp,
    username: usernameBlock === undefined ? null : tagText(usernameBlock, 'username'),
  };
}

/** Fetch a URL and read it as a clientConfig document. */
export async function fetchClientConfig(
  url: string,
  fetchImpl: typeof globalThis.fetch,
  timeout: number,
): Promise<ParsedConfig | null> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
    headers: { accept: 'application/xml, text/xml' },
  });

  if (!response.ok) return null;

  return parseClientConfig(await response.text());
}
