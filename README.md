# NEXO Support

Asistente técnico de escritorio para Windows construido con Tauri, React y TypeScript.

No es un dashboard tradicional. La aplicación vive en la bandeja del sistema y abre un popup compacto de chat cuando el usuario toca el icono de NEXO.

## Producto

El usuario no configura modelos, API keys ni herramientas. Solo activa la PC con un código entregado por NEXO y escribe lo que le pasa.

NEXO puede:

- revisar memoria, disco, inicio, seguridad, reinicios pendientes y temperatura;
- comprobar conexión, DNS y adaptadores de red;
- buscar archivos temporales sin borrarlos;
- revisar programas de inicio sin desactivarlos;
- ejecutar limpiezas limitadas y reparaciones seguras después de una confirmación visible;
- iniciar un análisis rápido oficial de Microsoft Defender;
- abrir Windows Update bajo control del usuario;
- crear una solicitud y abrir soporte remoto cuando hace falta;
- realizar una revisión liviana cada cuatro horas mientras la app está ejecutándose y avisar solo si encuentra algo relevante.

## Reglas de seguridad

La IA nunca ejecuta comandos arbitrarios. OpenRouter solo puede solicitar herramientas incluidas en una lista cerrada. La app vuelve a validar el nombre de la herramienta localmente.

- Lecturas: pueden ejecutarse automáticamente.
- Cambios: requieren el botón **Sí, hacelo**.
- Acceso remoto: requiere una solicitud explícita del usuario.
- Prohibido: limpieza de registro, desactivar antivirus, borrar carpetas del sistema, tocar drivers a ciegas o ejecutar scripts generados por el modelo.

## OpenRouter y planes

La clave de OpenRouter no se incluye en el ejecutable.

1. La app envía la conversación al endpoint privado de NEXO: `VITE_NEXO_API_URL/api/assistant`.
2. El servidor valida el `device_token` contra Supabase.
3. `public.device_entitlements` determina si el asistente está activo, el plan, el límite mensual y el modelo.
4. El servidor llama a OpenRouter con tool calling y devuelve como máximo una herramienta por turno.
5. La herramienta se ejecuta en la PC únicamente si está autorizada por el catálogo local.

El modelo puede definirse por plan mediante `NEXO_MODEL_BASIC`, `NEXO_MODEL_PRO`, etc., o por dispositivo con `device_entitlements.model`.

## Configuración

### Supabase

1. Ejecutar `infra/supabase/schema.sql`.
2. Ejecutar `infra/supabase/nexo-assistant.sql`.
3. Generar un código de vinculación desde el sistema de NEXO.
4. Activar el entitlement del dispositivo y asignar plan/modelo.

### Desktop

Copiar `.env.example` como `.env` y completar Supabase y `VITE_NEXO_API_URL`.

### Servidor

Desplegar `api/assistant.ts` en Vercel o un runtime Edge compatible y configurar las variables de `.env.server.example`.

Nunca colocar `OPENROUTER_API_KEY` ni `SUPABASE_SERVICE_ROLE_KEY` en variables `VITE_*`.

## Comportamiento de ventana

- Tamaño base: 410 × 640 px.
- Sin barra nativa ni icono en la taskbar.
- Arranca oculta.
- Clic izquierdo en el icono de bandeja: mostrar/ocultar popup.
- La X oculta la ventana, no termina el agente.
- **Cerrar NEXO** desde el menú sí termina el proceso.

## Desarrollo

```bash
npm install
npm run tauri:dev
```

En desarrollo la ventana comienza oculta. Abrila desde el icono de NEXO en la bandeja.

## Build

```bash
npm run build
npm run tauri:build
```

El updater conserva el identificador y el feed de releases existentes para no cortar instalaciones previas.
