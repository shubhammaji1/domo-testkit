// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://domo.test"}
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createDomoTestKit } from '../src/index.js';
import type { Document, Row } from '../src/index.js';
const kit = createDomoTestKit({
  appdbVersions: ['v1'],
  appdb: { Notes: [] },
  datasets: { sales: [{ amount: 10 }] },
});
beforeAll(() => kit.start());
afterAll(() => kit.stop());
// Use the published client and its actual XHR transport, not a simulated wrapper.
const module = await import('@domoinc/toolkit');
const toolkit = module.default ?? module;
test('Toolkit 2.3 TransportClient returns its own response wrapper', async () => {
  const response = await toolkit.TransportClient.get<Row[]>(
    '/data/v1/sales',
    undefined,
    { accept: 'application/json' },
  );
  expect(response).toEqual({
    status: 'OK',
    statusCode: 200,
    data: [{ amount: 10 }],
  });
});
test('Toolkit DocumentsClient create/query/replace/partial update', async () => {
  const client = new toolkit.AppDBClient.DocumentsClient<{ text: string }>(
    'Notes',
  );
  const created = await client.create({ text: 'original' });
  expect(created).toMatchObject({
    status: 'OK',
    statusCode: 200,
    data: { content: { text: 'original' }, owner: 1 },
  });
  const id = (created as { data: Document }).data.id;
  expect(await client.get({ 'content.text': 'original' })).toMatchObject({
    data: [{ id }],
  });
  expect(
    await client.update({ id, content: { text: 'updated' } }),
  ).toMatchObject({ data: { id, content: { text: 'updated' } } });
  expect(
    await client.partialUpdate({ id }, { $set: { 'content.text': 'partial' } }),
  ).toEqual({ status: 'OK', statusCode: 200, data: 1 });
  expect(kit.appdb.get('Notes', id).content.text).toBe('partial');
  kit.assertNoUnhandledRequests();
});
test('Toolkit bulk delete is deliberately unsupported', async () => {
  const client = new toolkit.AppDBClient.DocumentsClient<Row>('Notes');
  await expect(client.delete('some-id')).rejects.toThrow('501');
  expect(() => kit.assertNoUnhandledRequests()).toThrow(
    'Offline request blocked',
  );
  kit.reset();
});
