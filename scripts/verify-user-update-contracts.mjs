import { readFile } from 'node:fs/promises';

const [updater, app, tauri, manual, main, auth, authClient, authWorkflow] = await Promise.all([
  readFile('src/AppUpdater.tsx', 'utf8'),
  readFile('src-tauri/src/app.rs', 'utf8'),
  readFile('src-tauri/tauri.conf.json', 'utf8'),
  readFile('src-tauri/src/app/manual_update.rs', 'utf8'),
  readFile('src/main.tsx', 'utf8'),
  readFile('src/EmailCodeAuth.tsx', 'utf8'),
  readFile('src/lib/email-code-auth.ts', 'utf8'),
  readFile('.github/workflows/publish-desktop-auth-config.yml', 'utf8')
]);

function need(source, value, message) {
  if (!source.includes(value)) throw new Error(message);
}

for (const value of ['STARTUP_CHECK_DELAY_MS', 'CHECK_EVERY_MS', "safeInvoke('install_app_update'", "window.setInterval(() => void check()"])
  need(updater, value, `Updater contract missing: ${value}`);
need(app, 'updates::install_app_update', 'Tauri must expose install_app_update.');
need(tauri, 'nexosupport/releases/latest/download/latest.json', 'Tauri updater must use NEXO releases.');
need(tauri, 'createUpdaterArtifacts', 'Tauri must generate updater artifacts.');
need(manual, 'Ratwaredev/nexosupport/releases/download', 'Manual updater fallback must use NEXO releases.');

need(main, '<EmailCodeAuth>', 'NEXO must require email authentication.');
need(auth, 'Enviar código', 'Email code UI missing.');
for (const value of ['/auth/v1/otp', '/auth/v1/verify', "type: 'email'", 'create_user: true'])
  need(authClient, value, `Email auth contract missing: ${value}`);
for (const value of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'auth-config.json', 'gh release upload'])
  need(authWorkflow, value, `Shared desktop auth config contract missing: ${value}`);

console.log('NEXO contracts verified: email-code users + automatic signed updates.');
