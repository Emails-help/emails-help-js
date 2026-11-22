# emails-help

Resolve IMAP and SMTP settings for any email address or domain — and find out **how certain the answer actually is**.

[![npm](https://img.shields.io/npm/v/emails-help.svg)](https://www.npmjs.com/package/emails-help)
[![license](https://img.shields.io/npm/l/emails-help.svg)](./LICENSE)

```bash
npx emails-help someone@fastmail.com
```

Zero runtime dependencies. Node 18+. Works in browsers and edge runtimes too (everything except the MX step).

---

## Why another one of these

Every library in this space returns a host and a port as though the two were equally certain, whether they came from the provider's own documentation or from a guess about its MX records. They are not the same thing, and the difference is the one that bites.

Spectrum is the case worth knowing. Its support article publishes outgoing port 587 with "SSL: On", and never says whether that means STARTTLS or implicit TLS. Every tool that prints a value for it is printing a guess the reader cannot tell apart from a fact. This one returns:

```js
smtp: {
  host: 'mobile.charter.net',
  port: 587,
  security: null,              // nobody stated it
  securityDocumented: false    // and that absence is the answer
}
```

So every result carries two extra fields nothing else gives you:

| Field | What it tells you |
|---|---|
| `method` | `dataset`, `autoconfig`, `well-known`, `ispdb`, or `mx` — where the answer came from |
| `confidence` | `documented`, `undocumented`, or `inferred` |

`inferred` is the one to watch. It means the MX records matched a known provider and you are being handed that provider's settings. Usually right. Never stated.

## Install

```bash
npm install emails-help
```

## Use

```js
import { resolve } from 'emails-help';

const result = await resolve('someone@fastmail.com');

if (result.found) {
  console.log(result.imap);   // { host, port, security, securityDocumented }
  console.log(result.smtp);
  console.log(result.method, result.confidence);
  console.log(result.sources); // the pages each value was read from
}
```

### Custom domains

A business on Google Workspace has its own domain and Google's MX records. The `mx` method catches it:

```js
const result = await resolve('finance@somecompany.com');
// method: 'mx', confidence: 'inferred'
// notes: ['Matched by MX record (aspmx.l.google.com). The provider documents
//          these settings; that this domain uses the provider is inferred,
//          not stated.']
```

### Offline

The dataset is compiled into the package, so this makes no network calls at all:

```js
const result = await resolve('gmail.com', { methods: ['dataset'] });
```

### Providers with no IMAP or SMTP

Tuta encrypts mailboxes end to end and offers no client access. That is an answer, not missing data:

```js
const result = await resolve('me@tuta.com');
result.found;        // true
result.clientAccess; // false
result.imap;         // null
```

Check `clientAccess` before you fall through to a guess. If it is `false`, stop.

## Options

```js
await resolve(input, {
  methods: ['dataset', 'autoconfig', 'well-known', 'ispdb', 'mx'],
  timeout: 5000,   // per request, ms
  live: false,     // fetch the newest dataset instead of the bundled copy
});
```

Methods are tried in order and the first hit wins. Drop `'mx'` if you would rather have no answer than an inferred one.

## Result

```ts
interface Resolution {
  input: string;
  domain: string;

  found: boolean;
  method: 'dataset' | 'autoconfig' | 'well-known' | 'ispdb' | 'autodiscover' | 'mx' | null;
  confidence: 'documented' | 'undocumented' | 'inferred' | null;

  provider: string | null;
  clientAccess: boolean;

  imap: Server | null;
  pop3: Server | null;
  smtp: SmtpServer | null;

  username: string | null;
  authentication: string | null;

  undocumented: string[];   // fields the provider publishes a server for but never specifies
  notes: string[];
  sources: string[];        // first-party pages the values were read from
  guide: string | null;
  verified: string | null;  // date the values were last checked

  checkedAt: string;
  trail: Array<{ method: Method; outcome: 'hit' | 'miss' | 'error'; detail?: string }>;
}
```

`trail` records every method tried and what it returned. Paste it into a bug report.

## CLI

```
npx emails-help <address|domain> [options]

  --json          Print the full result as JSON
  --offline       Use only the bundled dataset; make no network calls
  --live          Fetch the newest dataset from emails.help
  --no-infer      Never fall back to MX-based inference
  --timeout <ms>  Per-request timeout (default 5000)
```

Exit code `0` on a hit, `2` on a miss, `1` on an error — so a script can branch on it.

## Where the data comes from

The bundled dataset is [emails.help](https://emails.help), where every value is read off the provider's own documentation and carries the page it came from and the date it was last checked. You can fetch it directly:

```
https://emails.help/api/email-providers.json
https://emails.help/api/email-providers.json?domain=posteo.de
```

Licensed CC BY 4.0. The browsable version is at <https://emails.help/email-settings-dataset>.

Where the dataset has no row, the package falls back to the same lookups a mail client performs: the domain's own autoconfig file, Mozilla's ISPDB, then MX inference.

## Contributing a provider

Wrong or missing settings are a dataset problem, not a code problem. Open an issue on [emails.help](https://emails.help) with the provider's own documentation page and it gets checked against the source. Corrections ship in the next release.

## Licence

MIT for the code. The bundled dataset is CC BY 4.0, attributed to [emails.help](https://emails.help).
