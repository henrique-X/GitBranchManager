# 生成 src-tauri/icons/icon.ico（256x256，GB 字样）
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::FromArgb(37, 99, 235))
$font = New-Object System.Drawing.Font('Segoe UI', 96, [System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$brush = [System.Drawing.Brushes]::White
$g.DrawString('GB', $font, $brush, 128, 128, $fmt)
$g.Dispose()
$pngPath = Join-Path $env:TEMP 'gbm_icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$png = [System.IO.File]::ReadAllBytes($pngPath)

# ICO 容器: 6字节头 + 16字节目录项 + PNG 数据
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)      # reserved
$bw.Write([uint16]1)      # type: icon
$bw.Write([uint16]1)      # count
$bw.Write([byte]0)        # width 0 = 256
$bw.Write([byte]0)        # height 0 = 256
$bw.Write([byte]0)        # palette
$bw.Write([byte]0)        # reserved
$bw.Write([uint16]1)      # planes
$bw.Write([uint16]32)     # bpp
$bw.Write([uint32]$png.Length)
$bw.Write([uint32]22)     # data offset
$bw.Write($png)
$bw.Flush()
[System.IO.File]::WriteAllBytes("$PSScriptRoot\..\src-tauri\icons\icon.ico", $ms.ToArray())
$bw.Close(); $ms.Close()
Write-Output ("icon.ico 已生成: {0} bytes" -f $png.Length)
