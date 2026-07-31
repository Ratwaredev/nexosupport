from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Missing expected text in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


updates_rs = r'''use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "windows")]
use std::{
    env,
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize, Serialize)]
struct ActiveInstall {
    path: String,
    version: String,
}

fn version_parts(value: &str) -> Vec<u64> {
    value
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|character| character.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn is_newer(candidate: &str, current: &str) -> bool {
    let candidate = version_parts(candidate);
    let current = version_parts(current);
    let length = candidate.len().max(current.len());
    for index in 0..length {
        let left = *candidate.get(index).unwrap_or(&0);
        let right = *current.get(index).unwrap_or(&0);
        if left != right {
            return left > right;
        }
    }
    false
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    let current = app.package_info().version.to_string();

    Ok(update.and_then(|release| {
        if !is_newer(&release.version, &current) {
            return None;
        }
        Some(AvailableUpdate {
            version: release.version,
            notes: release.body,
        })
    }))
}

#[cfg(target_os = "windows")]
fn active_install_marker() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("NEXO Support").join("active-install.json"))
}

#[cfg(target_os = "windows")]
fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(target_os = "windows")]
fn read_active_install() -> Option<ActiveInstall> {
    let marker = active_install_marker()?;
    let text = fs::read_to_string(marker).ok()?;
    serde_json::from_str(&text).ok()
}

#[cfg(target_os = "windows")]
fn persist_active_install(path: &Path, version: &str) -> Result<(), String> {
    let marker = active_install_marker().ok_or("No se encontró LOCALAPPDATA.")?;
    let parent = marker.parent().ok_or("Ruta de instalación inválida.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let payload = ActiveInstall {
        path: path.to_string_lossy().to_string(),
        version: version.to_string(),
    };
    let json = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    fs::write(marker, json).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
pub fn redirect_to_active_install(current_version: &str) -> bool {
    let Ok(current) = env::current_exe() else {
        return false;
    };
    let Some(active) = read_active_install() else {
        return false;
    };
    let target = PathBuf::from(&active.path);
    if !target.is_file() || normalize(&current) == normalize(&target) {
        return false;
    }
    if is_newer(current_version, &active.version) {
        let _ = persist_active_install(&current, current_version);
        return false;
    }

    Command::new(target)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_ok()
}

#[cfg(not(target_os = "windows"))]
pub fn redirect_to_active_install(_current_version: &str) -> bool {
    false
}

#[cfg(target_os = "windows")]
pub fn register_current_install(current_version: &str) {
    let Ok(current) = env::current_exe() else {
        return;
    };
    match read_active_install() {
        None => {
            let _ = persist_active_install(&current, current_version);
        }
        Some(active) => {
            let active_path = PathBuf::from(active.path);
            if !active_path.is_file() || is_newer(current_version, &active.version) {
                let _ = persist_active_install(&current, current_version);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn register_current_install(_current_version: &str) {}

#[cfg(target_os = "windows")]
fn powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn finish_windows_update(
    app: &AppHandle,
    expected_version: &str,
) -> Result<(), String> {
    let current = env::current_exe().map_err(|error| error.to_string())?;
    let marker = active_install_marker().ok_or("No se encontró LOCALAPPDATA.")?;
    let marker_dir = marker.parent().ok_or("Ruta de instalación inválida.")?;

    let current = powershell_literal(&current.to_string_lossy());
    let marker = powershell_literal(&marker.to_string_lossy());
    let marker_dir = powershell_literal(&marker_dir.to_string_lossy());
    let expected = powershell_literal(expected_version);

    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         Start-Sleep -Milliseconds 1400; \
         $expected=[version]'{expected}'; \
         $current='{current}'; \
         $candidates=@(\
           $current, \
           (Join-Path $env:ProgramW6432 'NEXO Support\\NEXO Support.exe'), \
           (Join-Path $env:ProgramFiles 'NEXO Support\\NEXO Support.exe'), \
           (Join-Path $env:LOCALAPPDATA 'Programs\\NEXO Support\\NEXO Support.exe'), \
           (Join-Path $env:LOCALAPPDATA 'NEXO Support\\NEXO Support.exe')\
         ) | Where-Object {{ $_ }} | Select-Object -Unique; \
         $versions=@(); \
         foreach($candidate in $candidates){{ \
           if(Test-Path -LiteralPath $candidate){{ \
             $raw=(Get-Item -LiteralPath $candidate).VersionInfo.ProductVersion; \
             $clean=([regex]::Match([string]$raw,'\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?')).Value; \
             if($clean){{ try{{ $versions += [pscustomobject]@{{Path=$candidate;Version=[version]$clean}} }}catch{{}} }} \
           }} \
         }}; \
         $target=($versions | Where-Object {{ $_.Version -eq $expected }} | Select-Object -First 1).Path; \
         if(-not $target){{ $target=($versions | Sort-Object Version -Descending | Select-Object -First 1).Path }}; \
         if(-not $target -and (Test-Path -LiteralPath $current)){{ $target=$current }}; \
         if(-not $target){{ exit 21 }}; \
         New-Item -ItemType Directory -Force -Path '{marker_dir}' | Out-Null; \
         @{{path=$target;version='{expected}'}} | ConvertTo-Json -Compress | Set-Content -LiteralPath '{marker}' -Encoding UTF8; \
         $shell=New-Object -ComObject WScript.Shell; \
         $desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'NEXO Support.lnk'; \
         $programs=Join-Path ([Environment]::GetFolderPath('Programs')) 'NEXO Support.lnk'; \
         foreach($link in @($desktop,$programs)){{ \
           $shortcut=$shell.CreateShortcut($link); \
           $shortcut.TargetPath=$target; \
           $shortcut.WorkingDirectory=Split-Path $target; \
           $shortcut.Save() \
         }}; \
         $startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'NEXO Support.lnk'; \
         $taskbar=Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\NEXO Support.lnk'; \
         foreach($link in @($startup,$taskbar)){{ \
           if(Test-Path -LiteralPath $link){{ \
             $shortcut=$shell.CreateShortcut($link); \
             $shortcut.TargetPath=$target; \
             $shortcut.WorkingDirectory=Split-Path $target; \
             $shortcut.Save() \
           }} \
         }}; \
         $runKey='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; \
         if(Test-Path $runKey){{ \
           $properties=(Get-ItemProperty $runKey).PSObject.Properties | Where-Object {{ $_.Name -notmatch '^PS' -and [string]$_.Value -match 'NEXO Support\\.exe' }}; \
           foreach($property in $properties){{ Set-ItemProperty -Path $runKey -Name $property.Name -Value ('\"'+$target+'\"') }} \
         }}; \
         Start-Process -FilePath $target"
    );

    Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("No se pudo abrir la versión instalada: {error}"))?;

    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    expected_version: String,
) -> Result<(), String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Err("No hay una actualización disponible.".to_string());
    };

    let current = app.package_info().version.to_string();
    if update.version != expected_version {
        return Err("La versión disponible cambió. Buscá la actualización nuevamente.".to_string());
    }
    if !is_newer(&update.version, &current) {
        return Err("NEXO ya tiene esta versión o una más nueva.".to_string());
    }

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    {
        return finish_windows_update(&app, &expected_version);
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.restart();
    }
}
'''
Path("src-tauri/src/app/updates.rs").write_text(updates_rs, encoding="utf-8")

