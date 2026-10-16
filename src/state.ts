import { fixturesSchema, rowSchema, validateConfig } from './config.js';
import {
  applyOperation,
  matches,
  validateOperation,
  validateQuery,
} from './query.js';
import { isRecord, jsonClone, TestKitError } from './security.js';
import type { Document, Fixtures, Row } from './types.js';

export class State {
  private datasets = new Map<string, Row[]>();
  private collections = new Map<string, Document[]>();
  private sequence = 0;
  private initial: Fixtures;
  constructor(readonly config: ReturnType<typeof validateConfig>) {
    this.initial = jsonClone(
      { datasets: config.datasets ?? {}, appdb: config.appdb ?? {} },
      config.maxFixtureBytes,
    );
    this.reset();
  }
  reset() {
    const next = this.prepare(this.initial);
    this.datasets = next.datasets;
    this.collections = next.collections;
    this.sequence = 0;
  }
  private prepare(fixtures: Fixtures) {
    const cloned = fixturesSchema.parse(
      jsonClone(fixtures, this.config.maxFixtureBytes),
    );
    const datasets = new Map<string, Row[]>();
    const collections = new Map<string, Document[]>();
    for (const mapping of this.config.mappings.datasets)
      datasets.set(mapping.alias, []);
    for (const definition of this.config.mappings.collections)
      collections.set(definition.name, []);
    for (const [alias, rows] of Object.entries(cloned.datasets ?? {})) {
      this.validateRows(alias, rows);
      datasets.set(alias, rows);
    }
    for (const [name, docs] of Object.entries(cloned.appdb ?? {})) {
      if (new Set(docs.map((d) => d.id)).size !== docs.length)
        throw new TestKitError('Duplicate document ID');
      docs.forEach((d) => this.validateContent(name, d.content));
      collections.set(name, docs);
    }
    return { datasets, collections };
  }
  seed(fixtures: Fixtures, options: { replaceInitial?: boolean } = {}) {
    const next = this.prepare(fixtures);
    this.datasets = next.datasets;
    this.collections = next.collections;
    this.sequence = 0;
    if (options.replaceInitial)
      this.initial = jsonClone(fixtures, this.config.maxFixtureBytes);
  }
  validateRows(alias: string, rows: Row[]) {
    rows.forEach((row) => {
      rowSchema.parse(row);
      this.config.datasetSchemas[alias]?.parse(row);
    });
  }
  setDataset(alias: string, rows: object[]) {
    const next = fixturesSchema.parse(
      jsonClone({ datasets: { [alias]: rows } }, this.config.maxFixtureBytes),
    ).datasets![alias]!;
    this.validateRows(alias, next);
    jsonClone(
      {
        datasets: { ...Object.fromEntries(this.datasets), [alias]: next },
        appdb: Object.fromEntries(this.collections),
      },
      this.config.maxFixtureBytes,
    );
    this.datasets.set(alias, next);
  }
  getDataset(alias: string): Row[] {
    const rows = this.datasets.get(alias);
    if (!rows) throw new TestKitError('Dataset alias not registered', 404);
    const fields = this.config.mappings.datasets.find(
      (d) => d.alias === alias,
    )?.fields;
    if (!fields?.length) return jsonClone(rows, this.config.maxFixtureBytes);
    return rows.map(
      (row) =>
        Object.fromEntries(
          fields
            .filter((f) => Object.hasOwn(row, f.columnName))
            .map((f) => [
              f.alias,
              jsonClone(row[f.columnName], this.config.maxFixtureBytes),
            ]),
        ) as Row,
    );
  }
  validateContent(name: string, content: Row) {
    rowSchema.parse(content);
    this.config.collectionSchemas[name]?.parse(content);
    for (const column of this.config.mappings.collections.find(
      (c) => c.name === name,
    )?.schema?.columns ?? []) {
      const value = content[column.name];
      if (value === undefined || value === null) continue;
      const valid =
        column.type === 'STRING'
          ? typeof value === 'string'
          : column.type === 'LONG'
            ? Number.isSafeInteger(value)
            : ['DECIMAL', 'DOUBLE'].includes(column.type)
              ? typeof value === 'number'
              : typeof value === 'string' && Number.isFinite(Date.parse(value));
      if (!valid)
        throw new TestKitError(
          `Collection schema mismatch for column ${column.name}`,
        );
    }
  }
  list(name: string): Document[] {
    const docs = this.collections.get(name);
    if (!docs) throw new TestKitError('DA0088: Invalid collection name', 404);
    return jsonClone(docs, this.config.maxFixtureBytes);
  }
  get(name: string, id: string): Document {
    const doc = this.list(name).find((d) => d.id === id);
    if (!doc) throw new TestKitError('Document could not be found', 404);
    return doc;
  }
  create(name: string, content: Row): Document {
    const docs = this.list(name);
    this.validateContent(name, content);
    let sequence = this.sequence;
    let id: string;
    do {
      if (++sequence - this.sequence > 10_000)
        throw new TestKitError('idFactory could not produce a unique ID');
      id = this.config.idFactory(sequence);
      fixturesSchema.parse({ appdb: { [name]: [{ id, content: {} }] } });
    } while (docs.some((d) => d.id === id));
    const stamp = this.config.clock().toISOString();
    const doc: Document = {
      id,
      content: jsonClone(content),
      owner: this.config.userId,
      createdBy: this.config.userId,
      updatedBy: this.config.userId,
      createdOn: stamp,
      updatedOn: stamp,
      syncRequired:
        this.config.mappings.collections.find((c) => c.name === name)
          ?.syncEnabled ?? false,
    };
    docs.push(doc);
    this.checkSize(name, docs);
    this.collections.set(name, docs);
    this.sequence = sequence;
    return jsonClone(doc);
  }
  replace(name: string, id: string, content: Row): Document {
    const docs = this.list(name);
    const index = docs.findIndex((d) => d.id === id);
    if (index < 0) throw new TestKitError('Document could not be found', 404);
    this.validateContent(name, content);
    const doc = {
      ...docs[index]!,
      content: jsonClone(content),
      updatedOn: this.config.clock().toISOString(),
      updatedBy: this.config.userId,
    };
    docs[index] = doc;
    this.checkSize(name, docs);
    this.collections.set(name, docs);
    return jsonClone(doc);
  }
  delete(name: string, id: string) {
    this.get(name, id);
    this.collections.set(
      name,
      this.list(name).filter((d) => d.id !== id),
    );
  }
  query(name: string, query: object) {
    validateQuery(query);
    return this.list(name).filter((d) => matches(d, query));
  }
  update(name: string, query: Row, operation: Row): number {
    validateQuery(query);
    validateOperation(operation);
    let count = 0;
    const docs = this.list(name).map((doc) => {
      if (!matches(doc, query)) return doc;
      const next = applyOperation(doc, operation);
      this.validateContent(name, next.content);
      next.updatedOn = this.config.clock().toISOString();
      next.updatedBy = this.config.userId;
      count++;
      return next;
    });
    this.checkSize(name, docs);
    this.collections.set(name, docs);
    return count;
  }
  private checkSize(name: string, docs: Document[]) {
    jsonClone(
      {
        datasets: Object.fromEntries(this.datasets),
        appdb: { ...Object.fromEntries(this.collections), [name]: docs },
      },
      this.config.maxFixtureBytes,
    );
  }
}

export function parseContent(body: unknown): Row {
  if (
    !isRecord(body) ||
    Object.keys(body).some((k) => k !== 'content') ||
    !isRecord(body.content)
  )
    throw new TestKitError(
      'Expected { content: { ... } }; metadata is immutable',
    );
  return body.content as Row;
}
