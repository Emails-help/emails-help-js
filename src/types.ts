/**
 * The shapes this package returns.
 *
 * The one idea worth understanding before reading any of it: a result always
 * says HOW it was reached and HOW MUCH the provider actually committed to.
 * Every other library in this space returns a host and a port as though the
 * two were equally certain whether they came from a provider's own
 * documentation or from a guess about its MX records. They are not, and the
 * difference is the whole reason this exists.
 */

/**
 * How the transport is protected. `null` means nobody has stated it.
 *
 * Lowercase, because the emails.help dataset is the source of truth here and
 * that is how it spells them. Thunderbird's XML format uses `SSL` and
 * `STARTTLS`; those are normalised on the way in, so a caller never has to
 * branch on which lookup the answer came from.
 */
export type Security = 'ssl' | 'starttls' | 'none' | null;

/** Where an answer came from, in the order the resolver tries them. */
export type Method =
  /** The bundled emails.help dataset — values read off provider documentation. */
  | 'dataset'
  /** The domain's own autoconfig host, as Thunderbird would look it up. */
  | 'autoconfig'
  /** The domain's own `/.well-known/autoconfig/...` file. */
  | 'well-known'
  /** Mozilla's ISPDB. */
  | 'ispdb'
  /** Microsoft-style autodiscover. */
  | 'autodiscover'
  /** The domain's MX records matched against a known mail host. */
  | 'mx';

/**
 * How much weight the answer carries.
 *
 * - `documented`  the provider states these values itself
 * - `undocumented` the provider publishes the server but not every detail
 *   of it (see `undocumented` for which fields), so something is genuinely
 *   unstated rather than merely unknown to us
 * - `inferred`    nobody stated this for this domain; it was derived, and
 *   it may be wrong
 */
export type Confidence = 'documented' | 'undocumented' | 'inferred';

export interface Server {
  host: string;
  port: number | null;
  security: Security;
  /**
   * False when the provider publishes the server but never resolves its
   * encryption. Spectrum is the case that forced this flag into existence:
   * it documents "SSL: On" against outgoing port 587 and never says whether
   * that means STARTTLS or implicit TLS. Printing either one would be a
   * guess a reader could not tell from a fact.
   */
  securityDocumented: boolean;
}

export interface SmtpServer extends Server {
  /** A second port the provider publishes, where it publishes one. */
  alternative?: { port: number | null; security: Security };
}

export interface Resolution {
  /** Exactly what was passed in. */
  input: string;
  /** The domain it was reduced to. */
  domain: string;

  found: boolean;
  method: Method | null;
  confidence: Confidence | null;

  /** The provider's name, where the answer came from a source that names one. */
  provider: string | null;

  /**
   * False for providers that offer no IMAP or SMTP at all — Tuta, for one.
   * When this is false the absence of servers below is the answer, not a
   * hole in the data, and a client should stop rather than fall through to
   * guessing.
   */
  clientAccess: boolean;

  imap: Server | null;
  pop3: Server | null;
  smtp: SmtpServer | null;

  /** What to put in the username field, as the provider words it. */
  username: string | null;
  authentication: string | null;

  /** Field names the provider publishes a server for but never specifies. */
  undocumented: string[];
  notes: string[];

  /** First-party pages each value was read from. */
  sources: string[];
  /** A human-readable guide, where one exists. */
  guide: string | null;
  /** The date the values were last checked against their sources. */
  verified: string | null;

  /** When this resolution ran. */
  checkedAt: string;
  /** Every method tried, in order, with what it returned. Useful in a bug report. */
  trail: Array<{ method: Method; outcome: 'hit' | 'miss' | 'error'; detail?: string }>;
}

export interface ResolveOptions {
  /**
   * Which methods to try, in order. Defaults to every method.
   *
   * Pass `['dataset']` for a fully offline lookup that makes no network
   * calls at all. Drop `'mx'` if you would rather have no answer than an
   * inferred one.
   */
  methods?: Method[];
  /** Per-request timeout in milliseconds. Default 5000. */
  timeout?: number;
  /**
   * Fetch the dataset from emails.help instead of using the copy bundled
   * with this version. Off by default: a bundled copy cannot fail, and a
   * package that silently depends on someone's uptime is a bad package.
   */
  live?: boolean;
  /** Override the dataset endpoint. Mostly for tests. */
  endpoint?: string;
  /** Inject a fetch implementation. Mostly for tests. */
  fetch?: typeof globalThis.fetch;
}
