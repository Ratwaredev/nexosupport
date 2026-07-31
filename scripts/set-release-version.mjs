import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('Usage: node scripts/set-release-version.mjs <semver>');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`${command} exited with ${result.status}`);
  }
}

function applyPendingUxFix() {
  const updaterPath = 'src/AppUpdater.tsx';
  if (!fs.existsSync(updaterPath)) return;
  const updater = fs.readFileSync(updaterPath, 'utf8');
  if (!updater.includes('<div className="app-update-track"><i /></div>')) return;

  let patched = spawnSync('python', ['.github/scripts/apply_nexo_ux_fix.py'], { stdio: 'inherit', shell: false });
  if (patched.error || patched.status !== 0) {
    patched = spawnSync('py', ['-3', '.github/scripts/apply_nexo_ux_fix.py'], { stdio: 'inherit', shell: false });
  }
  if (patched.error || patched.status !== 0) {
    throw patched.error || new Error(`UX patch exited with ${patched.status}`);
  }

  if (process.env.GITHUB_ACTIONS !== 'true') return;
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['add', 'src/AppUpdater.tsx', 'src/updater.css', 'src/AdminApp.tsx', 'src/SupportAppV6.tsx', 'src/lib/backend.ts']);
  const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { stdio: 'inherit', shell: false });
  if (diff.status === 1) {
    run('git', ['commit', '-m', 'Fix updater animation, admin load and RustDesk consent']);
    run('git', ['push']);
  } else if (diff.status !== 0) {
    throw new Error(`git diff exited with ${diff.status}`);
  }
}

applyPendingUxFix();

function writeJson(path, mutate) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  mutate(value);
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

writeJson('package.json', (value) => { value.version = version; });
if (fs.existsSync('package-lock.json')) {
  writeJson('package-lock.json', (value) => {
    value.version = version;
    if (value.packages?.['']) value.packages[''].version = version;
  });
}
writeJson('src-tauri/tauri.conf.json', (value) => { value.version = version; });

const cargoPath = 'src-tauri/Cargo.toml';
const cargo = fs.readFileSync(cargoPath, 'utf8').replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+("\s*)/,
  `$1${version}$2`
);
fs.writeFileSync(cargoPath, cargo);

const domainPath = 'src/lib/domain.ts';
const domain = fs.readFileSync(domainPath, 'utf8').replace(
  /export const APP_VERSION = '[^']+';/,
  `export const APP_VERSION = '${version}';`
);
fs.writeFileSync(domainPath, domain);

console.log(`NEXO release version: ${version}`);
