import { ApiErrorBody } from './types.js';

export const DEFAULT_BASE_URL = 'http://localhost:3001';

export class McpToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

function unreachableError(baseUrl: string, cause: unknown): McpToolError {
  return new McpToolError(
    'API_UNREACHABLE',
    `DevDigest API unreachable at ${baseUrl}. Start the server: cd server && pnpm dev\n(${(cause as Error)?.message ?? cause})`,
  );
}

async function toResponseError(res: Response): Promise<McpToolError> {
  let message = `API error ${res.status}`;
  try {
    const body = ApiErrorBody.parse(await res.json());
    message = `API error ${res.status}: ${body.error.message}`;
  } catch {
    // Body wasn't the expected envelope — fall back to the bare status.
  }
  return new McpToolError('API_ERROR', message);
}

export interface DevDigestClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function makeClient(baseUrl: string = DEFAULT_BASE_URL): DevDigestClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, init);
    } catch (err) {
      throw unreachableError(baseUrl, err);
    }
    if (!res.ok) throw await toResponseError(res);
    return (await res.json()) as T;
  }

  return {
    get: (path) => request(path),
    post: (path, body) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
