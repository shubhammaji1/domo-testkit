// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useDomoTestKit } from '../../src/vitest.js';
const kit = useDomoTestKit({ datasets: { sales: [{ amount: 100 }] } });
const domo = kit.createDomoClient();
function Dashboard() {
  const [message, setMessage] = useState('Loading');
  useEffect(() => {
    let active = true;
    domo
      .get<{ amount: number }[]>('/data/v1/sales')
      .then((rows) => {
        if (active)
          setMessage(
            `Revenue: ${rows.reduce((sum, row) => sum + row.amount, 0)}`,
          );
      })
      .catch(() => {
        if (active) setMessage('Sales unavailable');
      });
    return () => {
      active = false;
    };
  }, []);
  return <p role="status">{message}</p>;
}
afterEach(cleanup);
test('React renders mocked sales', async () => {
  render(<Dashboard />);
  expect(await screen.findByText('Revenue: 100')).toBeTruthy();
});
test('React handles unavailable sales', async () => {
  kit.setScenario('http:error', { status: 503 });
  render(<Dashboard />);
  expect(await screen.findByText('Sales unavailable')).toBeTruthy();
});
