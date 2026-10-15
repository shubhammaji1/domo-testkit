import { expect, test } from 'vitest';
import { useDomoTestKit } from '../../src/vitest.js';
const kit = useDomoTestKit({ datasets: { sales: [{ amount: 20 }] } });
test('native fetch consumes a standard Response', async () => {
  const response = await fetch('https://domo.test/data/v1/sales');
  expect(response.ok).toBe(true);
  expect(await response.json()).toEqual([{ amount: 20 }]);
  expect(kit.requests().some((r) => r.path === '/data/v1/sales')).toBe(true);
});
