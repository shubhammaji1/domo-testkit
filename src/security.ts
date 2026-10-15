import type { Json } from './types.js';

export class TestKitError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'TestKitError';
  }
}
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
export function safePath(path: string): string[] {
  const parts = path.split('.');
  if (parts.length > 32 || parts.some((p) => !p || unsafe.has(p)))
    throw new TestKitError('Unsafe or excessive property path');
  return parts;
}
export function jsonClone<T>(input: T, maxBytes = 8_000_000): T {
  const seen = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  function visit(value: unknown, depth: number): void {
    if (++nodes > 500_000 || depth > 32)
      throw new TestKitError('JSON complexity limit exceeded');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > maxBytes)
        throw new TestKitError('JSON size limit exceeded', 413);
      return;
    }
    if (
      typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null &&
        !Array.isArray(value))
    )
      throw new TestKitError('Fixtures must contain plain JSON values');
    if (seen.has(value)) throw new TestKitError('Cyclic JSON is unsupported');
    seen.add(value);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (unsafe.has(key) || descriptor.get || descriptor.set)
        throw new TestKitError('Unsafe JSON property');
      bytes += Buffer.byteLength(key);
      visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
  }
  visit(input, 0);
  const encoded = JSON.stringify(input);
  if (Buffer.byteLength(encoded) > maxBytes)
    throw new TestKitError('JSON size limit exceeded', 413);
  return JSON.parse(encoded) as T;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const sensitive =
  /authorization|cookie|token|secret|password|session|api.?key|credential/i;
export function redactText(value: string, secrets: string[]): string {
  for (const secret of secrets) {
    value = value.split(secret).join('[REDACTED]');
    value = value.split(encodeURIComponent(secret)).join('[REDACTED]');
  }
  return value;
}
export function redact(input: Json, secrets: string[]): Json {
  if (typeof input === 'string') return redactText(input, secrets);
  if (Array.isArray(input)) return input.map((v) => redact(v, secrets));
  if (input && typeof input === 'object')
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        sensitive.test(key) ? '[REDACTED]' : redact(value, secrets),
      ]),
    );
  return input;
}
export function sanitizedUrl(raw: string, secrets: string[]): string {
  const url = new URL(raw);
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const [key, value] of url.searchParams)
    url.searchParams.set(
      key,
      sensitive.test(key) ? '[REDACTED]' : redactText(value, secrets),
    );
  return redactText(url.toString(), secrets);
}
export function sanitizedHeaders(
  headers: Headers,
  secrets: string[],
): Record<string, string> {
  return Object.fromEntries(
    [...headers].map(([k, v]) => [
      k,
      ['accept', 'content-type'].includes(k)
        ? redactText(v, secrets)
        : '[REDACTED]',
    ]),
  );
}
