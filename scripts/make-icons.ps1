# Generate pi-agent desktop icons (System.Drawing, no external deps).
# Usage: powershell -File scripts/make-icons.ps1
param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Join-Path $PSScriptRoot '..\src-tauri\icons'
New-Item -ItemType Directory -Force -Path $root | Out-Null

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $m = [Math]::Max(2, [int]($size * 0.10))
  $w = $size - 2 * $m
  Write-Host "New-IconBitmap size=$size m=$m w=$w"
  $rect = New-Object System.Drawing.Rectangle -ArgumentList @($m, $m, $w, $w)
  $c1 = [System.Drawing.Color]::FromArgb(255, 9, 105, 218)
  $brush = New-Object System.Drawing.SolidBrush -ArgumentList $c1
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = [int]($w * 0.22)
  $path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
  $path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
  $path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath($brush, $path)

  $font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', ([float]($size * 0.52)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rectF = New-Object System.Drawing.RectangleF -ArgumentList ([float]0), ([float]($size * 0.02)), ([float]$size), ([float]$size)
  $g.DrawString('P', $font, [System.Drawing.Brushes]::White, $rectF, $fmt)

  $g.Dispose()
  return $bmp
}

foreach ($s in @(32, 128, 512)) {
  $bmp = New-IconBitmap $s
  if ($s -eq 512) { $bmp.Save((Join-Path $root 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  else { $bmp.Save((Join-Path $root "$s`x$s.png"), [System.Drawing.Imaging.ImageFormat]::Png) }
  if ($s -eq 32) {
    $hicon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hicon)
    $fs = [System.IO.File]::Create((Join-Path $root 'icon.ico'))
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose()
  }
  $bmp.Dispose()
}
Write-Host "icons written to $root"
