# NEXO contributor contract

Read this before changing the product. NEXO is a Windows support agent, not a general command runner.

## Product surfaces

- `src/SupportAppV6.tsx`: client popup. Keep it small, direct and usable by a non-technical person.
- `src/AdminApp.tsx`: NEXO Control. Users, PCs, remote requests and support reports.
- `supabase/functions/nexo-assistant/index.ts`: server-side planner. OpenRouter secrets live here only.
- `src-tauri/src/app/`: native Windows tools. This is the only layer allowed to read or change the OS.
- `src/lib/support-run.ts`: stable report schema.

## Non-negotiable security rules

1. Never expose `OPENROUTER_API_KEY`, Supabase service role, deployment tokens or signing keys to Vite or the EXE.
2. The model never generates or executes PowerShell, CMD, registry text, paths or arbitrary arguments.
3. Every agent tool has a fixed identifier and a fixed native implementation.
4. Read-only tools may run automatically.
5. Any Windows change and remote support require an explicit visible confirmation.
6. Do not add registry cleaners, security disabling, driver automation, unattended remote access or browser-profile cleanup.
7. Do not follow links while deleting files. Keep cleanup roots allowlisted and files older than 24 hours.
8. Remote sessions must bind ticket, device and device token. RustDesk still requires visible acceptance.
9. Reports must store actions and before/after evidence without credentials or personal file contents.
10. Production releases must fail when the agent service, signature, dependency hash or tests are not valid.

## Add a read-only agent tool

Use this exact path:

1. Add the ID and short description to `src/lib/assistant.ts`.
2. Add the same ID to the Edge Function allowlist and OpenRouter tool catalog.
3. Implement a dedicated Tauri command under `src-tauri/src/app/`.
4. Register it in `src-tauri/src/app.rs`.
5. Route the ID in `src/lib/agent.ts`.
6. Return structured JSON inside `AgentActionResult.details`.
7. Add a deterministic preview payload.
8. Make the Playwright smoke request it and verify it is present in the saved report.
9. Add a product-contract assertion.

Do not put a new case into a generic shell executor.

## Add a tool that changes Windows

Complete the read-only steps, then:

1. Mark it `mode: 'confirm'` in `TOOL_CATALOG`.
2. Show only the action name and `Cancelar / Autorizar` in the client.
3. Validate every parameter natively; prefer no model-provided parameters.
4. Re-run a read-only diagnostic after the action.
5. Persist success, failure and before/after evidence.
6. Add a test proving it cannot run before confirmation.

## UI rules

- Two client surfaces only: `Asistente` and `Herramientas`.
- No dashboards in the popup.
- No explanatory paragraphs, duplicated warnings or AI marketing copy.
- One primary action per state.
- A tool button opens its state; it does not execute immediately.
- The rocket appears only during cleanup and uses real native progress.
- The popup stays movable, resizable, minimizable and anchored above the taskbar when reopened.

## Required validation

Run or wait for all of these:

```powershell
npm ci
npm run build
node scripts/verify-product-contracts.mjs
node scripts/smoke-ui.mjs
cargo check --manifest-path src-tauri/Cargo.toml
```

GitHub Actions must additionally build the NSIS installer, install it and verify packaged sensor/RustDesk resources. Never merge or publish while any step is pending or failed.

## Release order

1. Validate PR.
2. Merge to `main`.
3. Deploy the Supabase function and security migration.
4. Verify the agent health endpoint.
5. Build/sign/publish the desktop release.
6. Verify `latest.json`, signature and installer bytes.

The release workflow intentionally blocks if step 3 or 4 is not ready.