replace_once(
    "src-tauri/Cargo.toml",
    'tauri-plugin-updater = "2"\n',
    'tauri-plugin-updater = "2"\ntauri-plugin-single-instance = "2"\n',
)

replace_once(
    "src-tauri/src/app.rs",
    "pub fn run() {\n    tauri::Builder::default()\n        .plugin(tauri_plugin_opener::init())",
    "pub fn run() {\n    let current_version = env!(\"CARGO_PKG_VERSION\");\n    if updates::redirect_to_active_install(current_version) {\n        return;\n    }\n    updates::register_current_install(current_version);\n\n    tauri::Builder::default()\n        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {\n            let _ = windows::reveal_main_window(app, false);\n        }))\n        .plugin(tauri_plugin_opener::init())",
)

admin_path = Path("src/AdminApp.tsx")
admin = admin_path.read_text(encoding="utf-8")
admin = admin.replace(
    "const emptyDraft: UserDraft = { fullName: '', email: '', plan: 'basic', limit: '200', isStaff: false };",
    "const ADMIN_EMAIL = 'franciscosuarez@live.com.ar';\nconst emptyDraft: UserDraft = { fullName: '', email: '', plan: 'basic', limit: '200', isStaff: false };",
    1,
)
admin = admin.replace(
    "if (/PGRST205|schema cache|Could not find the table/i.test(raw)) return 'La base de NEXO está incompleta. El acceso fue validado, pero faltan módulos.';",
    "if (/PGRST202|PGRST205|schema cache|Could not find the table|Could not find the function|generate_user_pairing_code/i.test(raw)) return 'La base de NEXO está incompleta. Falta restaurar Administración y los códigos.';",
    1,
)
admin = admin.replace(
    "const [email, setEmail] = useState(appBackend.kind === 'local' ? backendConfig.localAdminEmail : '');",
    "const [email, setEmail] = useState(appBackend.kind === 'local' ? backendConfig.localAdminEmail : ADMIN_EMAIL);",
    1,
)
admin = admin.replace(
    "      setSession(result.session);\n      setFailedAttempts(0);\n      await refresh();",
    "      setSession(result.session);\n      setFailedAttempts(0);\n      window.setTimeout(() => void refresh(), 0);",
    1,
)
admin_path.write_text(admin, encoding="utf-8")

