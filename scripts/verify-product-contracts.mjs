import { readFile } from 'node:fs/promises';

const [updater, updaterCss, windows, updates] = await Promise.all([
  readFile('src/AppUpdater.tsx', 'utf8'),
  readFile('src/updater.css', 'utf8'),
  readFile('src-tauri/src/app/windows.rs', 'utf8'),
  readFile('src-tauri/src/app/updates.rs', 'utf8')
]);

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

requireMatch(windows, /pub fn hide_main_window\(app: AppHandle\)[\s\S]*?app\.exit\(0\);/, 'La X debe cerrar el proceso, no ocultarlo.');
requireMatch(updater, /status: 'available'/, 'Falta el estado de actualización disponible.');
requireMatch(updater, /Actualizar ahora/, 'Falta el botón “Actualizar ahora”.');
requireMatch(updater, /Más tarde/, 'Falta el botón “Más tarde”.');
requireMatch(updater, /setState\(\{ status: 'available', update \}\)/, 'Detectar una versión debe abrir el diálogo antes de instalar.');
requireMatch(updaterCss, /\.app-update-backdrop/, 'Falta el fondo modal del popup de actualización.');
requireMatch(updaterCss, /\.app-update-dialog/, 'Falta el diálogo visual de actualización.');
requireMatch(updates, /download_and_install[\s\S]*?app\.restart\(\);/, 'NEXO debe reiniciarse después de instalar la actualización.');

console.log('Product contracts passed: real close, explicit update popup and automatic restart.');
