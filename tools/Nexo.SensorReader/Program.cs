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
            computer.Open();
            var visitor = new UpdateVisitor();
            computer.Accept(visitor);
            Thread.Sleep(450);
            computer.Accept(visitor);

            var sensors = new List<HardwareSensor>();
            foreach (var hardware in computer.Hardware)
            {
                ReadHardware(hardware, sensors);
            }

            var hasTemperature = sensors.Any(sensor => sensor.SensorType.Equals("Temperature", StringComparison.OrdinalIgnoreCase));
            var hasCpuTemperature = sensors.Any(sensor =>
                sensor.SensorType.Equals("Temperature", StringComparison.OrdinalIgnoreCase) &&
                sensor.HardwareType.Contains("Cpu", StringComparison.OrdinalIgnoreCase));
            var permissionRequired = !elevated && !hasCpuTemperature;
            var note = hasTemperature
                ? "Sensores leídos directamente del hardware."
                : permissionRequired
                    ? "Windows puede requerir permiso para acceder a los sensores del firmware."
                    : "El fabricante no expone temperaturas compatibles a Windows.";

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
            result.Add(new HardwareSensor(
                hardware.HardwareType.ToString(),
                hardware.Name,
                sensor.SensorType.ToString(),
                sensor.Name,
                Math.Round(sensor.Value.Value, 2),
                sensor.Min is null ? null : Math.Round(sensor.Min.Value, 2),
                sensor.Max is null ? null : Math.Round(sensor.Max.Value, 2)));
        }
        foreach (var child in hardware.SubHardware)
        {
            ReadHardware(child, result);
        }
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
