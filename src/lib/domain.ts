export type Role = 'admin' | 'client';
export type TicketStatus = 'nuevo' | 'esperando' | 'en-remoto' | 'cerrado';
export type Priority = 'normal' | 'alta';
export type ReleaseChannel = 'stable' | 'beta';
export type BackendKind = 'local' | 'supabase';
export type SupportUserStatus = 'active' | 'suspended';
export type EntitlementStatus = 'inactive' | 'active' | 'suspended';

export type RuntimeConfig = {
  backendKind: BackendKind;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  defaultOrgName: string;
  remoteToolUrl: string;
  localAdminEmail: string;
  localAdminPassword: string;
  localAdminOrg: string;
};

export type AppSession = {
  role: Role;
  backendKind: BackendKind;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  displayName?: string;
  orgName?: string;
  deviceId?: string;
  deviceToken?: string;
};

export type DeviceRecord = {
  id: string;
  orgName: string;
  supportUserId?: string | null;
  displayName: string;
  computerName: string;
  userName: string;
  os: string;
  platform: string;
  pairingCode?: string;
  deviceToken?: string;
  status: 'idle' | 'waiting' | 'en-remoto' | 'maintenance';
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportUserRecord = {
  id: string;
  orgName: string;
  fullName: string;
  email?: string | null;
  status: SupportUserStatus;
  defaultPlan: string;
  defaultModel?: string | null;
  monthlyMessageLimit?: number | null;
  isStaff: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DeviceEntitlementRecord = {
  deviceId: string;
  status: EntitlementStatus;
  plan: string;
  model?: string | null;
  monthlyMessageLimit?: number | null;
  messagesUsed: number;
  periodStart: string;
  createdAt: string;
  updatedAt: string;
};

export type DeviceConsentRecord = {
  deviceId: string;
  assistantEnabled: boolean;
  shareDiagnostics: boolean;
  automaticChecks: boolean;
  hardwareSensors: boolean;
  elevatedSensors: boolean;
  updatedAt: string;
};

export type TicketRecord = {
  id: string;
  deviceId: string;
  clientName: string;
  issue: string;
  status: TicketStatus;
  priority: Priority;
  remoteCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type DiagnosticRecord = {
  id: string;
  deviceId: string;
  generatedAt: string;
  payload: Record<string, unknown>;
};

export type SessionRecord = {
  id: string;
  ticketId: string;
  deviceId: string;
  code: string;
  expiresInMinutes: number;
  instructions: string;
  createdAt: string;
};

export type ReleaseRecord = {
  id: string;
  channel: ReleaseChannel;
  version: string;
  notes: string;
  manifestUrl: string;
  signature: string;
  publishedAt: string;
  isActive: boolean;
};

export type PairingCodeRecord = {
  code: string;
  orgName: string;
  supportUserId?: string | null;
  expiresAt: string;
  claimedAt?: string;
  claimedDeviceId?: string;
  createdAt: string;
};

export type AdminProfile = {
  userId: string;
  email: string;
  orgName: string;
  role: 'admin';
};

export type ClientBootstrap = {
  session: AppSession;
  device: DeviceRecord;
};

export type AdminDashboard = {
  profile: AdminProfile;
  users: SupportUserRecord[];
  devices: DeviceRecord[];
  entitlements: DeviceEntitlementRecord[];
  tickets: TicketRecord[];
  diagnostics: DiagnosticRecord[];
  releases: ReleaseRecord[];
  pairingCodes: PairingCodeRecord[];
};

export type ClientDashboard = {
  device: DeviceRecord;
  consent?: DeviceConsentRecord | null;
  entitlement?: DeviceEntitlementRecord | null;
  tickets: TicketRecord[];
  diagnostics: DiagnosticRecord[];
  latestRelease?: ReleaseRecord | null;
  latestSession?: SessionRecord | null;
};

export type UpdateResult = {
  status: 'available' | 'current' | 'unconfigured' | 'error';
  currentVersion: string;
  nextVersion?: string;
  notes: string;
  manifestUrl?: string;
  signature?: string;
};

export type SignInResult = {
  session: AppSession;
  profile: AdminProfile;
};

export type RegisterClientInput = {
  pairingCode: string;
  deviceName: string;
  issue?: string;
  computerName: string;
  userName: string;
  os: string;
  platform: string;
};

export type CreateTicketInput = {
  deviceId: string;
  issue: string;
  clientName: string;
  priority: Priority;
};

export type SaveDiagnosticInput = {
  deviceId: string;
  payload: Record<string, unknown>;
};

export type CreateSessionInput = {
  deviceId: string;
  ticketId: string;
};

export type CreateSupportUserInput = {
  fullName: string;
  email?: string;
  defaultPlan: string;
  monthlyMessageLimit?: number | null;
  isStaff?: boolean;
};

export type UpdateSupportUserInput = Partial<Pick<SupportUserRecord,
  'fullName' | 'email' | 'status' | 'defaultPlan' | 'defaultModel' | 'monthlyMessageLimit' | 'isStaff'
>>;

export type UpdateEntitlementInput = Partial<Pick<DeviceEntitlementRecord,
  'status' | 'plan' | 'model' | 'monthlyMessageLimit'
>>;

export type UpdateConsentInput = Pick<DeviceConsentRecord,
  'assistantEnabled' | 'shareDiagnostics' | 'automaticChecks' | 'hardwareSensors' | 'elevatedSensors'
>;

export const APP_VERSION = '0.2.2';

export const STORAGE_KEYS = {
  session: 'underdock.session.v1',
  legacySession: 'underdock.session.v1',
  clientSession: 'nexo.client-session.v2',
  adminSession: 'nexo.admin-session.v2',
  localState: 'underdock.local-state.v2'
} as const;

export const DEFAULT_REMOTE_INSTRUCTIONS =
  'Compartí este código con el técnico. La conexión remota solo se abre con autorización visible.';

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix = '') {
  const raw = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  return prefix ? `${prefix}${raw}` : raw;
}

export function createPairingCode() {
  return crypto.randomUUID().slice(0, 8).toUpperCase();
}

export function createSessionCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}
