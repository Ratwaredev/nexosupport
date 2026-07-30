$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceSize = 256
$source = New-Object System.Drawing.Bitmap($sourceSize, $sourceSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$sourceGraphics = [System.Drawing.Graphics]::FromImage($source)
try {
  $sourceGraphics.Clear([System.Drawing.Color]::Transparent)
  $sourceGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $sourceGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $sourceGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $rect = New-Object System.Drawing.Rectangle(34, 28, 188, 200)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 118, 87, 255),
    [System.Drawing.Color]::FromArgb(255, 37, 143, 224),
    45.0
  )
  try {
    $pen = New-Object System.Drawing.Pen($brush, 28)
    try {
      $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $sourceGraphics.DrawLine($pen, 52, 42, 204, 214)
      $sourceGraphics.DrawLine($pen, 204, 42, 52, 214)
    } finally {
      $pen.Dispose()
    }
  } finally {
    $brush.Dispose()
  }
} finally {
  $sourceGraphics.Dispose()
}

$sizes = @(16,20,24,32,40,48,64,128,256)
$frames = New-Object System.Collections.Generic.List[byte[]]
try {
  foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $size, $size)
      } finally {
        $graphics.Dispose()
      }
      $stream = New-Object System.IO.MemoryStream
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $frames.Add($stream.ToArray())
      } finally {
        $stream.Dispose()
      }
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $source.Dispose()
}

$target = Join-Path $PSScriptRoot '..\src-tauri\icons\icon.ico'
$target = [System.IO.Path]::GetFullPath($target)
New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
$output = New-Object System.IO.FileStream($target, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter($output)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$sizes.Count)
  $offset = 6 + (16 * $sizes.Count)
  for ($index = 0; $index -lt $sizes.Count; $index++) {
    $size = $sizes[$index]
    $frame = $frames[$index]
    $writer.Write([Byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([Byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frame.Length)
    $writer.Write([UInt32]$offset)
    $offset += $frame.Length
  }
  foreach ($frame in $frames) { $writer.Write($frame) }
} finally {
  $writer.Dispose()
  $output.Dispose()
}

if ((Get-Item $target).Length -lt 5000) { throw 'Generated icon is unexpectedly small.' }
Write-Host "Transparent NEXO icon generated at $target"
