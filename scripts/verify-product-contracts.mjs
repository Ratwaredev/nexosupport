import { readFile } from 'node:fs/promises';

const [updater, updaterCss, windows, updates, support, supportCss, app, actions, diagnostics, nativeSensors, sensors, remoteSupport, releaseWorkflow] = await Promise.all([
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
requireMatch(support, /Sin alertas críticas[\s\S]*?temperatura aún no fue verificada/, 'Sin temperatura confiable, la home no debe declarar que la PC está en orden.');
forbidMatch(support, /summary\?\.cpuTemperatureC \?\? 0\)[\s\S]{0,100}>= 88/, 'Una temperatura ausente no debe convertirse silenciosamente en 0 °C.');

requireMatch(actions, /pub fn remote_tool_status/, 'NEXO debe poder informar si RustDesk está instalado.');
requireMatch(actions, /find_rustdesk[\s\S]*?LOCALAPPDATA[\s\S]*?ProgramFiles/, 'La detección de RustDesk debe buscar instalaciones habituales de Windows.');
requireMatch(remoteSupport, /getRemoteToolStatus/, 'La interfaz debe consultar la disponibilidad de RustDesk.');
requireMatch(support, /RustDesk detectado/, 'La UI debe mostrar claramente el estado del escritorio remoto.');
requireMatch(support, /La conexión nunca empieza sola/, 'El escritorio remoto debe requerir autorización visible del usuario.');

requireMatch(support, /nc-readings/, 'La home debe mostrar lecturas compactas e interactivas.');
requireMatch(support, /Liberar espacio/, 'La app debe ofrecer acciones útiles, no solo mostrar datos.');
requireMatch(supportCss, /font-size:\s*12px/, 'La interfaz compacta debe conservar texto legible.');
requireMatch(supportCss, /\.nc-readings[\s\S]*?border-right/, 'Las métricas deben compartir una grilla alineada en lugar de cards sueltas.');
forbidMatch(support, /initialCheckStarted/, 'NEXO no debe iniciar una revisión pesada automáticamente al abrir.');
forbidMatch(support, /setTimeout\(\(\) => void inspect\(false\),\s*300\)/, 'NEXO no debe ejecutar sensores automáticamente al abrir.');
if (/ÚLTIMA REVISIÓN/.test(support)) throw new Error('La home no debe repetir un bloque alto de última revisión.');

requireMatch(releaseWorkflow, /node scripts\/verify-product-contracts\.mjs/, 'El release debe verificar los contratos de producto antes de publicarse.');
requireMatch(releaseWorkflow, /scripts\/smoke-ui\.mjs/, 'El release debe validar la interfaz real antes de publicarse.');

console.log('Product contracts passed: responsive runtime, hidden Windows processes, trusted sensors, reliable admin, authorized RustDesk support, compact UI and gated signed releases.');
