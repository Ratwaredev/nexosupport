from pathlib import Path

path = Path('scripts/verify-product-contracts.mjs')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "requireMatch(admin, /setInterval\\(poll, 15000\\)/, 'Control debe actualizar solicitudes sin saturar el backend.');\nrequireMatch(admin, /document\\.visibilityState === 'visible'/, 'Control no debe consultar mientras está oculto.');",
        "requireMatch(admin, /clearAdminSession[\\s\\S]*STORAGE_KEYS\\.adminSession/, 'Control debe exigir una sesión nueva al abrir Administración.');\nforbidMatch(admin, /setInterval\\(poll/, 'Control no debe consultar la base continuamente.');"
    ),
    (
        "requireMatch(support, /createTicket[\\s\\S]*?createRemoteSession[\\s\\S]*?openRemoteTool/, 'Soporte remoto debe guardar la solicitud antes de abrir RustDesk.');",
        "forbidMatch(support, /async function startRemote[\\s\\S]*?setSupportCode\\(remoteSession\\.code\\);\\s*await openRemoteTool\\(\\)/, 'Crear una solicitud no puede abrir RustDesk automáticamente.');\nrequireMatch(support, /supportCode \\?[\\s\\S]*Abrir RustDesk/, 'RustDesk debe abrirse solamente desde un botón explícito.');"
    ),
    (
        "requireMatch(updaterCss, /\\.app-update-installing/, 'Falta el indicador compacto de actualización.');\nforbidMatch(updaterCss, /backdrop-filter/, 'El actualizador no debe aplicar blur de pantalla completa.');",
        "requireMatch(updaterCss, /\\.app-update-installing/, 'Falta el indicador compacto de actualización.');\nrequireMatch(updaterCss, /\\.app-update-orb/, 'La instalación debe mostrar el círculo eléctrico violeta.');\nforbidMatch(updaterCss, /inset:0[^}]*backdrop-filter/, 'El actualizador no debe aplicar blur de pantalla completa.');"
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Expected contract block missing: {old[:120]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
