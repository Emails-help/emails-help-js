import assert from 'node:assert/strict';
import { test } from 'node:test';

// Tests run against the built package rather than the TypeScript source.
// That means no experimental flags, the suite runs on every Node version
// the package claims to support, and what is tested is what ships.
import { fromRow, parseClientConfig, resolve, rowForDomain, rowForMx, toDomain } from '../dist/index.js';

const spectrum = {
  slug: 'spectrum',
  name: 'Spectrum',
  domains: ['charter.net', 'spectrum.net'],
  mx_patterns: ['charter.net'],
  client_access: true,
  incoming: { imap: { host: 'mobile.charter.net', port: 993, security: 'ssl', security_documented: true } },
  outgoing: { smtp: { host: 'mobile.charter.net', port: 587, security: null, security_documented: false } },
  username: 'Your full email address',
  authentication: 'Normal password',
  notes: [],
  // The case the whole confidence model exists for.
  undocumented: ['smtp_security'],
  sources: ['https://www.spectrum.net/support/internet/email-server-settings'],
  guide: 'https://emails.help/spectrum/email-settings',
  verified: '2026-11-18',
};

const tuta = {
  slug: 'tuta',
  name: 'Tuta',
  domains: ['tuta.com', 'tutanota.com'],
  mx_patterns: ['tutanota.de'],
  client_access: false,
  notes: ['Tuta encrypts mailboxes end to end and offers no IMAP or SMTP access.'],
  undocumented: [],
  sources: ['https://tuta.com/support'],
  guide: 'https://emails.help/tuta',
  verified: '2026-11-18',
};

const gmail = {
  slug: 'gmail',
  name: 'Gmail',
  domains: ['gmail.com', 'googlemail.com'],
  mx_patterns: ['google.com', 'googlemail.com'],
  client_access: true,
  incoming: { imap: { host: 'imap.gmail.com', port: 993, security: 'ssl', security_documented: true } },
  outgoing: { smtp: { host: 'smtp.gmail.com', port: 465, security: 'ssl', security_documented: true } },
  username: 'Your full email address',
  authentication: 'OAuth or an app password',
  notes: [],
  undocumented: [],
  sources: ['https://support.google.com/mail/answer/7126229'],
  guide: 'https://emails.help/gmail/imap-settings',
  verified: '2026-11-18',
};

const dataset = {
  version: 1,
  generated_at: '2026-11-22T00:00:00+00:00',
  source: 'https://emails.help',
  licence: 'CC BY 4.0',
  count: 3,
  providers: [spectrum, tuta, gmail],
};

test('toDomain reduces addresses, URLs and ports to a bare domain', () => {
  assert.equal(toDomain('Someone@Example.COM'), 'example.com');
  assert.equal(toDomain('example.com'), 'example.com');
  assert.equal(toDomain('https://example.com/path?q=1'), 'example.com');
  assert.equal(toDomain('example.com:993'), 'example.com');
  assert.equal(toDomain('  first.last+tag@mail.example.co.uk '), 'mail.example.co.uk');
  // An address containing more than one @ keeps the last one.
  assert.equal(toDomain('"odd@name"@example.com'), 'example.com');
});

test('a row the provider fully documents comes back as documented', () => {
  const row = rowForDomain(dataset, 'gmail.com');
  assert.notEqual(row, null);

  const result = fromRow(row);
  assert.equal(result.confidence, 'documented');
  assert.equal(result.imap.host, 'imap.gmail.com');
  assert.equal(result.imap.security, 'ssl');
});

test('a row with an unstated field comes back as undocumented, not as a guess', () => {
  const result = fromRow(rowForDomain(dataset, 'charter.net'));

  assert.equal(result.confidence, 'undocumented');
  assert.deepEqual(result.undocumented, ['smtp_security']);
  // The port is published, the encryption is not. Neither is invented.
  assert.equal(result.smtp.port, 587);
  assert.equal(result.smtp.security, null);
  assert.equal(result.smtp.securityDocumented, false);
});

test('a provider with no client access says so rather than returning nothing', () => {
  const result = fromRow(rowForDomain(dataset, 'tuta.com'));

  assert.equal(result.clientAccess, false);
  assert.equal(result.imap, null);
  // The absence above is the answer, and the note is what makes it one.
  assert.match(result.notes.join(' '), /no IMAP or SMTP/i);
});

