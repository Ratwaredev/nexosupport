import { readFile } from 'node:fs/promises';

const [updater, updaterCss, windows, updates, support, supportCss, app, actions, diagnostics, nativeSensors, sensors, remoteSupport, releaseWorkflow, smoke] = await Promise.all([
  readFile('src/AppUpdater.tsx', 'utf8'),
  readFile('src/updater.css', 'utf8'),
  readFile('src-tauri/src/app/windows.rs', 'utf8'),
  readFile('src-tauri/src/app/updates.rs', 'utf8'),
  readFile('src/SupportAppV3.tsx', 'utf8'),
  readFile('src/support-v3.css', 'utf8'),
  readFile('src-tauri/src/app.rs', 'utf8'),
  readFile('src-tauri/src/app/actions.rs', 'utf8'),
  readFile('src-tauri/src/app/diagnostics.rs', 'utf8'),
  readFile('src-tauri/src/app/sensors.rs', 'utf8'),
  readFile('src/lib/sensors.ts', 'utf8'),
  readFile('src/lib/support.ts', 'utf8'),
  readFile('.github/workflows/publish-release.yml', 'utf8'),
  readFile('scripts/smoke-ui.mjs', 'utf8')
]);

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbidMatch(source, pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(windows, /pub fn hide_main_window\(app: AppHandle\)[\s\S]*?app\.exit\(0\);/, 'La X debe cerrar el proceso, no ocultarlo.');
requireMatch(app, /WindowEvent::CloseRequested[\s\S]*?close_app\.exit\(0\);/, 'Cerrar la ventana nativa también debe terminar NEXO.');
requireMatch(support, /aria-label="Cerrar NEXO"[\s\S]*?safeInvoke\('exit_app'\)/, 'La X visual debe invocar exit_app.');
requireMatch(windows, /WebviewUrl::App\("admin\.html"\.into\(\)\)[\s\S]*?visible\(true\)/, 'NEXO Control debe crearse visible y enfocarse.');
requireMatch(updater, /Cerrar NEXO/, 'El diálogo de actualización debe permitir cerrar la aplicación.');
requireMatch(updater, /safeInvoke\('exit_app'\)/, 'El cierre desde el diálogo de actualización debe terminar el proceso.');
requireMatch(updaterCss, /\.app-update-close-app/, 'Falta el control visual para cerrar NEXO desde el actualizador.');
requireMatch(app, /MenuItem::with_id\(app, "quit", "Cerrar NEXO"/, 'La bandeja debe ofrecer una salida de emergencia visible.');
requireMatch(app, /"quit" => app\.exit\(0\)/, 'Cerrar NEXO desde la bandeja debe terminar el proceso.');

requireMatch(updater, /const CHECK_EVERY_MS = 60 \* 1000;/, 'NEXO debe consultar actualizaciones mientras permanece abierto.');
requireMatch(updater, /window\.addEventListener\('online'/, 'NEXO debe volver a consultar actualizaciones al recuperar Internet.');
requireMatch(updater, /nexo:check-update-passive/, 'NEXO debe consultar actualizaciones al volver a mostrarse desde la bandeja.');
requireMatch(windows, /nexo:check-update-passive/, 'La ventana nativa debe solicitar una revisión al volver a mostrarse.');
requireMatch(app, /"check-update"[\s\S]*?reveal_main_window\(app, true\)/, 'La bandeja debe permitir buscar actualizaciones sin reiniciar NEXO.');

requireMatch(updater, /status: 'available'/, 'Falta el estado de actualización disponible.');
requireMatch(updater, /Actualizar ahora/, 'Falta el botón “Actualizar ahora”.');
requireMatch(updater, /Más tarde/, 'Falta el botón “Más tarde”.');
requireMatch(updaterCss, /\.app-update-dialog/, 'Falta el diálogo visual de actualización.');
requireMatch(updates, /download_and_install[\s\S]*?app\.restart\(\);/, 'NEXO debe reiniciarse después de instalar la actualización.');

requireMatch(actions, /pub async fn run_agent_action[\s\S]*?spawn_blocking/, 'Las acciones del sistema deben ejecutarse fuera del hilo de interfaz.');
requireMatch(diagnostics, /CREATE_NO_WINDOW/, 'PowerShell debe ejecutarse sin abrir una consola.');
requireMatch(actions, /CREATE_NO_WINDOW/, 'Las herramientas y RustDesk deben abrirse sin una consola intermedia.');
forbidMatch(actions, /Command::new\("cmd"\)[\s\S]{0,180}\/C/, 'No se permite abrir herramientas mediante cmd /C start.');

requireMatch(nativeSensors, /value >= 5\.0[\s\S]*?value <= 125\.0/, 'La capa nativa debe descartar temperaturas físicamente imposibles.');
requireMatch(sensors, /temperatureTrusted/, 'La interfaz debe distinguir una lectura térmica confiable de una aproximada.');
requireMatch(sensors, /snapshot\.source !== 'acpi-fallback'/, 'Una zona ACPI aproximada no puede tratarse como temperatura exacta.');
requireMatch(support, /Reintentar como administrador/, 'La lectura térmica debe ofrecer un reintento elevado explícito.');

requireMatch(actions, /pub fn remote_tool_status/, 'NEXO debe poder informar si RustDesk está instalado.');
requireMatch(actions, /find_rustdesk[\s\S]*?LOCALAPPDATA[\s\S]*?ProgramFiles/, 'La detección de RustDesk debe buscar instalaciones habituales de Windows.');
requireMatch(remoteSupport, /getRemoteToolStatus/, 'La interfaz debe consultar la disponibilidad de RustDesk.');
requireMatch(support, /RustDesk detectado/, 'La UI debe mostrar claramente el estado del escritorio remoto.');
requireMatch(support, /La conexión nunca empieza sola/, 'El escritorio remoto debe requerir autorización visible del usuario.');

requireMatch(support, /type View = 'assistant' \| 'tools'/, 'La app debe tener exactamente una vista de asistente y una de herramientas.');
requireMatch(support, /nc-view-switch/, 'Falta el selector Asistente/Herramientas.');
requireMatch(support, /Hola\. Soy NEXO/, 'El asistente debe ser la experiencia principal al abrir.');
requireMatch(support, /nc-thread/, 'La vista principal debe ser una conversación real.');
requireMatch(support, /nc-composer/, 'La conversación debe tener un compositor propio.');
requireMatch(support, /toolGroups/, 'Las herramientas deben vivir en una sección separada.');
requireMatch(support, /TOOL_CATALOG\[pendingAction\.id\]/, 'Las acciones con cambios deben confirmarse dentro del chat.');
requireMatch(support, /completeToolInChat/, 'El asistente debe ejecutar y devolver resultados dentro de la conversación.');
requireMatch(supportCss, /\.nc-chat-view[\s\S]*?grid-template-rows/, 'La vista de chat debe ocupar el espacio principal sin dashboard intermedio.');
requireMatch(supportCss, /\.nc-tools-view/, 'Falta la vista visual de herramientas.');
requireMatch(supportCss, /\.nc-message\.user/, 'Falta diferenciación visual entre usuario y asistente.');
forbidMatch(support, /nc-readings|nc-hero|ACCIONES RÁPIDAS|ESTADO DEL EQUIPO/, 'No debe volver el dashboard cargado de métricas y bloques.');
forbidMatch(supportCss, /\.nc-readings|\.nc-hero/, 'No deben quedar estilos del dashboard anterior.');

requireMatch(windows, /PhysicalPosition/, 'La app debe poder ubicarse como asistente lateral.');
requireMatch(windows, /monitor_size\.width[\s\S]*?size\.width/, 'La ventana debe alinearse al borde derecho del monitor.');
requireMatch(smoke, /support-chat\.png/, 'La validación visual debe capturar la vista principal del chatbot.');
requireMatch(smoke, /support-tools\.png/, 'La validación visual debe capturar la sección de herramientas.');
requireMatch(smoke, /support-confirm\.png/, 'La validación visual debe comprobar confirmaciones dentro del chat.');

forbidMatch(support, /initialCheckStarted/, 'NEXO no debe iniciar una revisión pesada automáticamente al abrir.');
forbidMatch(support, /setTimeout\(\(\) => void inspect\(false\),\s*300\)/, 'NEXO no debe ejecutar sensores automáticamente al abrir.');

requireMatch(releaseWorkflow, /node scripts\/verify-product-contracts\.mjs/, 'El release debe verificar los contratos de producto antes de publicarse.');
requireMatch(releaseWorkflow, /scripts\/smoke-ui\.mjs/, 'El release debe validar la interfaz real antes de publicarse.');

console.log('Product contracts passed: chatbot-first UX, separate minimal tools, inline confirmations, lateral desktop window, reliable sensors, authorized support and gated releases.');
