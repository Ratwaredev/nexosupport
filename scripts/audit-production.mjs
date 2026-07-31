import { spawnSync } from 'node:child_process';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.NEXO_SKIP_AUDIT === '1') process.exit(0);

const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const audit = spawnSync(executable, ['audit', '--omit=dev', '--audit-level=high'], {
  stdio: 'inherit',
  shell: false
});

if (audit.error) {
  console.error(`Production dependency audit failed to start: ${audit.error.message}`);
  process.exit(1);
}
process.exit(audit.status ?? 1);
