import { expect, test } from 'vitest';
import { useDomoTestKit } from '../../src/vitest.js';
import type { Document } from '../../src/index.js';
const kit = useDomoTestKit({ appdb: { TodoList: [] } });
const domo = kit.createDomoClient();
const path = '/domo/datastores/v2/collections/TodoList/documents';
test('Todo service creates, updates, queries and deletes offline', async () => {
  const todo = await domo.post<Document>(path, {
    content: { title: 'Ship tests', done: false },
  });
  expect(
    await domo.put(`${path}/update`, {
      query: { id: todo.id },
      operation: { $set: { 'content.done': true } },
    }),
  ).toBe(1);
  expect(await domo.post(`${path}/query`, { 'content.done': true })).toEqual([
    expect.objectContaining({
      id: todo.id,
      content: { title: 'Ship tests', done: true },
    }),
  ]);
  await domo.delete(`${path}/${todo.id}`);
  expect(kit.appdb.list('TodoList')).toEqual([]);
});