schema_path = Path("infra/supabase/schema.sql")
schema = schema_path.read_text(encoding="utf-8")
policies = [
    ("admin users self read", "admin_users"),
    ("admin users self insert", "admin_users"),
    ("pairing codes admin only", "pairing_codes"),
    ("devices admin read", "devices"),
    ("devices admin update", "devices"),
    ("devices admin insert", "devices"),
    ("tickets admin read", "tickets"),
    ("tickets admin write", "tickets"),
    ("diagnostics admin read", "diagnostics"),
    ("diagnostics admin write", "diagnostics"),
    ("sessions admin read", "sessions"),
    ("sessions admin write", "sessions"),
    ("releases public read", "releases"),
]
for name, table in policies:
    marker = f'create policy "{name}"\non public.{table}'
    replacement = f'drop policy if exists "{name}" on public.{table};\ncreate policy "{name}"\non public.{table}'
    if marker not in schema:
        raise SystemExit(f"Policy marker missing: {name}")
    schema = schema.replace(marker, replacement, 1)
schema_path.write_text(schema, encoding="utf-8")

restore_workflow = r'''name: Restore current NEXO schema

on:
  push:
    branches: [main]
    paths:
      - '.github/workflows/restore-supabase-schema.yml'
      - 'infra/supabase/schema.sql'
      - 'infra/supabase/nexo-assistant.sql'
      - 'infra/supabase/secure-agent.sql'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: nexo-schema-restore
  cancel-in-progress: false

jobs:
  restore:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
      NEXO_ADMIN_EMAIL: franciscosuarez@live.com.ar
    steps:
      - uses: actions/checkout@v4

      - name: Resolve restored Supabase project
        shell: bash
        run: |
          set -euo pipefail
          test -n "${SUPABASE_ACCESS_TOKEN:-}" || { echo 'Missing SUPABASE_ACCESS_TOKEN'; exit 1; }
          test -n "${VITE_SUPABASE_URL:-}" || { echo 'Missing VITE_SUPABASE_URL'; exit 1; }
          project_ref="$(python - <<'PY'
          import os
          from urllib.parse import urlparse
          host = urlparse(os.environ['VITE_SUPABASE_URL']).hostname or ''
          suffix = '.supabase.co'
          if not host.endswith(suffix):
              raise SystemExit('VITE_SUPABASE_URL is not a Supabase project URL')
          print(host[:-len(suffix)])
          PY
          )"
          test -n "$project_ref" || { echo 'Could not derive Supabase project ref'; exit 1; }
          echo "SUPABASE_PROJECT_REF=$project_ref" >> "$GITHUB_ENV"

      - name: Apply complete product schema in order
        shell: bash
        run: |
          set -euo pipefail
          python - <<'PY' > "$RUNNER_TEMP/nexo-restore-schema.json"
          import json
          from pathlib import Path

          files = [
              Path('infra/supabase/schema.sql'),
              Path('infra/supabase/nexo-assistant.sql'),
              Path('infra/supabase/secure-agent.sql'),
          ]
          query = '\n\n'.join(path.read_text(encoding='utf-8') for path in files)
          print(json.dumps({'query': query, 'read_only': False}))
          PY

          curl --fail-with-body --silent --show-error \
            -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
            -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
            -H 'Content-Type: application/json' \
            --data-binary "@$RUNNER_TEMP/nexo-restore-schema.json"
          rm -f "$RUNNER_TEMP/nexo-restore-schema.json"

      - name: Restore Francisco administrator mapping
        shell: bash
        run: |
          set -euo pipefail
          python - <<'PY' > "$RUNNER_TEMP/nexo-admin.json"
          import json
          import os

          email = os.environ['NEXO_ADMIN_EMAIL'].replace("'", "''")
          query = f'''
          do $$
          declare
            target_user_id uuid;
            target_email text;
          begin
            select id, email into target_user_id, target_email
            from auth.users
            where lower(email) = lower('{email}')
            limit 1;

            if target_user_id is null then
              raise exception 'missing auth user for {email}';
            end if;

            delete from public.admin_users
            where lower(email) = lower('{email}') and user_id <> target_user_id;

            insert into public.admin_users(user_id, email, org_name, role)
            values (target_user_id, target_email, 'NEXO', 'admin')
            on conflict (user_id) do update set
              email = excluded.email,
              org_name = excluded.org_name,
              role = 'admin';
          end
          $$;
          '''
          print(json.dumps({'query': query, 'read_only': False}))
          PY

          curl --fail-with-body --silent --show-error \
            -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
            -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
            -H 'Content-Type: application/json' \
            --data-binary "@$RUNNER_TEMP/nexo-admin.json"
          rm -f "$RUNNER_TEMP/nexo-admin.json"

      - name: Validate restored schema, administrator and code generation
        shell: bash
        run: |
          set -euo pipefail
          python - <<'PY' > "$RUNNER_TEMP/nexo-verify-schema.json"
          import json
          import os

          email = os.environ['NEXO_ADMIN_EMAIL'].replace("'", "''")
          query = f'''
          do $$
          begin
            if to_regclass('public.admin_users') is null then raise exception 'missing admin_users'; end if;
            if to_regclass('public.support_users') is null then raise exception 'missing support_users'; end if;
            if to_regclass('public.devices') is null then raise exception 'missing devices'; end if;
            if to_regclass('public.device_entitlements') is null then raise exception 'missing device_entitlements'; end if;
            if to_regclass('public.device_consents') is null then raise exception 'missing device_consents'; end if;
            if to_regclass('public.tickets') is null then raise exception 'missing tickets'; end if;
            if to_regclass('public.diagnostics') is null then raise exception 'missing diagnostics'; end if;
            if to_regclass('public.sessions') is null then raise exception 'missing sessions'; end if;
            if to_regclass('public.releases') is null then raise exception 'missing releases'; end if;
            if to_regclass('public.pairing_codes') is null then raise exception 'missing pairing_codes'; end if;
            if to_regprocedure('public.generate_user_pairing_code(uuid)') is null then raise exception 'missing generate_user_pairing_code'; end if;
            if to_regprocedure('public.register_device(text,text,text,text,text,text)') is null then raise exception 'missing register_device'; end if;
            if to_regprocedure('public.set_device_consents(text,boolean,boolean,boolean,boolean,boolean)') is null then raise exception 'missing set_device_consents'; end if;
            if to_regprocedure('public.get_client_dashboard(text)') is null then raise exception 'missing get_client_dashboard'; end if;
            if to_regprocedure('public.create_remote_session(text,text)') is null then raise exception 'missing create_remote_session'; end if;
            if not exists (select 1 from public.admin_users where lower(email)=lower('{email}')) then
              raise exception 'Francisco is not mapped as administrator';
            end if;
          end
          $$;

          select json_build_object(
            'admin_email', '{email}',
            'admins', (select count(*) from public.admin_users),
            'support_users', (select count(*) from public.support_users),
            'devices', (select count(*) from public.devices),
            'pairing_function', to_regprocedure('public.generate_user_pairing_code(uuid)') is not null
          ) as nexo_restore;
          '''
          print(json.dumps({'query': query, 'read_only': False}))
          PY

          curl --fail-with-body --silent --show-error \
            -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
            -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
            -H 'Content-Type: application/json' \
            --data-binary "@$RUNNER_TEMP/nexo-verify-schema.json" \
            | tee "$RUNNER_TEMP/nexo-schema-result.json"
          rm -f "$RUNNER_TEMP/nexo-verify-schema.json"

      - name: Record schema restore status
        if: always()
        uses: actions/github-script@v7
        env:
          SCHEMA_STATUS: ${{ job.status }}
        with:
          script: |
            const owner = context.repo.owner;
            const repo = context.repo.repo;
            const branch = 'release-status';
            const path = '.schema-result.json';
            let sha;
            try {
              const current = await github.rest.repos.getContent({ owner, repo, path, ref: branch });
              if (!Array.isArray(current.data)) sha = current.data.sha;
            } catch (error) {
              if (error.status !== 404) throw error;
            }
            let verification = null;
            try {
              verification = JSON.parse(require('fs').readFileSync(process.env.RUNNER_TEMP + '/nexo-schema-result.json', 'utf8'));
            } catch {}
            const payload = {
              status: process.env.SCHEMA_STATUS,
              runId: String(context.runId),
              commit: context.sha,
              verification,
              checkedAt: new Date().toISOString()
            };
            await github.rest.repos.createOrUpdateFileContents({
              owner,
              repo,
              path,
              branch,
              sha,
              message: `schema: ${payload.status}`,
              content: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`).toString('base64')
            });
'''
Path(".github/workflows/restore-supabase-schema.yml").write_text(restore_workflow, encoding="utf-8")

