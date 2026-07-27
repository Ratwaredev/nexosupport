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
  source: 'libre-hardware-monitor' | 'acpi-fallback' | 'browser-demo';
  elevated: boolean;
  permissionRequired: boolean;
  note: string;
  sensors: HardwareSensor[];
};

export type SensorSummary = {
  cpuTemperatureC: number | null;
  gpuTemperatureC: number | null;
  storageTemperatureC: number | null;
  cpuLoadPercent: number | null;
  gpuLoadPercent: number | null;
  fanRpm: number | null;
  source: HardwareSnapshot['source'];
  note: string;
};

export async function readHardwareSensors(elevated = false): Promise<HardwareSnapshot> {
  if (isTauriRuntime()) {
    return safeInvoke<HardwareSnapshot>('read_hardware_sensors', { elevated });
  }
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
      { hardwareType: 'GpuNvidia', hardwareName: 'GPU demo', sensorType: 'Temperature', sensorName: 'GPU Core', value: 45 },
      { hardwareType: 'Storage', hardwareName: 'SSD demo', sensorType: 'Temperature', sensorName: 'Temperature', value: 39 }
    ]
  };
}

function firstValue(snapshot: HardwareSnapshot, predicate: (sensor: HardwareSensor) => boolean) {
  const values = snapshot.sensors.filter(predicate).map((sensor) => sensor.value).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

export function summarizeHardware(snapshot: HardwareSnapshot): SensorSummary {
  const type = (sensor: HardwareSensor) => sensor.hardwareType.toLowerCase();
  const sensorType = (sensor: HardwareSensor) => sensor.sensorType.toLowerCase();
  const name = (sensor: HardwareSensor) => `${sensor.hardwareName} ${sensor.sensorName}`.toLowerCase();
  return {
    cpuTemperatureC: firstValue(snapshot, (sensor) => type(sensor).includes('cpu') && sensorType(sensor) === 'temperature' && /(package|tdie|tctl|core|max)/.test(name(sensor))),
    gpuTemperatureC: firstValue(snapshot, (sensor) => type(sensor).includes('gpu') && sensorType(sensor) === 'temperature'),
    storageTemperatureC: firstValue(snapshot, (sensor) => type(sensor).includes('storage') && sensorType(sensor) === 'temperature'),
    cpuLoadPercent: firstValue(snapshot, (sensor) => type(sensor).includes('cpu') && sensorType(sensor) === 'load' && /(total|cpu total|max)/.test(name(sensor))),
    gpuLoadPercent: firstValue(snapshot, (sensor) => type(sensor).includes('gpu') && sensorType(sensor) === 'load' && /(core|gpu)/.test(name(sensor))),
    fanRpm: firstValue(snapshot, (sensor) => sensorType(sensor) === 'fan'),
    source: snapshot.source,
    note: snapshot.note
  };
}
