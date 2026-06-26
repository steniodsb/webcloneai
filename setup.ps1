param()
Set-Location $PSScriptRoot
Write-Host ""
Write-Host "  Web Clone AI - Setup" -ForegroundColor Cyan
Write-Host "  ====================" -ForegroundColor Cyan
Write-Host ""

# 1. JSZip
Write-Host "[1/3] Baixando JSZip..." -ForegroundColor Yellow
$jszipDest = Join-Path $PSScriptRoot "lib\jszip.min.js"
if (Test-Path $jszipDest) {
    Write-Host "    OK - jszip.min.js ja existe." -ForegroundColor Green
} else {
    try {
        Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" -OutFile $jszipDest -UseBasicParsing
        $sizeKB = [math]::Round((Get-Item $jszipDest).Length / 1024)
        Write-Host "    OK - jszip.min.js (${sizeKB}KB)" -ForegroundColor Green
    } catch {
        Write-Host "    ERRO: $_" -ForegroundColor Red
    }
}

# 2. DM Sans font files (via @fontsource CDN - URLs estaveis)
Write-Host "[2/3] Baixando fonte DM Sans..." -ForegroundColor Yellow
$fontDir = Join-Path $PSScriptRoot "fonts"
if (-not (Test-Path $fontDir)) { New-Item -ItemType Directory $fontDir | Out-Null }

$fontBase = "https://cdn.jsdelivr.net/npm/@fontsource/dm-sans@5.0.13/files"
$fonts = @(
    @{ url = "$fontBase/dm-sans-latin-400-normal.woff2"; dest = "dm-sans-400.woff2" },
    @{ url = "$fontBase/dm-sans-latin-500-normal.woff2"; dest = "dm-sans-500.woff2" },
@{ url = "$fontBase/dm-sans-latin-700-normal.woff2"; dest = "dm-sans-700.woff2" }
)

foreach ($f in $fonts) {
    $dest = Join-Path $fontDir $f.dest
    if (Test-Path $dest) {
        Write-Host "    OK - $($f.dest) ja existe." -ForegroundColor Green
        continue
    }
    try {
        Invoke-WebRequest -Uri $f.url -OutFile $dest -UseBasicParsing
        $kb = [math]::Round((Get-Item $dest).Length / 1024)
        Write-Host "    OK - $($f.dest) (${kb}KB)" -ForegroundColor Green
    } catch {
        Write-Host "    ERRO em $($f.dest): $_" -ForegroundColor Red
    }
}

# 3. Gerar icones PNG com design de dois quadrados sobrepostos (glass)
Write-Host "[3/3] Gerando icones PNG..." -ForegroundColor Yellow

$iconDir = Join-Path $PSScriptRoot "icons"
if (-not (Test-Path $iconDir)) { New-Item -ItemType Directory $iconDir | Out-Null }

function New-ExtIcon {
    param([int]$Size, [string]$OutPath)
    Add-Type -AssemblyName System.Drawing

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    # Fundo escuro com borda arredondada
    $bgRadius = [int]($Size * 0.22)
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bgPath.AddArc($bgRect.X, $bgRect.Y, $bgRadius*2, $bgRadius*2, 180, 90)
    $bgPath.AddArc($bgRect.Right - $bgRadius*2, $bgRect.Y, $bgRadius*2, $bgRadius*2, 270, 90)
    $bgPath.AddArc($bgRect.Right - $bgRadius*2, $bgRect.Bottom - $bgRadius*2, $bgRadius*2, $bgRadius*2, 0, 90)
    $bgPath.AddArc($bgRect.X, $bgRect.Bottom - $bgRadius*2, $bgRadius*2, $bgRadius*2, 90, 90)
    $bgPath.CloseFigure()
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 8, 8, 16))
    $g.FillPath($bgBrush, $bgPath)

    # Funcao auxiliar para desenhar quadrado de vidro
    function Draw-GlassSquare {
        param([int]$X, [int]$Y, [int]$W, [int]$H, [int]$Radius, [int]$Alpha)
        $rect = New-Object System.Drawing.Rectangle($X, $Y, $W, $H)
        $sqPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $sqPath.AddArc($rect.X, $rect.Y, $Radius*2, $Radius*2, 180, 90)
        $sqPath.AddArc($rect.Right - $Radius*2, $rect.Y, $Radius*2, $Radius*2, 270, 90)
        $sqPath.AddArc($rect.Right - $Radius*2, $rect.Bottom - $Radius*2, $Radius*2, $Radius*2, 0, 90)
        $sqPath.AddArc($rect.X, $rect.Bottom - $Radius*2, $Radius*2, $Radius*2, 90, 90)
        $sqPath.CloseFigure()

        # Preenchimento semitransparente (vidro)
        $fillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($Alpha, 220, 220, 255))
        $g.FillPath($fillBrush, $sqPath)

        # Borda prateada com gradiente
        $penLight = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 255, 255, 255), [float]([math]::Max(1, $Size * 0.016)))
        $g.DrawPath($penLight, $sqPath)
        $fillBrush.Dispose()
        $penLight.Dispose()
        $sqPath.Dispose()
    }

    # Calcular proporcoes
    $sq  = [int]($Size * 0.56)
    $off = [int]($Size * 0.25)
    $x1  = [int]($Size * 0.08)
    $y1  = [int]($Size * 0.08)
    $x2  = $x1 + $off
    $y2  = $y1 + $off
    $rad = [int]($sq * 0.20)

    # Sombra do segundo quadrado
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 0, 0, 0))
    $shadowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $shadowRect = New-Object System.Drawing.Rectangle(($x2 + 2), ($y2 + 3), $sq, $sq)
    $shadowPath.AddArc($shadowRect.X, $shadowRect.Y, $rad*2, $rad*2, 180, 90)
    $shadowPath.AddArc($shadowRect.Right - $rad*2, $shadowRect.Y, $rad*2, $rad*2, 270, 90)
    $shadowPath.AddArc($shadowRect.Right - $rad*2, $shadowRect.Bottom - $rad*2, $rad*2, $rad*2, 0, 90)
    $shadowPath.AddArc($shadowRect.X, $shadowRect.Bottom - $rad*2, $rad*2, $rad*2, 90, 90)
    $shadowPath.CloseFigure()
    $g.FillPath($shadowBrush, $shadowPath)
    $shadowBrush.Dispose()
    $shadowPath.Dispose()

    # Quadrado 1 (atras)
    Draw-GlassSquare -X $x1 -Y $y1 -W $sq -H $sq -Radius $rad -Alpha 38

    # Quadrado 2 (frente)
    Draw-GlassSquare -X $x2 -Y $y2 -W $sq -H $sq -Radius $rad -Alpha 55

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

foreach ($sz in @(16, 48, 128)) {
    $dest = Join-Path $iconDir "icon${sz}.png"
    try {
        New-ExtIcon -Size $sz -OutPath $dest
        Write-Host "    OK - icon${sz}.png" -ForegroundColor Green
    } catch {
        Write-Host "    AVISO: falha ao gerar icon${sz}.png" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "  Setup concluido!" -ForegroundColor Green
Write-Host ""
Write-Host "  Proximos passos:" -ForegroundColor Cyan
Write-Host "  1. chrome://extensions > Modo desenvolvedor > Carregar sem compactacao" -ForegroundColor White
$here = $PSScriptRoot
Write-Host "  2. Selecione: $here" -ForegroundColor White
Write-Host ""
