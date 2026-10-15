# Dataset testing

`datasets` maps application aliases to JSON row arrays. `datasets.set` replaces source rows, and `datasets.get` reads an isolated exposed copy. Existing fixture files are never modified. Empty arrays are valid; missing aliases return a controlled synthetic 404 over HTTP.

Manifest adapters are explicit:

- `modern`: `datasetsMapping` and `collections`.
- `legacy-mapping`: legacy `mapping` with the supported `{ alias, dataSetId, fields }` entry shape.
- `collections-mapping`: modern `datasetsMapping` with alternate `collectionsMapping`.

Conflicting forms and duplicate aliases are rejected. The `dataSetId` declares the source identity but does not trigger a network lookup or imply fixtures keyed by physical dataset IDs. Fixture keys are always aliases. Field mapping projects source `columnName` values to application `alias` keys; absent source fields remain absent. Empty `fields` preserves all original column names.

GET supports `fields` projection and nonnegative integer `offset`/`limit`. Unsupported parameters return 501 and a recorded offline violation. These subsets do not implement filtering, aggregates, sorting, dategrain, Beast Modes or SQL. Duplicate records, nulls, mixed values and large fixtures are preserved within configured memory budgets.

Provide a `.parse()` row validator through `datasetSchemas` to validate source columns. The default only validates safe JSON row structure. Missing columns and unexpected types can therefore be normal fixtures when no stricter schema is supplied. Use `response:override` when you intentionally need invalid application data despite a strict fixture schema. `dataset:empty` and `dataset:invalid-json` supply common failure cases. Dataset HTTP errors and slow responses use scoped generic scenarios.
