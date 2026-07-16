import type { Writable } from 'node:stream';

import { serializeCliError } from './errors.js';

export interface OutputContext {
  readonly provider?: string;
  readonly connectionId?: string;
}

function serializable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return { type: 'bytes', byteLength: value.byteLength };
  }
  if (value instanceof Error) return serializeCliError(value);
  if (Array.isArray(value)) return value.map((entry) => serializable(entry, seen));
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'raw') continue;
    const converted = serializable(entry, seen);
    if (converted !== undefined) result[key] = converted;
  }
  seen.delete(value);
  return result;
}

export function toSerializable(value: unknown): unknown {
  return serializable(value);
}

export function writeJsonLine(stream: Writable, value: unknown): void {
  stream.write(`${JSON.stringify(toSerializable(value))}\n`);
}

export class CommandOutput {
  constructor(
    private readonly stdout: Writable,
    private readonly stderr: Writable,
    private readonly json: boolean,
  ) {}

  success(command: string, data: unknown, context: OutputContext = {}): void {
    if (this.json) {
      writeJsonLine(this.stdout, {
        schemaVersion: 1,
        ok: true,
        command,
        ...(Object.keys(context).length === 0 ? {} : { context }),
        data,
      });
      return;
    }

    if (typeof data === 'string') {
      this.stdout.write(`${data}\n`);
      return;
    }

    if (data === undefined) {
      this.stdout.write('Done.\n');
      return;
    }

    this.stdout.write(`${JSON.stringify(toSerializable(data), null, 2)}\n`);
  }

  failure(command: string, error: unknown): void {
    const serialized = serializeCliError(error);
    if (this.json) {
      writeJsonLine(this.stderr, {
        schemaVersion: 1,
        ok: false,
        command,
        error: serialized,
      });
      return;
    }

    this.stderr.write(`${serialized.type}: ${serialized.message}\n`);
  }

  diagnostic(message: string): void {
    this.stderr.write(`${message}\n`);
  }
}
