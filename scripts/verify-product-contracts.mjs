import { readFile, stat } from 'node:fs/promises';

const [
  main,
  support,
  supportCss,
  agentCss,
  assistant,
  supportRun,
  admin,
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
  edgeFunction,
  deployAgent,
  secureSql,
  releaseWorkflow,
  validateWorkflow,
  smoke
] = await Promise.all([
  readFile('src/main.tsx', 'utf8'),
  readFile('src/SupportAppV6.tsx', 'utf8'),
  readFile('src/support-v7.css', 'utf8'),
  readFile('src/support-agent.css', 'utf8'),
  readFile('src/lib/assistant.ts', 'utf8'),
  readFile('src/lib/support-run.ts', 'utf8'),
  readFile('src/AdminApp.tsx', 'utf8'),
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
  readFile('supabase/functions/nexo-assistant/index.ts', 'utf8'),
  readFile('.github/workflows/deploy-agent.yml', 'utf8'),
  readFile('infra/supabase/secure-agent.sql', 'utf8'),
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
requireMatch(main, /support-v7\.css[\s\S]*support-agent\.css/, 'La capa visual del agente debe cargarse.');
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

requireMatch(support, /shareDiagnostics: false/, 'Compartir diagnósticos debe iniciar desactivado.');
requireMatch(support, /Elegí cómo usar NEXO/, 'La activación debe pedir consentimiento explícito.');
requireMatch(support, /requestAssistant\(/, 'La superficie activa debe usar el agente remoto.');
requireMatch(support, /setPendingApproval/, 'Los cambios deben esperar autorización visible.');
requireMatch(support, /TOOL_CATALOG\[pendingApproval\.call\.function\.name\]/, 'La confirmación debe mostrar una acción del catálogo.');
requireMatch(support, /persistRun/, 'Cada sesión debe guardar un reporte.');
requireMatch(supportRun, /kind: 'nexo-support-run'/, 'Los reportes deben tener un tipo estable.');
requireMatch(supportRun, /diagnosticDelta/, 'Los reportes deben comparar antes y después.');
requireMatch(agentCss, /\.nv-approval/, 'Falta la confirmación compacta del agente.');
requireMatch(agentCss, /\.nv-agent-flight/, 'Falta el progreso compacto de optimización.');
requireMatch(assistant, /functions\/v1\/nexo-assistant/, 'El desktop debe derivar el endpoint seguro de Supabase.');
requireMatch(assistant, /AbortController/, 'Las llamadas al agente deben tener timeout.');
requireMatch(edgeFunction, /parallel_tool_calls:\s*false/, 'El agente debe pedir una sola herramienta por turno.');
requireMatch(edgeFunction, /allowedTools/, 'El servidor debe filtrar herramientas.');
requireMatch(edgeFunction, /share_diagnostics/, 'El servidor debe respetar el consentimiento.');
forbidMatch(edgeFunction, /powershell|cmd\.exe|regedit/i, 'El modelo no puede recibir una herramienta de comandos arbitrarios.');
requireMatch(deployAgent, /OPENROUTER_API_KEY/, 'El despliegue debe usar la clave como secreto del servidor.');
requireMatch(deployAgent, /database\/query/, 'El despliegue debe aplicar la migración de seguridad.');
requireMatch(deployAgent, /functions deploy nexo-assistant/, 'El agente debe desplegarse automáticamente.');
requireMatch(secureSql, /ticket_id[\s\S]*device_id = device_row\.id/, 'La sesión remota debe quedar ligada a su propia PC.');
requireMatch(admin, /isSupportRunPayload/, 'Control debe leer reportes del agente.');
requireMatch(admin, /managed_connect_remote_tool/, 'Control debe abrir la solicitud remota.');
requireMatch(admin, /setInterval\(\(\) => void refresh\(true\), 5000\)/, 'Control debe actualizar solicitudes sin intervención.');

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
requireMatch(support, /optimizerPhase === 'cleaning' && <RocketStage/, 'El cohete manual debe aparecer solamente al limpiar.');
requireMatch(support, /busy === 'Optimizando' && <AgentRocket/, 'El agente debe mostrar un solo cohete durante la limpieza.');
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
requireMatch(remote, /managed_connect_remote_tool[\s\S]*?--connect/, 'Control debe abrir RustDesk con el ID solicitado.');
requireMatch(remote, /normalize_remote_id/, 'El ID remoto debe validarse antes de abrirlo.');
requireMatch(remoteSupport, /id\?: string \| null/, 'La UI debe recibir el ID remoto.');
requireMatch(support, /issue: status\.id \? `Soporte remoto · RustDesk \$\{status\.id\}`/, 'La solicitud debe incluir el ID remoto.');
requireMatch(support, /createTicket[\s\S]*?createRemoteSession[\s\S]*?openRemoteTool/, 'Soporte remoto debe guardar la solicitud antes de abrir RustDesk.');
requireMatch(validateWorkflow, /prepare-rustdesk\.ps1/, 'CI debe construir el paquete con RustDesk.');
requireMatch(releaseWorkflow, /prepare-rustdesk\.ps1/, 'El release debe construir el paquete con RustDesk.');

requireMatch(nativeSensors, /value >= 5\.0[\s\S]*?value <= 125\.0/, 'Los sensores deben descartar temperaturas imposibles.');
requireMatch(sensors, /temperatureTrusted/, 'La UI debe distinguir lecturas térmicas confiables.');
requireMatch(diagnostics, /CREATE_NO_WINDOW/, 'PowerShell no debe abrir consolas.');
requireMatch(app, /optimizer::optimize_temp_files/, 'El comando de optimización debe estar registrado.');
requireMatch(app, /remote::managed_connect_remote_tool/, 'El comando remoto seguro debe estar registrado.');
requireMatch(evidence, /Memoria[\s\S]*?Disco[\s\S]*?Seguridad/, 'El estado general debe mostrar evidencia concreta.');

requireMatch(updater, /const CHECK_EVERY_MS = 60 \* 1000/, 'NEXO debe buscar actualizaciones sin reiniciar.');
requireMatch(updater, /Actualizando NEXO/, 'La actualización debe tener una etapa visual propia.');
requireMatch(updater, /Math\.round\(progress\)/, 'El actualizador debe mostrar progreso.');
requireMatch(updaterCss, /\.app-update-stage/, 'Falta la escena visual de actualización.');
forbidMatch(updater, /release\.notes|Cambios incluidos|Cerrar NEXO/, 'El updater volvió a mostrar texto innecesario.');

requireMatch(releaseWorkflow, /VITE_SUPABASE_URL/, 'El release debe recibir la URL del backend.');
requireMatch(releaseWorkflow, /VITE_SUPABASE_ANON_KEY/, 'El release debe recibir la clave pública del backend.');
forbidMatch(support, /setTimeout\([^)]*runOverview|setTimeout\([^)]*runTemperature/, 'La app no debe analizar automáticamente.');

for (const shot of ['support-consent.png', 'support-agent-approval.png', 'support-agent-progress.png', 'support-agent-done.png', 'support-tools-minimal.png', 'support-remote-ready.png']) {
  requireMatch(smoke, new RegExp(shot.replace('.', '\\.')), `Falta la captura ${shot}.`);
}
requireMatch(smoke, /payload\?\.kind === 'nexo-support-run'/, 'El smoke debe comprobar que el reporte llegó al backend.');

const icon = await stat('src-tauri/icons/icon.ico');
if (icon.size < 1000 || icon.size > 100000) throw new Error(`Icono inválido: ${icon.size} bytes.`);

console.log('Product contracts passed: explicit consent, allowlisted AI agent, auditable reports, verified optimization and accepted RustDesk support.');
