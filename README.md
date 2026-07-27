# NEXO Support

NEXO Support es un asistente de escritorio para Windows que vive en la bandeja del sistema. El usuario abre un popup compacto, explica el problema y autoriza de forma explícita qué puede leer o modificar.

## Producto

La aplicación tiene dos superficies separadas:

- **NEXO Support:** popup para el usuario final, con estado del equipo, chat, diagnóstico y soporte remoto.
- **NEXO Control:** panel administrativo para gestionar usuarios, equipos, planes, modelos, consumo y solicitudes.

Las sesiones son independientes. Una persona del equipo NEXO puede usar su propio asistente como usuario normal y abrir el panel administrativo sin cerrar ni reemplazar la sesión de su PC.

## Privacidad y permisos

En la primera activación el usuario decide si permite:

- usar el asistente conectado al servidor de NEXO;
- leer memoria, disco y sensores de hardware;
- compartir un resumen técnico con NEXO y el modelo asignado;
- ejecutar revisiones automáticas mientras la aplicación está activa.

La lectura local de sensores no se comparte si el usuario no habilita **Compartir diagnóstico con NEXO**. Las acciones que cambian Windows requieren una confirmación adicional y visible.

## Sensores de hardware

La aplicación usa `LibreHardwareMonitorLib` 0.9.6 para leer los sensores que el firmware, la placa y los controladores exponen a Windows:

- temperatura y carga de CPU;
- temperatura y carga de GPU;
- temperatura de discos;
- ventiladores y otros sensores compatibles.

No se presenta una zona ACPI genérica como si fuera la temperatura exacta del procesador. Si el sensor necesita privilegios elevados, el usuario puede iniciar una lectura avanzada y Windows muestra su diálogo de autorización.

El componente se descarga desde el paquete oficial de NuGet durante la preparación del build y se distribuye con su licencia MPL-2.0.

## IA y planes

La clave de OpenRouter nunca se guarda en el ejecutable. El desktop llama a `api/assistant.ts`, que:

1. valida el dispositivo;
2. verifica el consentimiento y el plan;
3. aplica el límite mensual;
4. selecciona el modelo asignado al usuario o equipo;
5. filtra las herramientas permitidas antes de llamar a OpenRouter.

NEXO Control permite cambiar el plan, el modelo y el límite de cada usuario o equipo sin pedirle configuración al cliente.

## Herramientas

### Solo lectura

- diagnóstico general;
- sensores de hardware;
- conexión y DNS;
- archivos temporales;
- programas de inicio;
- estado de Microsoft Defender.

### Con confirmación

- limpiar temporales antiguos;
- limpiar caché DNS;
- iniciar un análisis rápido de Defender;
- abrir Windows Update;
- preparar soporte remoto.

No existe una herramienta de comandos arbitrarios.

## Configuración

1. Ejecutar `infra/supabase/schema.sql`.
2. Ejecutar `infra/supabase/nexo-assistant.sql`.
3. Copiar `.env.example` y `.env.server.example`.
4. Configurar Supabase y las variables server-only de OpenRouter.
5. Crear usuarios desde NEXO Control y generar un código de activación para cada uno.

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

GitHub Actions valida TypeScript y Rust en Windows y genera un instalador NSIS sin firma como artefacto de prueba. Las releases públicas deben construirse con la clave privada real del updater y publicar el instalador, su firma y `latest.json`.
