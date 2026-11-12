import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig: demonstração', () => {
  it('liga com --demo (npm run demo, em qualquer shell) ou com HABBLAUD_DEMO=1', () => {
    const home = mkdtempSync(join(tmpdir(), 'habblaud-config-'));
    try {
      const demo = (env: NodeJS.ProcessEnv, argv: string[]) => loadConfig({ HOME: home, USERPROFILE: home, HABBLAUD_IN_DOCKER: '0', ...env }, argv).demo;
      expect(demo({}, [])).toBe(false);
      expect(demo({}, ['node', 'server/index.ts', '--dev', '--demo'])).toBe(true);
      expect(demo({ HABBLAUD_DEMO: '1' }, [])).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
