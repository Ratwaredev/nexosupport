# NEXO Support

Aplicación de asistencia técnica para Windows construida con Tauri, React y TypeScript.

NEXO Support reemplaza la antigua interfaz de UnderDock por un flujo directo y entendible para clientes y técnicos, sin alterar la infraestructura de diagnóstico, sincronización, soporte remoto ni actualizaciones.

## Flujos

### Cliente

1. Ingresa el código entregado por el técnico.
2. Describe el problema antes de vincular el equipo.
3. Ejecuta un diagnóstico bajo demanda.
4. Crea una solicitud de asistencia.
5. Abre la herramienta remota cuando existe una sesión activa.
6. Consulta el estado del equipo y las actualizaciones disponibles.

### Técnico

- Revisa solicitudes y su estado.
- Consulta equipos vinculados.
- Genera códigos de acceso con vencimiento.
- Inicia asistencia remota.
- Cambia solicitudes entre nueva, en espera, en asistencia y resuelta.
- Revisa versiones publicadas y el estado del updater.

## Identidad visual

La interfaz usa el sistema visual de NEXO:

- base clara y espaciosa;
- tipografía Helvetica/Arial;
- acentos violeta `#7a3cff` y azul `#188fff`;
- marca NEXO con la X en gradiente;
- nuevo ícono de escritorio e instalador;
- componentes responsive para escritorio, notebook y pantallas angostas.

## Funcionalidad preservada

- Diagnóstico de Windows mediante Tauri + PowerShell/WMI.
- Backend local de demostración con persistencia en el navegador.
- Backend compatible con Supabase para sincronización entre equipos.
- Integración con RustDesk para asistencia remota.
- Actualizador nativo de Tauri mediante GitHub Releases.
- Identificador de aplicación y claves de almacenamiento existentes, para no cortar instalaciones ni sesiones previas.

## Modo local

Sin variables de Supabase, el proyecto funciona en modo demo durante desarrollo.

- Acceso técnico visible: `admin@nexo.local` / `admin123`
- Código de cliente: `DEMO-PAIR`
- Los datos quedan en el perfil local del navegador.

## Configuración

1. Crear un proyecto en Supabase.
2. Ejecutar `infra/supabase/schema.sql`.
3. Crear el usuario técnico y su fila en `public.admin_users`.
4. Copiar `.env.example` como `.env` y completar las variables.
5. Configurar la herramienta remota o su URL.
6. Publicar un manifiesto válido para el updater de Tauri.

## Desarrollo

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

Los instaladores se generan en `src-tauri/target/release/bundle/` con el nombre de producto **NEXO Support**.

## Actualizaciones

El endpoint continúa usando las releases de `Ratwaredev/underdocksoporteapp` para mantener compatibilidad con las instalaciones existentes. Cada release debe incluir:

- instalador NSIS o MSI;
- archivo `.sig` correspondiente;
- `latest.json` con versión, notas, fecha, URL y firma.

La clave privada de firma no debe guardarse en el repositorio.
