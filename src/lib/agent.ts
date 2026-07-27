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

export async function runAgentAction(actionId: string): Promise<AgentActionResult> {
  if (isTauriRuntime()) return safeInvoke<AgentActionResult>('run_agent_action', { actionId });
  await wait(720);
  return {
    action: actionId,
    ok: true,
    message: actionId === 'network_check' ? 'La conexión responde correctamente.' : `Acción de prueba completada: ${actionId}`,
    details: ['Vista de navegador: no se modificó el sistema.', 'En el ejecutable Tauri se usa la herramienta local autorizada.']
  };
}
