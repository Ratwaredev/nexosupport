import { readFile, stat } from 'node:fs/promises';

const [
  main,
  support,
  supportCss,
  updater,
  updaterCss,
  windows,
  app,
  optimizer,
  agent,
  remote,
  remoteSupport,
  tauriConfig,
  hooks,
  rustdeskScript,
  diagnostics,
  nativeSensors,
  sensors,
  evidence,
  releaseWorkflow,
  validateWorkflow,
  smoke
] = await Promise.all([
  readFile('src/main.tsx', 'utf8'),
  readFile('src/SupportAppV6.tsx', 'utf8'),
  readFile('src/support-v7.css', 'utf8'),
  readFile('src/AppUpdater.tsx', 'utf8'),
  readFile('src/updater.css', 'utf8'),
  readFile('src-tauri/src/app/windows.rs', 'utf8'),
  readFile('src-tauri/src/app.rs', 'utf8'),
  readFile('src-tauri/src/app/optimizer.rs', 'utf8'),
  readFile('src/lib/agent.ts', 'utf8'),
  readFile('src-tauri/src/app/remote.rs', 'utf8'),
  readFile('src/lib/support.ts', 'utf8'),
  readFile('src-tauri/tauri.conf.json', 'utf8'),
  readFile('src-tauri/windows/hooks.nsh', 'utf8'),
  readFile('scripts/prepare-rustdesk.ps1', 'utf8'),
  readFile('src-tauri/src/app/diagnostics.rs', 'utf8'),
  readFile('tools/Nexo.SensorReader/Program.cs', 'utf8'),
  readFile('src/lib/sensors.ts', 'utf8'),
  readFile('src/lib/tool-evidence.ts', 'utf8'),
  readFile('.github/workflows/publish-release.yml', 'utf8'),
  readFile('.github/workflows/validate-windows.yml', 'utf8'),
  readFile('scripts/smoke-ui.mjs', 'utf8')
]);

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}
function forbidMatch(source, pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(main, /SupportAppV6/, 'SupportAppV6 debe ser la superficie activa.');
requireMatch(main, /support-v7\.css/, 'La UI simplificada debe cargarse en producción.');
requireMatch(support, /type View = 'assistant' \| 'tools'/, 'Solo Asistente y Herramientas deben ser superficies principales.');
for (const title of ['Estado general', 'Temperatura', 'Internet', 'Seguridad', 'Inicio', 'Optimizar', 'Soporte remoto']) {
  requireMatch(support, new RegExp(`title: '${title}'`), `Falta la herramienta ${title}.`);
}
requireMatch(supportCss, /\.nv-tools\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/, 'Herramientas debe reservar espacio para la lista.');
requireMatch(supportCss, /\.nv-tool-grid\{[^}]*overflow-y:auto/, 'La lista de herramientas debe tener scroll real.');
requireMatch(support, /onClick=\{\(\) => setSelected\(tool\.id\)\}/, 'Tocar una herramienta debe abrirla sin ejecutar análisis.');
requireMatch(support, /data-tauri-drag-region/, 'La barra superior debe mover la ventana.');
requireMatch(support, /safeInvoke\('hide_main_window'\)/, 'La X debe ocultar NEXO en la bandeja.');
forbidMatch(support, /Sin analizar|Detectar y abrir RustDesk|Navegadores protegidos|No se borran cookies|La nave está eliminando|lista blanca/, 'La UI volvió a llenarse de texto explicativo.');

requireMatch(windows, /monitor\.work_area\(\)/, 'La posición debe usar el área de trabajo y no tapar la barra de tareas.');
requireMatch(windows, /work_size\.height[\s\S]*?size\.height/, 'La esquina inferior debe calcularse con el alto útil.');
requireMatch(windows, /window\.hide\(\)/, 'Cerrar debe ocultar el popup.');
requireMatch(windows, /window\.minimize\(\)/, 'Minimizar debe usar Windows.');
requireMatch(app, /WindowEvent::CloseRequested[\s\S]*?prevent_close[\s\S]*?popup\.hide/, 'Alt+F4 debe ocultar el popup.');
requireMatch(app, /"quit" => app\.exit\(0\)/, 'La bandeja debe ofrecer salida real.');

requireMatch(optimizer, /Channel<OptimizerProgress>/, 'El optimizador nativo debe transmitir progreso.');
requireMatch(optimizer, /percent:\s*u8/, 'El progreso debe tener porcentaje estructurado.');
requireMatch(optimizer, /send_progress\(&channel, 0/, 'La limpieza debe empezar en 0%.');
requireMatch(optimizer, /send_progress\(&channel, 100/, 'La limpieza debe terminar en 100%.');
requireMatch(agent, /new Channel<OptimizerProgress>/, 'El frontend debe recibir el canal nativo.');
requireMatch(support, /optimizerPhase === 'cleaning' && <RocketStage/, 'El cohete debe aparecer solamente al limpiar.');
requireMatch(support, /optimizerPhase === 'scanning' && <ScanStage/, 'El análisis previo debe usar feedback sin cohete.');
requireMatch(support, /progress\.percent/, 'La UI debe mostrar el porcentaje real.');
requireMatch(supportCss, /\.nv-progress/, 'Falta la barra de progreso del optimizador.');
requireMatch(optimizer, /checked_sub\(Duration::from_secs\(24 \* 60 \* 60\)\)/, 'Solo deben limpiarse temporales de más de 24 horas.');
requireMatch(optimizer, /follow_links\(false\)/, 'La limpieza no debe seguir enlaces.');
for (const safeRoot of ['TEMP', 'WINDIR', 'CrashDumps', 'ProgramData']) requireMatch(optimizer, new RegExp(safeRoot), `Falta ${safeRoot}.`);
forbidMatch(optimizer, /Chrome|Edge|Firefox|Brave|User Data|Login Data|Web Data|Cookies/, 'La limpieza no puede entrar a perfiles de navegador.');

requireMatch(rustdeskScript, /rustdesk-\$Version-x86_64\.exe/, 'El build debe descargar el cliente oficial x86_64.');
requireMatch(rustdeskScript, /Get-FileHash[\s\S]*SHA256/, 'El binario de RustDesk debe verificarse.');
requireMatch(tauriConfig, /resources\/rustdesk/, 'RustDesk debe viajar dentro del instalador.');
requireMatch(tauriConfig, /installerHooks/, 'El instalador debe ejecutar el hook de dependencias.');
requireMatch(tauriConfig, /"installMode": "perMachine"/, 'La instalación debe ejecutarse con permisos suficientes.');
requireMatch(hooks, /NSIS_HOOK_POSTINSTALL[\s\S]*?--silent-install/, 'NEXO debe instalar RustDesk durante su propia instalación.');
requireMatch(remote, /pub async fn managed_install_remote_tool/, 'Debe existir un reintento desde la app.');
requireMatch(remote, /--get-id/, 'NEXO debe leer el ID de RustDesk.');
requireMatch(remoteSupport, /id\?: string \| null/, 'La UI debe recibir el ID remoto.');
requireMatch(support, /issue: status\.id \? `Soporte remoto · RustDesk \$\{status\.id\}`/, 'La solicitud debe incluir el ID remoto.');
requireMatch(support, /createTicket[\s\S]*?createRemoteSession[\s\S]*?openRemoteTool/, 'Soporte remoto debe guardar la solicitud antes de abrir RustDesk.');
requireMatch(validateWorkflow, /prepare-rustdesk\.ps1/, 'CI debe construir el paquete con RustDesk.');
requireMatch(releaseWorkflow, /prepare-rustdesk\.ps1/, 'El release debe construir el paquete con RustDesk.');

requireMatch(nativeSensors, /value >= 5\.0[\s\S]*?value <= 125\.0/, 'Los sensores deben descartar temperaturas imposibles.');
requireMatch(sensors, /temperatureTrusted/, 'La UI debe distinguir lecturas térmicas confiables.');
requireMatch(diagnostics, /CREATE_NO_WINDOW/, 'PowerShell no debe abrir consolas.');
requireMatch(app, /optimizer::optimize_temp_files/, 'El comando de optimización debe estar registrado.');
requireMatch(app, /remote::managed_install_remote_tool/, 'El instalador remoto debe estar registrado.');
requireMatch(evidence, /Memoria[\s\S]*?Disco[\s\S]*?Seguridad/, 'El estado general debe mostrar evidencia concreta.');

requireMatch(updater, /const CHECK_EVERY_MS = 60 \* 1000/, 'NEXO debe buscar actualizaciones sin reiniciar.');
requireMatch(updater, /Actualizando NEXO/, 'La actualización debe tener una etapa visual propia.');
requireMatch(updater, /Math\.round\(progress\)/, 'El actualizador debe mostrar progreso.');
requireMatch(updaterCss, /\.app-update-stage/, 'Falta la escena visual de actualización.');
forbidMatch(updater, /release\.notes|Cambios incluidos|Cerrar NEXO/, 'El updater volvió a mostrar texto innecesario.');

requireMatch(releaseWorkflow, /VITE_SUPABASE_URL/, 'El release debe recibir la URL del backend.');
requireMatch(releaseWorkflow, /VITE_SUPABASE_ANON_KEY/, 'El release debe recibir la clave pública del backend.');
requireMatch(releaseWorkflow, /VITE_DEFAULT_PAIRING_CODE/, 'El release debe permitir un código preconfigurado.');
forbidMatch(support, /setTimeout\([^)]*runOverview|setTimeout\([^)]*runTemperature/, 'La app no debe analizar automáticamente.');

for (const shot of ['support-tools-minimal.png', 'support-optimizer-scan.png', 'support-optimizer-flight.png', 'support-optimizer-done.png', 'support-remote-ready.png', 'support-chat-evidence.png']) {
  requireMatch(smoke, new RegExp(shot.replace('.', '\\.')), `Falta la captura ${shot}.`);
}

const icon = await stat('src-tauri/icons/icon.ico');
if (icon.size < 1000 || icon.size > 100000) throw new Error(`Icono inválido: ${icon.size} bytes.`);

console.log('Product contracts passed: minimal desktop UI, taskbar-safe popup, real optimizer progress, bundled RustDesk, connected support records and quiet updates.');
