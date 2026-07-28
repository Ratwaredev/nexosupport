import { readFile } from 'node:fs/promises';

const [updater, updaterCss, windows, updates, support, supportCss, app] = await Promise.all([
  readFile('src/AppUpdater.tsx', 'utf8'),
  readFile('src/updater.css', 'utf8'),
  readFile('src-tauri/src/app/windows.rs', 'utf8'),
  readFile('src-tauri/src/app/updates.rs', 'utf8'),
  readFile('src/SupportAppV3.tsx', 'utf8'),
  readFile('src/support-v3.css', 'utf8'),
  readFile('src-tauri/src/app.rs', 'utf8')
]);

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

requireMatch(windows, /pub fn hide_main_window\(app: AppHandle\)[\s\S]*?app\.exit\(0\);/, 'La X debe cerrar el proceso, no ocultarlo.');
requireMatch(app, /WindowEvent::CloseRequested[\s\S]*?close_app\.exit\(0\);/, 'Cerrar la ventana nativa también debe terminar NEXO.');
requireMatch(support, /aria-label="Cerrar NEXO"[\s\S]*?safeInvoke\('exit_app'\)/, 'La X visual debe invocar exit_app.');
requireMatch(updater, /status: 'available'/, 'Falta el estado de actualización disponible.');
requireMatch(updater, /Actualizar ahora/, 'Falta el botón “Actualizar ahora”.');
requireMatch(updater, /Más tarde/, 'Falta el botón “Más tarde”.');
requireMatch(updaterCss, /\.app-update-dialog/, 'Falta el diálogo visual de actualización.');
requireMatch(updates, /download_and_install[\s\S]*?app\.restart\(\);/, 'NEXO debe reiniciarse después de instalar la actualización.');
requireMatch(support, /nc-readings/, 'La home debe mostrar lecturas compactas e interactivas.');
requireMatch(support, /Liberar espacio/, 'La app debe ofrecer acciones útiles, no solo mostrar datos.');
requireMatch(supportCss, /font-size:\s*12px/, 'La interfaz compacta debe conservar texto legible.');
if (/ÚLTIMA REVISIÓN/.test(support)) throw new Error('La home no debe repetir un bloque alto de última revisión.');

console.log('Product contracts passed: real close, explicit updater, compact readable home, interactive readings and useful actions.');
