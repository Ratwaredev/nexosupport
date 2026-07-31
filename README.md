# NEXO Support

Asistente de soporte para Windows. Vive en la bandeja, diagnostica con herramientas cerradas, pide permiso antes de modificar el equipo y guarda un reporte verificable en NEXO Control.

## Flujo

1. El administrador crea un usuario y genera un código de 30 minutos.
2. La persona instala NEXO y conecta la PC con ese código.
3. Elige **Agente** o **Solo herramientas**.
4. El agente revisa el equipo usando únicamente el catálogo permitido.
5. Toda modificación y toda solicitud remota requieren autorización visible.
6. NEXO repite el diagnóstico y envía el resultado a Control.

## Superficies

- **NEXO Support:** popup para la persona que necesita ayuda.
- **NEXO Control:** usuarios, equipos, planes, solicitudes remotas y reportes antes/después.

Las sesiones de usuario y administrador son independientes.

## Seguridad

- La clave de OpenRouter vive en una Supabase Edge Function, nunca en el EXE.
- El modelo no ejecuta texto, PowerShell ni comandos inventados.
- Solo puede elegir una herramienta permitida por turno.
- Las lecturas no modifican Windows.
- Limpiar temporales, reparar DNS, iniciar Defender, abrir Windows Update y pedir soporte remoto requieren confirmación.
- El modo **Solo herramientas** no comparte diagnósticos.
- Los reportes registran acción, resultado y evidencia anterior/posterior.
- Una sesión remota solo puede crearse para un ticket de la misma PC.
- RustDesk se abre con aceptación visible; NEXO no configura acceso desatendido.

## Catálogo

### Lectura

- diagnóstico general;
- sensores de hardware;
- conexión y DNS;
- temporales recuperables;
- programas de inicio;
- Microsoft Defender.

### Con autorización

- limpiar temporales antiguos permitidos;
- limpiar caché DNS;
- iniciar un análisis rápido de Defender;
- abrir Windows Update;
- preparar soporte remoto con RustDesk.

## Sensores

NEXO distribuye `LibreHardwareMonitorLib` 0.9.6 con licencia MPL-2.0. Solo muestra temperaturas válidas que el firmware y los controladores exponen a Windows; una lectura ACPI genérica no se presenta como temperatura exacta de CPU.

## Configuración

1. Ejecutar `infra/supabase/schema.sql`.
2. Ejecutar `infra/supabase/nexo-assistant.sql`.
3. Ejecutar `infra/supabase/secure-agent.sql`.
4. Configurar las variables públicas de `.env.example`.
5. Configurar los secretos de `.env.server.example` y GitHub Actions.
6. Desplegar `nexo-assistant` o fusionar a `main` para usar el workflow automático.

## Desarrollo

```powershell
npm install
npm run prepare:sensors
npm run tauri:dev
```

## Build

```powershell
npm run tauri:build
```

GitHub Actions valida TypeScript, contratos de seguridad, navegación con Playwright, Rust, el instalador NSIS y los recursos instalados. Las releases públicas publican el instalador firmado y `latest.json` para el updater.
