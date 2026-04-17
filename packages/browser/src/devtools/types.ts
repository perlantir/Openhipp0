/**
 * Network inspector contracts. Callers observe XHR/fetch + document
 * loads, feed them to the inspector, then export a HAR 1.2 document
 * or a query-able API catalog.
 */

export interface NetworkRequest {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  readonly resourceType?: string;
  readonly startedAt: string;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly requestBody?: string;
  readonly requestBodyMimeType?: string;
}

export interface NetworkResponse {
  readonly id: string;
  readonly status: number;
  readonly endedAt: string;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly responseMimeType?: string;
  readonly responseBodyBytes?: number;
  readonly responseBodyText?: string;
  readonly error?: string;
}

export type InspectedRequest = NetworkRequest &
  Partial<Omit<NetworkResponse, 'id'>> & {
    readonly durationMs?: number;
  };

export interface ApiEndpoint {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly occurrences: number;
  readonly lastStatus: number;
  readonly sampleRequestBody?: string;
  readonly sampleResponseBody?: string;
  readonly contentTypes: readonly string[];
}

export interface StorageSnapshot {
  readonly localStorage?: Readonly<Record<string, string>>;
  readonly sessionStorage?: Readonly<Record<string, string>>;
  /** IndexedDB dump as nested objects, if caller supplies it. */
  readonly indexedDB?: Readonly<Record<string, unknown>>;
}
