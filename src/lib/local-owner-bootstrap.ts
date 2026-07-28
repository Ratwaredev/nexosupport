import { STORAGE_KEYS } from './domain';

type LocalUser = {
  id: string;
  orgName: string;
  fullName: string;
  email: string | null;
  status: 'active' | 'suspended';
  defaultPlan: string;
  defaultModel: string | null;
  monthlyMessageLimit: number | null;
  isStaff: boolean;
  createdAt: string;
  updatedAt: string;
};

type LocalDevice = {
  id: string;
  orgName: string;
  supportUserId: string | null;
  displayName: string;
  computerName: string;
  userName: string;
  os: string;
  platform: string;
  pairingCode?: string;
  deviceToken: string;
  status: 'idle' | 'waiting' | 'en-remoto' | 'maintenance';
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

type LocalEntitlement = {
  deviceId: string;
  status: 'inactive' | 'active' | 'suspended';
  plan: string;
  model: string | null;
  monthlyMessageLimit: number | null;
  messagesUsed: number;
  periodStart: string;
  createdAt: string;
  updatedAt: string;
};

type LocalConsent = {
  deviceId: string;
  assistantEnabled: boolean;
  shareDiagnostics: boolean;
  automaticChecks: boolean;
  hardwareSensors: boolean;
  elevatedSensors: boolean;
  updatedAt: string;
};

type LocalState = {
  profile: {
    userId: string;
    email: string;
    orgName: string;
    role: 'admin';
  };
  users: LocalUser[];
  devices: LocalDevice[];
  entitlements: LocalEntitlement[];
  consents: LocalConsent[];
  tickets: unknown[];
  diagnostics: unknown[];
  sessions: unknown[];
  releases: unknown[];
  pairingCodes: unknown[];
};

const OWNER_USER_ID = 'usr-fran';
const OWNER_DEVICE_ID = 'dev-fran';
const OWNER_DEVICE_TOKEN = 'tok-demo-fran';

function isDesktopTauri() {
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function hasRemoteBackend() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  return Boolean(url && key);
}

function readState(): Partial<LocalState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.localState);
    return raw ? JSON.parse(raw) as Partial<LocalState> : {};
  } catch {
    return {};
  }
}

function upsertById<T extends { id: string }>(items: T[] | undefined, next: T): T[] {
  const current = Array.isArray(items) ? items : [];
  const index = current.findIndex((item) => item.id === next.id);
  if (index < 0) return [next, ...current];
  const copy = [...current];
  copy[index] = { ...current[index], ...next };
  return copy;
}

function upsertByDeviceId<T extends { deviceId: string }>(items: T[] | undefined, next: T): T[] {
  const current = Array.isArray(items) ? items : [];
  const index = current.findIndex((item) => item.deviceId === next.deviceId);
  if (index < 0) return [next, ...current];
  const copy = [...current];
  copy[index] = { ...current[index], ...next };
  return copy;
}

export function ensureLocalOwnerWorkspace() {
  if (!isDesktopTauri() || hasRemoteBackend()) return;

  const now = new Date().toISOString();
  const orgName = (import.meta.env.VITE_LOCAL_ADMIN_ORG as string | undefined)?.trim() || 'NEXO Demo';
  const email = (import.meta.env.VITE_LOCAL_ADMIN_EMAIL as string | undefined)?.trim() || 'admin@nexo.local';
  const previous = readState();
  const previousDevice = previous.devices?.find((device) => device.id === OWNER_DEVICE_ID);
  const deviceToken = previousDevice?.deviceToken || OWNER_DEVICE_TOKEN;

  const ownerUser: LocalUser = {
    id: OWNER_USER_ID,
    orgName,
    fullName: 'Francisco',
    email,
    status: 'active',
    defaultPlan: 'pro',
    defaultModel: null,
    monthlyMessageLimit: 1000,
    isStaff: true,
    createdAt: previous.users?.find((user) => user.id === OWNER_USER_ID)?.createdAt || now,
    updatedAt: now
  };

  const ownerDevice: LocalDevice = {
    id: OWNER_DEVICE_ID,
    orgName,
    supportUserId: OWNER_USER_ID,
    displayName: 'Mi PC',
    computerName: previousDevice?.computerName || 'MI-PC',
    userName: previousDevice?.userName || 'Fran',
    os: previousDevice?.os || 'Windows',
    platform: 'windows',
    pairingCode: 'LOCAL-OWNER',
    deviceToken,
    status: previousDevice?.status || 'idle',
    lastSeenAt: now,
    createdAt: previousDevice?.createdAt || now,
    updatedAt: now
  };

  const entitlement: LocalEntitlement = {
    deviceId: OWNER_DEVICE_ID,
    status: 'active',
    plan: 'pro',
    model: null,
    monthlyMessageLimit: 1000,
    messagesUsed: previous.entitlements?.find((item) => item.deviceId === OWNER_DEVICE_ID)?.messagesUsed || 0,
    periodStart: previous.entitlements?.find((item) => item.deviceId === OWNER_DEVICE_ID)?.periodStart || now,
    createdAt: previous.entitlements?.find((item) => item.deviceId === OWNER_DEVICE_ID)?.createdAt || now,
    updatedAt: now
  };

  const consent: LocalConsent = {
    deviceId: OWNER_DEVICE_ID,
    assistantEnabled: true,
    shareDiagnostics: false,
    automaticChecks: false,
    hardwareSensors: true,
    elevatedSensors: false,
    updatedAt: now
  };

  const state: LocalState = {
    profile: {
      userId: 'local-admin',
      email,
      orgName,
      role: 'admin'
    },
    users: upsertById(previous.users, ownerUser),
    devices: upsertById(previous.devices, ownerDevice),
    entitlements: upsertByDeviceId(previous.entitlements, entitlement),
    consents: upsertByDeviceId(previous.consents, consent),
    tickets: Array.isArray(previous.tickets) ? previous.tickets : [],
    diagnostics: Array.isArray(previous.diagnostics) ? previous.diagnostics : [],
    sessions: Array.isArray(previous.sessions) ? previous.sessions : [],
    releases: Array.isArray(previous.releases) ? previous.releases : [],
    pairingCodes: Array.isArray(previous.pairingCodes) ? previous.pairingCodes : []
  };

  localStorage.setItem(STORAGE_KEYS.localState, JSON.stringify(state));
  localStorage.setItem(STORAGE_KEYS.clientSession, JSON.stringify({
    role: 'client',
    backendKind: 'local',
    deviceId: OWNER_DEVICE_ID,
    deviceToken,
    displayName: ownerDevice.displayName,
    orgName
  }));
  localStorage.setItem(STORAGE_KEYS.adminSession, JSON.stringify({
    role: 'admin',
    backendKind: 'local',
    userId: 'local-admin',
    accessToken: 'local-admin',
    email,
    displayName: 'Francisco',
    orgName
  }));
}
