export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = { [key: string]: Json };
export type ApiVersion = 'v1' | 'v2';
export interface Document<T extends Row = Row> {
  id: string;
  content: T;
  owner?: string;
  createdBy?: string;
  createdOn?: string;
  updatedOn?: string;
  updatedBy?: string;
  datastoreId?: string;
  collectionId?: string;
  syncRequired?: boolean;
}
export interface Validator {
  parse(input: unknown): unknown;
}
export interface DatasetMapping {
  alias: string;
  dataSetId: string;
  fields: { alias: string; columnName: string }[];
}
export interface CollectionDefinition {
  name: string;
  syncEnabled?: boolean;
  schema?: {
    columns: {
      name: string;
      type: 'STRING' | 'LONG' | 'DECIMAL' | 'DOUBLE' | 'DATE' | 'DATETIME';
    }[];
  };
}
export interface Manifest {
  datasetsMapping?: DatasetMapping[];
  mapping?: DatasetMapping[];
  collections?: CollectionDefinition[];
  collectionsMapping?: CollectionDefinition[];
}
export interface Fixtures {
  datasets?: Record<string, Row[]>;
  appdb?: Record<string, Document[]>;
}
export interface TestKitConfig extends Fixtures {
  baseUrl?: string;
  appdbVersions?: ApiVersion[];
  manifest?: Manifest;
  manifestAdapter?: 'modern' | 'legacy-mapping' | 'collections-mapping';
  datasetSchemas?: Record<string, Validator>;
  collectionSchemas?: Record<string, Validator>;
  clock?: () => Date;
  idFactory?: (sequence: number) => string;
  userId?: string;
  allowOrigins?: string[];
  secrets?: string[];
  captureBodies?: boolean;
  maxFixtureBytes?: number;
  maxRequestBytes?: number;
  maxHistory?: number;
}
export type ScenarioName =
  | 'http:error'
  | 'network:error'
  | 'network:slow'
  | 'dataset:timeout'
  | 'dataset:empty'
  | 'dataset:invalid-json'
  | 'response:override'
  | 'appdb:permission-denied'
  | 'appdb:collection-not-found'
  | 'appdb:document-not-found'
  | 'appdb:create-failure'
  | 'appdb:update-failure'
  | 'appdb:delete-failure'
  | 'appdb:query-failure';
export interface Scenario {
  alias?: string;
  collection?: string;
  method?: string;
  status?: number;
  delayMs?: number;
  body?: Json;
  once?: boolean;
}
export interface RequestRecord {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: Json;
  status?: number;
  outcome: 'mock' | 'blocked' | 'allowed' | 'network-error';
}
export interface DomoClient {
  get<T = Json>(url: string): Promise<T>;
  post<T = Json>(url: string, body: Json): Promise<T>;
  put<T = Json>(url: string, body: Json): Promise<T>;
  delete<T = void>(url: string): Promise<T>;
}
