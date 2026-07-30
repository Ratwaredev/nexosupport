import { Channel } from '@tauri-apps/api/core';
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

export type OptimizerProgress = {
  percent: number;
  processedFiles: number;
  totalFiles: number;
  freedBytes: number;
  current: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getAgentStatus(): Promise<AgentStatus> {
  if (isTauriRuntime()) return safeInvoke<AgentStatus>('agent_status');
  await wait(120);
  return { mode: 'preview', monitoring: false, version: 'dev', notes: 'Vista previa.' };
}

function previewPayload(actionId: string) {
  if (actionId === 'network_check') return { adapter: { Name: 'Ethernet', InterfaceDescription: 'Adaptador de prueba', LinkSpeed: '1 Gbps' }, gateway: '192.168.1.1', dns: true, internet: true };
  if (actionId === 'defender_status') return { service: true, antivirus: true, realtime: true, quickScanAge: 1, fullScanAge: 14 };
  if (actionId === 'startup_review') return { count: 6, items: [{ Name: 'OneDrive' }, { Name: 'Steam' }, { Name: 'Discord' }, { Name: 'Audio service' }, { Name: 'Update service' }, { Name: 'Security tray' }] };
  if (actionId === 'temp_scan') return {
    generatedAt: new Date().toISOString(), totalFiles: 1842, totalBytes: 742 * 1024 * 1024, totalMb: 742,
    categories: [
      { name: 'Temporales', files: 1510, bytes: 566 * 1024 * 1024 },
      { name: 'Windows Temp', files: 242, bytes: 132 * 1024 * 1024 },
      { name: 'Errores', files: 90, bytes: 44 * 1024 * 1024 }
    ]
  };
  if (actionId === 'repair_network') return { dnsCacheCleared: true, changedRouter: false, changedWifiPassword: false };
  return { preview: true };
}

export async function runAgentAction(actionId: string): Promise<AgentActionResult> {
  if (isTauriRuntime()) return safeInvoke<AgentActionResult>('run_agent_action', { actionId });
  await wait(420);
  return { action: actionId, ok: true, message: 'Listo.', details: [JSON.stringify(previewPayload(actionId))] };
}

export async function optimizeTempFiles(onProgress: (progress: OptimizerProgress) => void): Promise<AgentActionResult> {
  if (isTauriRuntime()) {
    const onEvent = new Channel<OptimizerProgress>();
    onEvent.onmessage = onProgress;
    return safeInvoke<AgentActionResult>('optimize_temp_files', { onEvent });
  }

  for (let percent = 0; percent <= 100; percent += 5) {
    onProgress({
      percent,
      processedFiles: Math.round(1801 * percent / 100),
      totalFiles: 1801,
      freedBytes: Math.round(721 * 1024 * 1024 * percent / 100),
      current: percent === 100 ? 'Listo' : 'Temporales'
    });
    await wait(70);
  }
  return {
    action: 'clean_temp_files',
    ok: true,
    message: 'Optimización terminada.',
    details: [JSON.stringify({
      generatedAt: new Date().toISOString(), deletedFiles: 1801, freedBytes: 721 * 1024 * 1024, freedMb: 721, failedFiles: 0,
      categories: [
        { name: 'Temporales', deleted: 1494, freedBytes: 553 * 1024 * 1024, failed: 0 },
        { name: 'Windows Temp', deleted: 218, freedBytes: 125 * 1024 * 1024, failed: 0 },
        { name: 'Errores', deleted: 89, freedBytes: 43 * 1024 * 1024, failed: 0 }
      ]
    })]
  };
}
