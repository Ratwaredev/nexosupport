import { isTauriRuntime, safeInvoke } from './tauri';

export type HardwareSensor = {
  hardwareType: string;
  hardwareName: string;
  sensorType: string;
  sensorName: string;
  value: number;
  min?: number | null;
  max?: number | null;
};

export type HardwareSnapshot = {
  generatedAt: string;
  source: 'native-helper' | 'libre-hardware-monitor' | 'acpi-fallback' | 'browser-demo' | 'unavailable';
  elevated: boolean;
  permissionRequired: boolean;
  note: string;
  sensors: HardwareSensor[];
};

export type SensorSummary = {
  cpuTemperatureC: number | null;
  gpuTemperatureC: number | null;
  storageTemperatureC: number | null;
  systemTemperatureC: number | null;
  cpuLoadPercent: number | null;
  gpuLoadPercent: number | null;
  fanRpm: number | null;
  temperatureAvailable: boolean;
  temperatureTrusted: boolean;
  sourceLabel: string;
  source: HardwareSnapshot['source'];
  note: string;
};

export async function readHardwareSensors(elevated = false): Promise<HardwareSnapshot> {
  if (isTauriRuntime()) return safeInvoke<HardwareSnapshot>('read_hardware_sensors', { elevated });
  await new Promise((resolve) => setTimeout(resolve, 650));
  return {
    generatedAt: new Date().toISOString(),
    source: 'browser-demo',
    elevated: false,
    permissionRequired: false,
    note: 'Vista previa: la lectura real funciona en la aplicación de Windows.',
    sensors: [
      { hardwareType: 'Cpu', hardwareName: 'Procesador demo', sensorType: 'Temperature', sensorName: 'CPU Package', value: 48 },
      { hardwareType: 'Cpu', hardwareName: 'Procesador demo', sensorType: 'Load', sensorName: 'CPU Total', value: 22 },
      { hardwareType: 'GpuAmd', hardwareName: 'GPU demo', sensorType: 'Temperature', sensorName: 'GPU Core', value: 45 },
      { hardwareType: 'Storage', hardwareName: 'SSD demo', sensorType: 'Temperature', sensorName: 'Temperature', value: 39 },
      { hardwareType: 'Motherboard', hardwareName: 'Placa demo', sensorType: 'Temperature', sensorName: 'System', value: 42 }
    ]
  };
}

function typeOf(sensor: HardwareSensor) {
  return sensor.hardwareType.toLowerCase();
}

function sensorTypeOf(sensor: HardwareSensor) {
  return sensor.sensorType.toLowerCase();
}

function nameOf(sensor: HardwareSensor) {
  return `${sensor.hardwareName} ${sensor.sensorName}`.toLowerCase();
}

function plausibleTemperature(sensor: HardwareSensor) {
  if (sensorTypeOf(sensor) !== 'temperature' || !Number.isFinite(sensor.value)) return false;
  const type = typeOf(sensor);
  const max = type.includes('storage') ? 100 : 125;
  return sensor.value >= 5 && sensor.value <= max;
}

function firstValue(snapshot: HardwareSnapshot, predicate: (sensor: HardwareSensor) => boolean) {
  const values = snapshot.sensors
    .filter(predicate)
    .map((sensor) => sensor.value)
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function sourceLabel(source: HardwareSnapshot['source']) {
  if (source === 'native-helper' || source === 'libre-hardware-monitor') return 'Lectura directa del hardware';
  if (source === 'acpi-fallback') return 'Temperatura general aproximada';
  if (source === 'browser-demo') return 'Vista previa';
  return 'No detectado';
}

export function summarizeHardware(snapshot: HardwareSnapshot): SensorSummary {
  const cpuTemperatures = snapshot.sensors.filter((sensor) => typeOf(sensor).includes('cpu') && plausibleTemperature(sensor));
  const preferredCpu = firstValue(snapshot, (sensor) =>
    typeOf(sensor).includes('cpu')
    && plausibleTemperature(sensor)
    && /(package|tdie|tctl|core|max|ccd)/.test(nameOf(sensor))
  );
  const cpuTemperatureC = preferredCpu ?? (cpuTemperatures.length ? Math.max(...cpuTemperatures.map((sensor) => sensor.value)) : null);
  const gpuTemperatureC = firstValue(snapshot, (sensor) => typeOf(sensor).includes('gpu') && plausibleTemperature(sensor));
  const storageTemperatureC = firstValue(snapshot, (sensor) => typeOf(sensor).includes('storage') && plausibleTemperature(sensor));
  const systemTemperatureC = firstValue(snapshot, (sensor) => {
    const type = typeOf(sensor);
    return plausibleTemperature(sensor)
      && !type.includes('cpu')
      && !type.includes('gpu')
      && !type.includes('storage');
  });
  const temperatureAvailable = [cpuTemperatureC, gpuTemperatureC, storageTemperatureC, systemTemperatureC].some((value) => value != null);

  return {
    cpuTemperatureC,
    gpuTemperatureC,
    storageTemperatureC,
    systemTemperatureC,
    cpuLoadPercent: firstValue(snapshot, (sensor) => typeOf(sensor).includes('cpu') && sensorTypeOf(sensor) === 'load' && /(total|cpu total|max)/.test(nameOf(sensor))),
    gpuLoadPercent: firstValue(snapshot, (sensor) => typeOf(sensor).includes('gpu') && sensorTypeOf(sensor) === 'load' && /(core|gpu)/.test(nameOf(sensor))),
    fanRpm: firstValue(snapshot, (sensor) => sensorTypeOf(sensor) === 'fan' && sensor.value >= 0),
    temperatureAvailable,
    temperatureTrusted: temperatureAvailable && snapshot.source !== 'acpi-fallback' && snapshot.source !== 'unavailable',
    sourceLabel: sourceLabel(snapshot.source),
    source: snapshot.source,
    note: snapshot.note
  };
}
