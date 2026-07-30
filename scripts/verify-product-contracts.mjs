import { readFile } from 'node:fs/promises';

const [
  updater,
  updaterCss,
  windows,
  updates,
  support,
  supportCss,
  supportExtraCss,
  main,
  app,
  actions,
  diagnostics,
  nativeSensors,
  sensors,
  assistant,
  evidence,
  remoteSupport,
  releaseWorkflow,
  smoke
] = await Promise.all([
  readFile('src/AppUpdater.tsx', 'utf8'),
  readFile('src/updater.css', 'utf8'),
  readFile('src-tauri/src/app/windows.rs', 'utf8'),
  readFile('src-tauri/src/app/updates.rs', 'utf8'),
  readFile('src/SupportAppV5.tsx', 'utf8'),
  readFile('src/support-v4.css', 'utf8'),
  readFile('src/support-v5.css', 'utf8'),
  readFile('src/main.tsx', 'utf8'),
  readFile('src-tauri/src/app.rs', 'utf8'),
  readFile('src-tauri/src/app/actions.rs', 'utf8'),
  readFile('src-tauri/src/app/diagnostics.rs', 'utf8'),
  readFile('src-tauri/src/app/sensors.rs', 'utf8'),
  readFile('src/lib/sensors.ts', 'utf8'),
  readFile('src/lib/assistant.ts', 'utf8'),
  readFile('src/lib/tool-evidence.ts', 'utf8'),
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

// Exit and updater must never trap the user.
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
requireMatch(updates, /download_and_install[\s\S]*?app\.restart\(\);/, 'NEXO debe reiniciarse después de instalar la actualización.');

// Native work must stay off the UI thread and never open consoles.
requireMatch(actions, /pub async fn run_agent_action[\s\S]*?spawn_blocking/, 'Las acciones del sistema deben ejecutarse fuera del hilo de interfaz.');
requireMatch(diagnostics, /CREATE_NO_WINDOW/, 'PowerShell debe ejecutarse sin abrir una consola.');
requireMatch(actions, /CREATE_NO_WINDOW/, 'Las herramientas y RustDesk deben abrirse sin una consola intermedia.');
forbidMatch(actions, /Command::new\("cmd"\)[\s\S]{0,180}\/C/, 'No se permite abrir herramientas mediante cmd /C start.');

// Sensors must report evidence instead of inventing success.
requireMatch(nativeSensors, /value >= 5\.0[\s\S]*?value <= 125\.0/, 'La capa nativa debe descartar temperaturas físicamente imposibles.');
requireMatch(sensors, /temperatureTrusted/, 'La interfaz debe distinguir una lectura térmica confiable de una aproximada.');
requireMatch(sensors, /snapshot\.source !== 'acpi-fallback'/, 'Una zona ACPI aproximada no puede tratarse como temperatura exacta.');
requireMatch(support, /Reintentar como administrador/, 'La lectura térmica debe ofrecer un reintento elevado explícito.');
requireMatch(evidence, /temperatureRecord[\s\S]*?cpuTemperatureC[\s\S]*?gpuTemperatureC[\s\S]*?storageTemperatureC/, 'La temperatura debe devolver valores estructurados por componente.');

// The active surface must be the working assistant, not the superseded dashboard.
requireMatch(main, /import\('\.\/SupportAppV5'\)/, 'La aplicación debe montar la implementación de agente con evidencia.');
requireMatch(main, /<SupportAppV5 \/>/, 'SupportAppV5 debe ser la superficie activa.');
requireMatch(support, /type View = 'assistant' \| 'tools'/, 'La app debe mantener únicamente Asistente y Herramientas como superficies principales.');
requireMatch(support, /setSelectedTool\(tool\.id\)/, 'Los botones deben abrir el detalle de la herramienta sin ejecutar ni saltar al chat.');
requireMatch(support, /Todavía no hay datos/, 'Una herramienta sin evidencia debe mostrar un estado vacío honesto.');
requireMatch(support, /Analizar ahora/, 'Cada herramienta debe permitir ejecutar el análisis explícitamente.');
requireMatch(support, /Actualizar análisis/, 'Las herramientas deben permitir actualizar datos existentes.');
requireMatch(support, /records\.overview|records\[selectedTool\]/, 'La interfaz debe conservar resultados estructurados por herramienta.');
requireMatch(support, /isFresh\(/, 'El agente debe reutilizar datos recientes antes de volver a analizar.');
requireMatch(support, /recordChatText\(/, 'El chat debe responder con evidencia estructurada, no con frases genéricas.');
requireMatch(evidence, /Memoria[\s\S]*?Disco[\s\S]*?Seguridad[\s\S]*?Reinicio pendiente/, 'El diagnóstico general debe exponer valores comprobables.');
requireMatch(evidence, /Adaptador[\s\S]*?Gateway[\s\S]*?DNS[\s\S]*?Salida a Internet/, 'La revisión de red debe exponer la evidencia obtenida.');
requireMatch(evidence, /Servicio[\s\S]*?Antivirus[\s\S]*?Tiempo real/, 'La seguridad debe mostrar qué capas de Defender están activas.');
forbidMatch(support, /Tu PC está en orden\. No encontramos problemas importantes\. También pude leer la temperatura\./, 'No se permite volver a una respuesta genérica sin evidencia.');

// Optimizer must scan first, animate, require confirmation and protect browser data.
requireMatch(support, /optimizerPhase/, 'El optimizador debe tener estados de análisis, confirmación y limpieza.');
requireMatch(support, /scanOptimizer[\s\S]*?runAgentAction\('temp_scan'\)/, 'Optimizar debe analizar antes de borrar.');
requireMatch(support, /cleanOptimizer[\s\S]*?runAgentAction\('clean_temp_files'\)/, 'La limpieza debe ser una acción separada y confirmada.');
requireMatch(support, /RocketStage/, 'El flujo de optimización debe mostrar la nave espacial.');
requireMatch(supportCss, /\.nx-rocket-stage/, 'Falta el escenario visual del optimizador.');
requireMatch(supportCss, /\.nx-rocket\b/, 'Falta la nave del optimizador.');
requireMatch(supportCss, /\.nx-planet\b/, 'Falta el planeta del optimizador.');
requireMatch(support, /chatPending[\s\S]*?toolPending/, 'Chat y herramientas deben tener confirmaciones independientes.');
requireMatch(supportExtraCss, /\.nx-tool-confirm/, 'La confirmación dentro de Herramientas debe tener feedback propio.');
requireMatch(actions, /Temporales del usuario[\s\S]*?Temporales de Windows[\s\S]*?Volcados de errores[\s\S]*?Informes de errores/, 'La limpieza debe usar una lista blanca explícita.');
requireMatch(actions, /Perfiles de navegadores[\s\S]*?Cookies[\s\S]*?Sesiones[\s\S]*?Contraseñas guardadas/, 'La limpieza debe declarar las exclusiones de navegador.');
requireMatch(actions, /LastWriteTime -lt \$cutoff/, 'NEXO solo debe limpiar temporales antiguos, no archivos activos recientes.');
requireMatch(actions, /-Attributes !ReparsePoint/, 'La limpieza debe evitar atravesar enlaces o puntos de análisis.');
forbidMatch(actions, /Chrome|Edge|Firefox|Brave|User Data|Login Data|Web Data/, 'La limpieza no puede apuntar a perfiles o bases de datos de navegadores.');
requireMatch(evidence, /Las sesiones, cookies, perfiles y contraseñas de navegadores no se tocaron/, 'El resultado debe confirmar claramente la protección de datos del navegador.');

// RustDesk integration must detect the existing OSS client and stay user-authorized.
requireMatch(actions, /pub fn remote_tool_status/, 'NEXO debe informar si RustDesk está instalado.');
requireMatch(actions, /find_rustdesk[\s\S]*?LOCALAPPDATA[\s\S]*?ProgramFiles[\s\S]*?PATH/, 'La detección de RustDesk debe buscar instalaciones habituales y PATH.');
requireMatch(actions, /NEXO no instala herramientas remotas sin permiso/, 'La app no debe instalar control remoto silenciosamente.');
requireMatch(actions, /compartir el ID visible y aceptar la conexión/, 'La conexión remota debe exigir autorización visible.');
requireMatch(remoteSupport, /getRemoteToolStatus/, 'La interfaz debe consultar la disponibilidad de RustDesk.');
requireMatch(support, /prepareRemoteSupport[\s\S]*?createTicket[\s\S]*?createRemoteSession[\s\S]*?openRemoteTool/, 'Soporte remoto debe crear una solicitud real antes de abrir RustDesk.');
requireMatch(support, /RustDesk detectado/, 'La UI debe mostrar claramente el cliente remoto detectado.');
requireMatch(supportExtraCss, /\.nx-support-code/, 'La solicitud de soporte debe mostrar su código dentro de Herramientas.');

// No heavy work may run automatically at startup.
forbidMatch(support, /setTimeout\(\(\) => void runOverview/, 'NEXO no debe ejecutar una revisión pesada automáticamente al abrir.');
forbidMatch(support, /setTimeout\(\(\) => void runTemperature/, 'NEXO no debe ejecutar sensores automáticamente al abrir.');

// Visual CI must exercise the actual behavior, not only render the screen.
requireMatch(smoke, /support-chat-evidence\.png/, 'La validación visual debe comprobar evidencia dentro del chat.');
requireMatch(smoke, /support-optimizer-empty\.png/, 'La validación debe comprobar que abrir Optimizar no ejecuta nada.');
requireMatch(smoke, /support-optimizer-ready\.png/, 'La validación debe comprobar el análisis previo.');
requireMatch(smoke, /support-optimizer-flight\.png/, 'La validación debe capturar la nave durante la limpieza.');
requireMatch(smoke, /support-optimizer-done\.png/, 'La validación debe comprobar el resultado de la limpieza.');
requireMatch(smoke, /support-security-evidence\.png/, 'La seguridad debe validarse con evidencia visible.');
requireMatch(smoke, /support-temperature-evidence\.png/, 'La temperatura debe validarse con valores visibles.');
requireMatch(smoke, /support-remote-detection\.png/, 'La detección del cliente remoto debe validarse visualmente.');

requireMatch(releaseWorkflow, /node scripts\/verify-product-contracts\.mjs/, 'El release debe verificar los contratos de producto antes de publicarse.');
requireMatch(releaseWorkflow, /scripts\/smoke-ui\.mjs/, 'El release debe validar la interfaz real antes de publicarse.');

console.log('Product contracts passed: evidence-first agent, cached tool state, explicit analyses, safe rocket optimizer, protected browser data, authorized RustDesk support, reliable sensors and gated releases.');
