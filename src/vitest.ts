import { beforeAll, afterAll, afterEach } from 'vitest';
import { createDomoTestKit } from './index.js';
import type { TestKitConfig } from './types.js';
/** Register lifecycle hooks inside a sequential suite or a setup file. */
export function useDomoTestKit(config: TestKitConfig = {}) {
  const kit = createDomoTestKit(config);
  beforeAll(() => kit.start());
  afterEach(() => {
    try {
      kit.assertNoUnhandledRequests();
    } finally {
      kit.reset();
    }
  });
  afterAll(() => kit.stop());
  return kit;
}
