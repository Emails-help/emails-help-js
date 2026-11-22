export { resolve, toDomain } from './resolve.ts';
export { bundledDataset, liveDataset, rowForDomain, rowForMx, fromRow } from './dataset.ts';
export { parseClientConfig, autoconfigUrls, ispdbUrl } from './autoconfig.ts';
export { mxHosts } from './mx.ts';

export type { Dataset, DatasetRow, DatasetServer } from './dataset.ts';
export type { ParsedConfig } from './autoconfig.ts';
export type { Confidence, Method, Resolution, ResolveOptions, Security, Server, SmtpServer } from './types.ts';