contracts_path = Path("scripts/verify-product-contracts.mjs")
contracts = contracts_path.read_text(encoding="utf-8")
needle = "requireMatch(updater, /const CHECK_EVERY_MS = 6 \\* 60 \\* 60 \\* 1000/, 'NEXO debe revisar actualizaciones sin consultar cada minuto.');"
insert = """const nativeUpdater = await readFile('src-tauri/src/app/updates.rs', 'utf8');
const cargoManifest = await readFile('src-tauri/Cargo.toml', 'utf8');
const schemaRestore = await readFile('.github/workflows/restore-supabase-schema.yml', 'utf8');
requireMatch(nativeUpdater, /active-install\\.json/, 'El updater debe recordar una única instalación activa.');
requireMatch(nativeUpdater, /redirect_to_active_install/, 'Las copias viejas deben redirigir a la instalación activa.');
requireMatch(nativeUpdater, /VersionInfo\\.ProductVersion/, 'El updater debe elegir el ejecutable realmente actualizado por versión.');
requireMatch(cargoManifest, /tauri-plugin-single-instance/, 'NEXO debe impedir dos instancias simultáneas.');
requireMatch(schemaRestore, /schema\\.sql[\\s\\S]*nexo-assistant\\.sql[\\s\\S]*secure-agent\\.sql/, 'La restauración debe aplicar el esquema completo y en orden.');
requireMatch(schemaRestore, /franciscosuarez@live\\.com\\.ar/, 'La restauración debe verificar la cuenta administrativa de Francisco.');

""" + needle
if needle not in contracts:
    raise SystemExit("Updater contract marker missing")
contracts_path.write_text(contracts.replace(needle, insert, 1), encoding="utf-8")

print("Applied real updater, single-instance and Supabase administration recovery patch.")
