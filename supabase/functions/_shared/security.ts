export class RequestBodyError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RequestBodyError';
    this.status = status;
  }
}

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  unavailable: boolean;
};

export async function readLimitedText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const declaredLengthHeader = request.headers.get('content-length');
  if (declaredLengthHeader) {
    const declaredLength = Number(declaredLengthHeader);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) {
      throw new RequestBodyError('Invalid Content-Length header.', 400);
    }
    if (declaredLength > maxBytes) {
      throw new RequestBodyError('Request body is too large.', 413);
    }
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('request_body_too_large').catch(() => undefined);
        throw new RequestBodyError('Request body is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new RequestBodyError('Request body is not valid UTF-8.', 400);
  }
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes = 16 * 1024,
): Promise<T> {
  const raw = await readLimitedText(request, maxBytes);
  if (!raw.trim()) throw new RequestBodyError('Request body is required.', 400);

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new RequestBodyError('Request body must be valid JSON.', 400);
  }
}

export async function consumeUserRateLimit(
  admin: any,
  scope: string,
  subjectId: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  const { data, error } = await admin.rpc('consume_edge_rate_limit', {
    p_scope: scope,
    p_subject_id: subjectId,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error('Edge rate-limit check failed:', error.code || 'unknown');
    return { allowed: false, retryAfterSeconds: 30, unavailable: true };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== 'boolean') {
    console.error('Edge rate-limit check returned an invalid result.');
    return { allowed: false, retryAfterSeconds: 30, unavailable: true };
  }

  return {
    allowed: row.allowed,
    retryAfterSeconds: Math.max(1, Number(row.retryAfterSeconds) || 1),
    unavailable: false,
  };
}
