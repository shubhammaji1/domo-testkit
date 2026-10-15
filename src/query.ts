import { isDeepStrictEqual } from 'node:util';
import { isRecord, jsonClone, safePath, TestKitError } from './security.js';
import type { Row } from './types.js';

export function lookup(value: unknown, path: string): unknown {
  for (const part of safePath(path)) {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
const operators = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
]);
export function validateQuery(input: unknown): asserts input is Row {
  jsonClone(input);
  if (!isRecord(input)) throw new TestKitError('Query must be a JSON object');
  for (const [key, value] of Object.entries(input)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value) || !value.length)
        throw new TestKitError(`${key} requires a nonempty array`);
      value.forEach(validateQuery);
    } else {
      if (key.startsWith('$'))
        throw new TestKitError(`Unsupported query operator: ${key}`);
      safePath(key);
      if (
        isRecord(value) &&
        Object.keys(value).some((k) => k.startsWith('$'))
      ) {
        for (const [op, operand] of Object.entries(value)) {
          if (!operators.has(op))
            throw new TestKitError(`Unsupported query operator: ${op}`);
          if ((op === '$in' || op === '$nin') && !Array.isArray(operand))
            throw new TestKitError(`${op} requires an array`);
          if (op === '$exists' && typeof operand !== 'boolean')
            throw new TestKitError('$exists requires a boolean');
          if (
            ['$gt', '$gte', '$lt', '$lte'].includes(op) &&
            typeof operand !== 'number' &&
            typeof operand !== 'string'
          )
            throw new TestKitError(`${op} requires a number or string`);
        }
      }
    }
  }
}
function equal(actual: unknown, expected: unknown): boolean {
  return (
    isDeepStrictEqual(actual, expected) ||
    (Array.isArray(actual) &&
      !Array.isArray(expected) &&
      actual.some((v) => isDeepStrictEqual(v, expected)))
  );
}
export function matches(value: unknown, query: Row): boolean {
  return Object.entries(query).every(([key, condition]) => {
    if (key === '$and')
      return (condition as Row[]).every((q) => matches(value, q));
    if (key === '$or')
      return (condition as Row[]).some((q) => matches(value, q));
    const actual = lookup(value, key);
    if (
      !isRecord(condition) ||
      !Object.keys(condition).some((k) => k.startsWith('$'))
    )
      return condition === null ? actual == null : equal(actual, condition);
    return Object.entries(condition).every(([op, operand]) => {
      switch (op) {
        case '$eq':
          return operand === null ? actual == null : equal(actual, operand);
        case '$ne':
          return operand === null ? actual != null : !equal(actual, operand);
        case '$exists':
          return (actual !== undefined) === operand;
        case '$in':
          return (operand as unknown[]).some((v) =>
            v === null ? actual == null : equal(actual, v),
          );
        case '$nin':
          return !(operand as unknown[]).some((v) =>
            v === null ? actual == null : equal(actual, v),
          );
        default: {
          if (
            (typeof actual !== 'number' && typeof actual !== 'string') ||
            typeof actual !== typeof operand
          )
            return false;
          const a = actual as number;
          const b = operand as number;
          return op === '$gt'
            ? a > b
            : op === '$gte'
              ? a >= b
              : op === '$lt'
                ? a < b
                : a <= b;
        }
      }
    });
  });
}
export function validateOperation(
  operation: unknown,
): asserts operation is Row {
  jsonClone(operation);
  if (!isRecord(operation) || !Object.keys(operation).length)
    throw new TestKitError('operation must be a nonempty object');
  const paths: string[] = [];
  for (const [op, fields] of Object.entries(operation)) {
    if (!['$set', '$unset', '$inc'].includes(op))
      throw new TestKitError(`Unsupported update operator: ${op}`);
    if (!isRecord(fields)) throw new TestKitError(`${op} requires an object`);
    for (const [path, operand] of Object.entries(fields)) {
      safePath(path);
      if (!path.startsWith('content.'))
        throw new TestKitError('Only content fields may be partially updated');
      if (
        paths.some(
          (p) =>
            p === path || p.startsWith(path + '.') || path.startsWith(p + '.'),
        )
      )
        throw new TestKitError('Conflicting update paths');
      paths.push(path);
      if (op === '$inc' && typeof operand !== 'number')
        throw new TestKitError('$inc requires finite numbers');
    }
  }
}
export function applyOperation<T>(document: T, operation: Row): T {
  const copy = jsonClone(document);
  for (const [op, fields] of Object.entries(operation))
    for (const [path, operand] of Object.entries(fields as Row)) {
      const parts = safePath(path);
      const leaf = parts.pop()!;
      let parent = copy as Record<string, unknown>;
      let absent = false;
      for (const part of parts) {
        if (!Object.hasOwn(parent, part)) {
          if (op === '$unset') {
            absent = true;
            break;
          }
          parent[part] = {};
        }
        if (!isRecord(parent[part]))
          throw new TestKitError('Cannot traverse a non-object update field');
        parent = parent[part];
      }
      if (absent) continue;
      if (op === '$unset') delete parent[leaf];
      else if (op === '$set') parent[leaf] = operand;
      else {
        const current = parent[leaf] === undefined ? 0 : parent[leaf];
        if (
          typeof current !== 'number' ||
          !Number.isFinite(current + (operand as number))
        )
          throw new TestKitError('$inc target must be a finite number');
        parent[leaf] = current + (operand as number);
      }
    }
  return copy;
}
