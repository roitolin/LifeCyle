/* eslint-disable @typescript-eslint/no-explicit-any */

declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  };

  export function serve(
    handler: (request: Request) => Promise<Response> | Response
  ): void;

  export function serve(
    options: {
      port?: number;
      hostname?: string;
      signal?: AbortSignal;
      onListen?: (params: { port: number; hostname: string }) => void;
      onError?: (error: unknown) => Response | Promise<Response>;
    },
    handler: (request: Request) => Promise<Response> | Response
  ): void;

  export const errors: Record<string, any>;
}

declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}
