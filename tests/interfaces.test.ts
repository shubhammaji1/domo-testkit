import { afterAll, expect, test } from 'vitest';
import { createDomoTestKit } from '../src/index.js';
import type { Document, Fixtures, TestKitConfig } from '../src/index.js';

interface Sale {
  amount: number;
  customer: { name: string };
}
interface Todo {
  title: string;
  completed: boolean;
}
interface TodoRequest {
  content: Todo;
}
interface TodoQuery {
  id: string;
}

const sales: Sale[] = [{ amount: 100, customer: { name: 'Alex' } }];
const todo: Document<Todo> = {
  id: 'todo-1',
  content: { title: 'Initial', completed: false },
};
const fixtures: Fixtures = { datasets: { sales }, appdb: { Todos: [todo] } };
const config: TestKitConfig = { ...fixtures };
const kit = createDomoTestKit(config);
afterAll(() => kit.stop());

test('named interfaces work through initial fixtures, overrides and seed/reset', () => {
  expect(kit.datasets.get('sales')).toEqual(sales);
  kit.datasets.set('sales', sales);
  kit.seed(fixtures);
  expect(kit.appdb.get('Todos', todo.id)).toEqual(todo);
  const filter: TodoQuery = { id: todo.id };
  expect(kit.appdb.query('Todos', filter)).toEqual([todo]);
  kit.reset();
  expect(kit.datasets.get('sales')).toEqual(sales);
});

test('typed client requests and response documents retain their content types', async () => {
  await kit.start();
  const client = kit.createDomoClient();
  const path = '/domo/datastores/v2/collections/Todos/documents';
  const request: TodoRequest = {
    content: { title: 'Created', completed: false },
  };
  const created: Document<Todo> = await client.post<Document<Todo>>(
    path,
    request,
  );
  expect(created.content.title).toBe('Created');
  const updated = await client.put<Document<Todo>>(`${path}/${created.id}`, {
    content: { ...request.content, completed: true },
  });
  expect(updated.content.completed).toBe(true);
  kit.assertNoUnhandledRequests();
});

test('accepting interfaces does not permit non-JSON fixture values at runtime', () => {
  interface InvalidSale {
    amount: number;
    date: Date;
  }
  const invalid: InvalidSale[] = [{ amount: 100, date: new Date() }];
  expect(() => kit.datasets.set('sales', invalid)).toThrow('plain JSON');
  expect(() => kit.seed({ datasets: { sales: invalid } })).toThrow(
    'plain JSON',
  );
  expect(kit.datasets.get('sales')).toEqual(sales);
});

test('typed client bodies reject values JSON.stringify would silently discard or convert', async () => {
  await kit.start();
  const client = kit.createDomoClient();
  const path = '/domo/datastores/v2/collections/Todos/documents';
  await expect(
    client.post(path, { content: { run: () => 'unsafe' } }),
  ).rejects.toThrow('plain JSON');
  await expect(
    client.put(`${path}/todo-1`, { content: { date: new Date() } }),
  ).rejects.toThrow('plain JSON');
  expect(kit.appdb.get('Todos', 'todo-1').content.title).toBe('Initial');
});

// Compile-time regressions: accepting named objects must preserve generic field types
// and keep primitive fixture rows out of the public API.
function rejectedTypes() {
  // @ts-expect-error Document content must be an object.
  const primitive: Document<string> = { id: 'bad', content: 'text' };
  const wrong: Document<Todo> = {
    id: 'bad',
    // @ts-expect-error Typed content must retain the boolean property type.
    content: { title: 'Wrong', completed: 'yes' },
  };
  // @ts-expect-error Dataset rows must be objects.
  createDomoTestKit({ datasets: { sales: [123] } });
  return [primitive, wrong];
}
void rejectedTypes;
