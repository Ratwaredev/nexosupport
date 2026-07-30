using System.Security.Principal;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

namespace Nexo.SensorReader;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public static int Main(string[] args)
    {
        var outputPath = ReadArgument(args, "--output");
        try
        {
            var snapshot = Capture();
            var json = JsonSerializer.Serialize(snapshot, JsonOptions);
            if (!string.IsNullOrWhiteSpace(outputPath))
            {
                File.WriteAllText(outputPath, json);
            }
            else
            {
                Console.Out.Write(json);
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Sensor reader failed: {error.GetType().Name}: {error.Message}");
            return 2;
        }
    }

    private static HardwareSnapshot Capture()
    {
        var elevated = IsAdministrator();
        var computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsMotherboardEnabled = true,
            IsControllerEnabled = true,
            IsStorageEnabled = true,
            IsNetworkEnabled = false
        };

        try
        {
            try
            {
                computer.Open();
            }
            catch
            {
                return new HardwareSnapshot(
                    DateTimeOffset.UtcNow.ToString("O"),
                    "native-helper",
                    elevated,
                    !elevated,
                    !elevated
                        ? "Para acceder a los sensores internos puede hacer falta autorización de administrador."
                        : "No se pudo abrir el controlador de sensores del equipo.",
                    Array.Empty<HardwareSensor>());
            }

            var visitor = new UpdateVisitor();
            for (var attempt = 0; attempt < 3; attempt++)
            {
                computer.Accept(visitor);
                Thread.Sleep(attempt == 0 ? 700 : 450);
            }

            var sensors = new List<HardwareSensor>();
            foreach (var hardware in computer.Hardware)
            {
                ReadHardware(hardware, sensors);
            }

            var temperatureSensors = sensors
                .Where(sensor => sensor.SensorType.Equals("Temperature", StringComparison.OrdinalIgnoreCase))
                .ToArray();
            var hasTemperature = temperatureSensors.Length > 0;
            var hasCpuTemperature = temperatureSensors.Any(sensor =>
                sensor.HardwareType.Contains("Cpu", StringComparison.OrdinalIgnoreCase));
            var hasDirectComponentTemperature = temperatureSensors.Any(sensor =>
                sensor.HardwareType.Contains("Cpu", StringComparison.OrdinalIgnoreCase)
                || sensor.HardwareType.Contains("Gpu", StringComparison.OrdinalIgnoreCase)
                || sensor.HardwareType.Contains("Storage", StringComparison.OrdinalIgnoreCase));

            // No CPU temperature does not automatically mean a Windows permission problem.
            // We request elevation only when the non-elevated scan found no plausible temperature at all.
            var permissionRequired = !elevated && !hasTemperature;
            var note = hasCpuTemperature
                ? "Temperatura del procesador leída directamente del hardware."
                : hasDirectComponentTemperature
                    ? "Se detectaron temperaturas de componentes, pero el procesador no expuso una lectura."
                    : hasTemperature
                        ? "Se detectó una temperatura general del equipo. Puede no representar la CPU."
                        : permissionRequired
                            ? "No apareció ningún sensor. Reintentá como administrador para habilitar el acceso al hardware."
                            : "Incluso con autorización, este equipo no expone temperaturas compatibles.";

            return new HardwareSnapshot(
                DateTimeOffset.UtcNow.ToString("O"),
                "native-helper",
                elevated,
                permissionRequired,
                note,
                sensors);
        }
        finally
        {
            try { computer.Close(); } catch { }
        }
    }

    private static void ReadHardware(IHardware hardware, ICollection<HardwareSensor> result)
    {
        try { hardware.Update(); } catch { }
        foreach (var sensor in hardware.Sensors)
        {
            if (sensor.Value is null || !float.IsFinite(sensor.Value.Value)) continue;
            var value = sensor.Value.Value;
            if (!IsPlausible(sensor.SensorType, value)) continue;

            result.Add(new HardwareSensor(
                hardware.HardwareType.ToString(),
                hardware.Name,
                sensor.SensorType.ToString(),
                sensor.Name,
                Math.Round(value, 2),
                sensor.Min is null || !float.IsFinite(sensor.Min.Value) ? null : Math.Round(sensor.Min.Value, 2),
                sensor.Max is null || !float.IsFinite(sensor.Max.Value) ? null : Math.Round(sensor.Max.Value, 2)));
        }
        foreach (var child in hardware.SubHardware)
        {
            ReadHardware(child, result);
        }
    }

    private static bool IsPlausible(SensorType type, float value)
    {
        return type switch
        {
            SensorType.Temperature => value is >= 5 and <= 125,
            SensorType.Load => value is >= 0 and <= 100,
            SensorType.Fan => value is >= 0 and <= 100000,
            SensorType.Clock => value is >= 0 and <= 100000,
            _ => true
        };
    }

    private static bool IsAdministrator()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    private static string? ReadArgument(IReadOnlyList<string> args, string name)
    {
        for (var index = 0; index < args.Count - 1; index++)
        {
            if (args[index].Equals(name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        }
        return null;
    }
}

internal sealed class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) => computer.Traverse(this);
    public void VisitHardware(IHardware hardware)
    {
        try { hardware.Update(); } catch { }
        foreach (var subHardware in hardware.SubHardware) subHardware.Accept(this);
    }
    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}

internal sealed record HardwareSnapshot(
    string GeneratedAt,
    string Source,
    bool Elevated,
    bool PermissionRequired,
    string Note,
    IReadOnlyCollection<HardwareSensor> Sensors);

internal sealed record HardwareSensor(
    string HardwareType,
    string HardwareName,
    string SensorType,
    string SensorName,
    double Value,
    double? Min,
    double? Max);
