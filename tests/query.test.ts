import { describe, expect, test } from 'vitest';
import {
  applyOperation,
  lookup,
  matches,
  validateOperation,
  validateQuery,
} from '../src/query.js';
import type { Row } from '../src/types.js';
const docs = [
  {
    id: 'a',
    content: {
      n: 1,
      region: 'East',
      nullable: null,
      tags: ['a', 'b'],
      deep: { active: true },
    },
  },
  { id: 'b', content: { n: 3, region: 'West' } },
  { id: 'c', content: { n: 8, region: 'East' } },
];
describe('explicit query subset with independent expected IDs', () => {
  test.each<[Row, string[]]>([
    [{ 'content.n': 1 }, ['a']],
    [{ 'content.n': { $eq: 3 } }, ['b']],
    [{ 'content.n': { $ne: 3 } }, ['a', 'c']],
    [{ 'content.n': { $gt: 3 } }, ['c']],
    [{ 'content.n': { $gte: 3 } }, ['b', 'c']],
    [{ 'content.n': { $lt: 3 } }, ['a']],
    [{ 'content.n': { $lte: 3 } }, ['a', 'b']],
    [{ 'content.n': { $in: [1, 8] } }, ['a', 'c']],
    [{ 'content.n': { $nin: [1, 8] } }, ['b']],
    [
      { $and: [{ 'content.region': 'East' }, { 'content.n': { $gt: 1 } }] },
      ['c'],
    ],
    [{ $or: [{ id: 'a' }, { id: 'b' }] }, ['a', 'b']],
    [{ 'content.nullable': { $exists: true } }, ['a']],
    [{ 'content.nullable': { $exists: false } }, ['b', 'c']],
    [{ 'content.deep.active': true }, ['a']],
    [{ 'content.tags': 'b' }, ['a']],
    [{ 'content.tags': { $in: ['b'] } }, ['a']],
    [{ 'content.tags': ['a', 'b'] }, ['a']],
    [{ 'content.n': { $gt: '1' } }, []],
    [{ 'content.missing': null }, ['a', 'b', 'c']],
    [{ 'content.nullable': { $eq: null } }, ['a', 'b', 'c']],
    [{ 'content.nullable': { $ne: null } }, []],
    [{ 'content.missing': { $in: [null] } }, ['a', 'b', 'c']],
    [{ 'content.missing': { $nin: [null] } }, []],
    [{ 'content.deep': { active: true } }, ['a']],
  ])('%j returns %j', (query, expected) => {
    validateQuery(query);
    expect(docs.filter((d) => matches(d, query)).map((d) => d.id)).toEqual(
      expected,
    );
  });
  test.each([
    [],
    null,
    { $where: 'process.exit()' },
    { $and: [] },
    { $or: {} },
    { 'content.n': { $regex: '.*' } },
    { 'content.n': { $in: 1 } },
    { 'content.n': { $nin: 1 } },
    { 'content.n': { $exists: 1 } },
    { 'content.n': { $gt: {} } },
    { 'content.n': { $eq: 1, typo: 2 } },
    { 'content.__proto__.polluted': 1 },
  ])('rejects malicious/unsupported query %j', (query) => {
    expect(() => validateQuery(query)).toThrow();
  });
  test('does not look up inherited fields or traverse arrays', () => {
    expect(lookup({}, 'toString')).toBeUndefined();
    expect(lookup({ a: [] }, 'a.x')).toBeUndefined();
  });
});
describe('partial updates are bounded and immutable', () => {
  test.each([
    {},
    null,
    { $push: { 'content.a': 1 } },
    { $set: [] },
    { $set: { id: 'evil' } },
    { $inc: { 'content.n': '1' } },
    { $set: { 'content.a': 1, 'content.a.b': 2 } },
    { $unset: { 'content.constructor.a': 1 } },
  ])('rejects %j', (op) => {
    expect(() => validateOperation(op)).toThrow();
  });
  test('missing parent creation, missing increment, unset no-op', () => {
    const original = { content: {} };
    const operation = {
      $set: { 'content.a.b': 1 },
      $inc: { 'content.n': 2 },
      $unset: { 'content.absent.deep': '' },
    };
    validateOperation(operation);
    expect(applyOperation(original, operation)).toEqual({
      content: { a: { b: 1 }, n: 2 },
    });
    expect(original).toEqual({ content: {} });
  });
  test('numeric and path errors are explicit', () => {
    expect(() =>
      applyOperation({ content: { a: 1 } }, { $set: { 'content.a.b': 1 } }),
    ).toThrow('non-object');
    expect(() =>
      applyOperation({ content: { a: null } }, { $inc: { 'content.a': 1 } }),
    ).toThrow('finite');
    expect(() =>
      applyOperation(
        { content: { a: 1e308 } },
        { $inc: { 'content.a': 1e308 } },
      ),
    ).toThrow('finite');
  });
});
