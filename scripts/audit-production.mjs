import { spawnSync } from 'node:child_process';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.NEXO_SKIP_AUDIT === '1') process.exit(0);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Production dependency audit could not locate the npm CLI.');
  process.exit(1);
}

const audit = spawnSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--audit-level=high'], {
  stdio: 'inherit',
  shell: false,
  env: process.env
});

if (audit.error) {
  console.error(`Production dependency audit failed to start: ${audit.error.message}`);
  process.exit(1);
}
process.exit(audit.status ?? 1);
