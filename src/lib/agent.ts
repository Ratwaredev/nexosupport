import { safeInvoke, isTauriRuntime } from './tauri';

export type AgentStatus = {
  mode: string;
  monitoring: boolean;
  version: string;
  notes: string;
};

export type AgentActionResult = {
  action: string;
  ok: boolean;
  message: string;
  details: string[];
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getAgentStatus(): Promise<AgentStatus> {
  if (isTauriRuntime()) return safeInvoke<AgentStatus>('agent_status');
  await wait(260);
  return {
    mode: 'on-demand/dev',
    monitoring: false,
    version: '0.1.0-dev',
    notes: 'Modo navegador: las herramientas reales corren dentro de la app de Windows.'
  };
}

function previewPayload(actionId: string) {
  if (actionId === 'network_check') return { adapter: { Name: 'Ethernet', InterfaceDescription: 'Adaptador de prueba', LinkSpeed: '1 Gbps' }, gateway: '192.168.1.1', dns: true, internet: true };
  if (actionId === 'defender_status') return { service: true, antivirus: true, realtime: true, quickScanAge: 1, fullScanAge: 14 };
  if (actionId === 'startup_review') return { count: 6, items: [{ Name: 'OneDrive' }, { Name: 'Steam' }, { Name: 'Discord' }, { Name: 'Audio service' }, { Name: 'Update service' }, { Name: 'Security tray' }] };
  if (actionId === 'temp_scan') return {
    generatedAt: new Date().toISOString(),
    totalFiles: 1842,
    totalBytes: 742 * 1024 * 1024,
    totalMb: 742,
    categories: [
      { name: 'Temporales del usuario', path: 'C:\\Users\\demo\\AppData\\Local\\Temp', files: 1510, bytes: 566 * 1024 * 1024 },
      { name: 'Temporales de Windows', path: 'C:\\Windows\\Temp', files: 242, bytes: 132 * 1024 * 1024 },
      { name: 'Volcados de errores', path: 'C:\\Users\\demo\\AppData\\Local\\CrashDumps', files: 90, bytes: 44 * 1024 * 1024 }
    ],
    exclusions: ['Perfiles de navegadores', 'Cookies', 'Sesiones', 'Historial', 'Extensiones', 'Contraseñas guardadas', 'Datos de formularios']
  };
  if (actionId === 'clean_temp_files') return {
    generatedAt: new Date().toISOString(),
    deletedFiles: 1801,
    freedBytes: 721 * 1024 * 1024,
    freedMb: 721,
    failedFiles: 41,
    categories: [
      { name: 'Temporales del usuario', deleted: 1494, freedBytes: 553 * 1024 * 1024, failed: 16 },
      { name: 'Temporales de Windows', deleted: 218, freedBytes: 125 * 1024 * 1024, failed: 24 },
      { name: 'Volcados de errores', deleted: 89, freedBytes: 43 * 1024 * 1024, failed: 1 }
    ],
    exclusions: ['Perfiles de navegadores', 'Cookies', 'Sesiones', 'Historial', 'Extensiones', 'Contraseñas guardadas', 'Datos de formularios']
  };
  if (actionId === 'repair_network') return { dnsCacheCleared: true, changedRouter: false, changedWifiPassword: false };
  return { preview: true };
}

export async function runAgentAction(actionId: string): Promise<AgentActionResult> {
  if (isTauriRuntime()) return safeInvoke<AgentActionResult>('run_agent_action', { actionId });
  await wait(actionId === 'clean_temp_files' ? 1050 : 720);
  const message = actionId === 'network_check'
    ? 'Terminé las comprobaciones de red.'
    : actionId === 'defender_status'
      ? 'Terminé de comprobar Microsoft Defender.'
      : actionId === 'startup_review'
        ? 'Revisé los programas de inicio y no desactivé ninguno.'
        : actionId === 'temp_scan'
          ? 'Analicé únicamente ubicaciones temporales autorizadas. No borré nada.'
          : actionId === 'clean_temp_files'
            ? 'Optimización completada. No se tocaron datos ni sesiones de navegadores.'
            : actionId === 'repair_network'
              ? 'Limpié la caché DNS. No cambié el router ni la contraseña Wi-Fi.'
              : `Acción de prueba completada: ${actionId}`;
  return { action: actionId, ok: true, message, details: [JSON.stringify(previewPayload(actionId))] };
}