test('MX matching resolves a custom domain to its mail host', () => {
  assert.equal(rowForMx(dataset, ['aspmx.l.google.com']).slug, 'gmail');
  assert.equal(rowForMx(dataset, ['alt1.aspmx.l.google.com']).slug, 'gmail');
  // A host that merely ends in the same letters is not a suffix match.
  assert.equal(rowForMx(dataset, ['mx.notgoogle.com']), null);
  assert.equal(rowForMx(dataset, []), null);
});

test('parseClientConfig reads a Thunderbird config document', () => {
  const xml = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="emails.help">
    <domain>emails.help</domain>
    <displayName>Emails.help</displayName>
    <incomingServer type="imap">
      <hostname>server275.web-hosting.com</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>server275.web-hosting.com</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

  const parsed = parseClientConfig(xml);

  assert.equal(parsed.provider, 'Emails.help');
  assert.equal(parsed.imap.host, 'server275.web-hosting.com');
  assert.equal(parsed.imap.port, 993);
  // The XML says SSL; the library normalises every source to one spelling.
  assert.equal(parsed.imap.security, 'ssl');
  assert.equal(parsed.smtp.port, 465);
  assert.equal(parsed.username, '%EMAILADDRESS%');
});

test('STARTTLS in a config document normalises to the dataset spelling', () => {
  const xml = `<clientConfig version="1.1"><emailProvider id="x">
      <incomingServer type="imap"><hostname>imap.example.com</hostname><port>143</port>
        <socketType>STARTTLS</socketType></incomingServer>
    </emailProvider></clientConfig>`;

  assert.equal(parseClientConfig(xml).imap.security, 'starttls');
});

test('parseClientConfig rejects documents that are not a client config', () => {
  assert.equal(parseClientConfig('<html><body>Not found</body></html>'), null);
  assert.equal(parseClientConfig('<clientConfig version="1.1"></clientConfig>'), null);
});

test('a live autoconfig file is used and recorded as its own source', async () => {
  const xml = `<clientConfig version="1.1"><emailProvider id="x">
      <displayName>Example Mail</displayName>
      <incomingServer type="imap"><hostname>imap.example.com</hostname><port>993</port>
        <socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
      <outgoingServer type="smtp"><hostname>smtp.example.com</hostname><port>465</port>
        <socketType>SSL</socketType><username>%EMAILADDRESS%</username></outgoingServer>
    </emailProvider></clientConfig>`;

  const fetchImpl = async (url) =>
    String(url).includes('autoconfig.example.com')
      ? new Response(xml, { status: 200 })
      : new Response('', { status: 404 });

  const result = await resolve('user@example.com', { methods: ['autoconfig'], fetch: fetchImpl });

  assert.equal(result.found, true);
  assert.equal(result.method, 'autoconfig');
  assert.equal(result.confidence, 'documented');
  assert.equal(result.provider, 'Example Mail');
  assert.equal(result.imap.host, 'imap.example.com');
  assert.deepEqual(result.sources, ['https://autoconfig.example.com/mail/config-v1.1.xml']);
});

test('a miss returns found:false with a trail of what was tried', async () => {
  const fetchImpl = async () => new Response('', { status: 404 });

  const result = await resolve('nobody@example.invalid', {
    methods: ['autoconfig', 'well-known', 'ispdb'],
    fetch: fetchImpl,
    timeout: 1000,
  });

  assert.equal(result.found, false);
  assert.equal(result.method, null);
  assert.deepEqual(
    result.trail.map((step) => step.method),
    ['autoconfig', 'well-known', 'ispdb'],
  );
  assert.ok(result.trail.every((step) => step.outcome === 'miss'));
});

test('garbage input is rejected without any network call', async () => {
  const fetchImpl = () => {
    throw new Error('should not be called');
  };

  for (const input of ['', '   ', 'notadomain', '@', 'user@']) {
    const result = await resolve(input, { fetch: fetchImpl });
    assert.equal(result.found, false, `expected a miss for ${JSON.stringify(input)}`);
  }
});

test('the bundled dataset ships real rows, not the placeholder', async () => {
  // A release whose sync step was skipped would pass every test above and
  // still be useless. This is the one that catches it.
  const { bundledDataset } = await import('../dist/index.js');
  const bundled = bundledDataset();

  assert.ok(bundled.providers.length > 0, 'bundled dataset is empty — run `npm run sync`');
  assert.notEqual(bundled.generated_at, '1970-01-01T00:00:00+00:00');

  for (const row of bundled.providers) {
    assert.equal(typeof row.slug, 'string');
    assert.equal(typeof row.name, 'string');
    assert.ok(Array.isArray(row.domains));
    // Every published value has to be checkable, which is the whole premise.
    assert.ok(Array.isArray(row.sources));
  }
});
