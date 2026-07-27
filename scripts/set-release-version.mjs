import fs from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('Usage: node scripts/set-release-version.mjs <semver>');
}

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
