import { readFile } from 'node:fs/promises';

const [
  updater,
  updaterCss,
  windows,
  updates,
  support,
  supportCss,
  app,
  actions,
  diagnostics,
  nativeSensors,
  sensorReader,
  sensors,
  remoteSupport,
  tauriConfig,
  releaseWorkflow
] = await Promise.all([
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
  readFile('tools/Nexo.SensorReader/Program.cs', 'utf8'),
  readFile('src/lib/sensors.ts', 'utf8'),
  readFile('src/lib/support.ts', 'utf8'),
  readFile('src-tauri/tauri.conf.json', 'utf8'),
  readFile('.github/workflows/publish-release.yml', 'utf8')
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
requireMatch(sensorReader, /var permissionRequired = !elevated && !hasTemperature;/, 'La ausencia de CPU no debe clasificarse automáticamente como un problema de permisos.');
requireMatch(sensorReader, /for \(var attempt = 0; attempt < 3; attempt\+\+\)/, 'El lector debe dar tiempo a que los sensores publiquen valores.');
requireMatch(sensors, /systemTemperatureC/, 'La UI debe reconocer temperaturas de placa madre y ACPI, no ignorarlas.');
requireMatch(sensors, /snapshot\.source !== 'acpi-fallback'/, 'Una zona ACPI aproximada no puede tratarse como temperatura exacta.');
requireMatch(support, /captureSensors\(true\)/, 'Una revisión manual debe reintentar con autorización cuando no aparecen sensores.');
requireMatch(support, /Reintentar como administrador/, 'La UI debe explicar claramente cómo recuperar la lectura térmica.');
forbidMatch(support, /Requiere Windows/, 'No se debe mostrar el texto confuso “Requiere Windows”.');
requireMatch(support, /temperatura todavía no pudo comprobarse/, 'Sin temperatura confiable, la home no debe declarar que la PC está en orden.');

requireMatch(actions, /pub fn remote_tool_status/, 'NEXO debe poder informar si RustDesk está instalado.');
requireMatch(actions, /find_rustdesk[\s\S]*?LOCALAPPDATA[\s\S]*?ProgramFiles/, 'La detección de RustDesk debe buscar instalaciones habituales de Windows.');
requireMatch(remoteSupport, /getRemoteToolStatus/, 'La interfaz debe consultar la disponibilidad de RustDesk.');
requireMatch(support, /RustDesk detectado/, 'La UI debe mostrar claramente el estado del escritorio remoto.');
requireMatch(support, /La conexión nunca empieza sola/, 'El escritorio remoto debe requerir autorización visible del usuario.');

requireMatch(tauriConfig, /"width": 500[\s\S]*?"height": 620/, 'La ventana principal no debe volver a ser un popup excesivamente compacto.');
requireMatch(tauriConfig, /"resizable": true/, 'NEXO debe comportarse como una aplicación de escritorio redimensionable.');
requireMatch(tauriConfig, /"skipTaskbar": false/, 'La aplicación principal debe aparecer normalmente en la barra de tareas.');
requireMatch(supportCss, /\.nc-backdrop[\s\S]*?place-items:\s*center/, 'Los diálogos deben aparecer centrados, no como sheets que cubren toda la ventana.');
requireMatch(supportCss, /\.nc-sheet[\s\S]*?width:\s*min\(100%,\s*420px\)/, 'Los diálogos deben conservar un ancho máximo de escritorio.');
forbidMatch(supportCss, /\.nc-backdrop[^}]*align-items:\s*flex-end/, 'No se permiten popups pegados al borde inferior que parezcan ocupar toda la app.');
requireMatch(supportCss, /\.nc-readings[\s\S]*?grid-template-columns:\s*1fr 1fr/, 'Las métricas deben tener espacio legible en una grilla 2x2.');
requireMatch(support, /Resolver problemas comunes/, 'La home debe separar estado y acciones con jerarquía visual clara.');
requireMatch(support, /Liberar espacio/, 'La app debe ofrecer acciones útiles, no solo mostrar datos.');
forbidMatch(support, /initialCheckStarted/, 'NEXO no debe iniciar una revisión pesada automáticamente al abrir.');
forbidMatch(support, /setTimeout\(\(\) => void inspect\(false\),\s*300\)/, 'NEXO no debe ejecutar sensores automáticamente al abrir.');

requireMatch(releaseWorkflow, /node scripts\/verify-product-contracts\.mjs/, 'El release debe verificar los contratos de producto antes de publicarse.');
requireMatch(releaseWorkflow, /scripts\/smoke-ui\.mjs/, 'El release debe validar la interfaz real antes de publicarse.');

console.log('Product contracts passed: live updates, guaranteed exit, normal desktop layout, centered dialogs, sensor recovery, reliable admin, authorized RustDesk support and gated signed releases.');
