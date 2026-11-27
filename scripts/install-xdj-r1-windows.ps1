# Installs the Pioneer XDJ-R1 preset into an existing NauticMixxx 2.0 install
# on Windows, without rebuilding the app.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-xdj-r1-windows.ps1
#
# Close NauticMixxx first. The script copies the mapping, its shared RX3
# browser scripts and the RX3 PITCH / RX3 CRUSH Sound Color FX chains into
# %LOCALAPPDATA%\NauticMixxx, then puts the presets the mapping loads by
# position at the top of Mixxx's lists: REVERB, PING PONG, NOISE, FILTER,
# PITCH, CRUSH (Quick Effects) and XDJ-R1 TRANS, FLANGER, ECHO (effect chains).
# Your other presets are kept.
[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:LOCALAPPDATA 'NauticMixxx')
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (Get-Process -Name 'NauticMixxx', 'mixxx' -ErrorAction SilentlyContinue) {
    throw 'Close NauticMixxx before installing the XDJ-R1 preset.'
}

$controllers = Join-Path $ProfileDir 'controllers'
$chains = Join-Path $ProfileDir 'effects\chains'
New-Item -ItemType Directory -Path $controllers, $chains -Force | Out-Null

Get-ChildItem (Join-Path $projectRoot 'controllers\Pioneer_XDJ_R1_RX3') -File |
    Copy-Item -Destination $controllers -Force
foreach ($shared in 'Nautic-RX3-Browser.js', 'Nautic-RX3-Encoder-Pioneer-Roland.js') {
    Copy-Item (Join-Path $projectRoot "controllers\Pioneer_Roland_RX3\$shared") $controllers -Force
}
foreach ($chain in 'RX3 REVERB.xml', 'RX3 PING PONG.xml', 'RX3 NOISE.xml', 'RX3 FILTER.xml',
                   'RX3 PITCH.xml', 'RX3 CRUSH.xml',
                   'XDJ-R1 TRANS.xml', 'XDJ-R1 FLANGER.xml', 'XDJ-R1 ECHO.xml') {
    Copy-Item -LiteralPath (Join-Path $projectRoot "effects\chains\$chain") -Destination $chains -Force
}

# The skin's browser text uses Arial instead of the condensed Arial Narrow.
$skin = Join-Path $ProfileDir 'skins\XDJ_RX3_Mixxx'
if (Test-Path -LiteralPath $skin) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'skins\XDJ_RX3_Mixxx\style.qss') -Destination $skin -Force
}

$effects = Join-Path $ProfileDir 'effects.xml'
$xml = New-Object System.Xml.XmlDocument
if (Test-Path -LiteralPath $effects) {
    Copy-Item -LiteralPath $effects -Destination "$effects.before-xdj-r1" -Force
    $xml.Load($effects)
} else {
    [void]$xml.AppendChild($xml.CreateXmlDeclaration('1.0', 'utf-8', $null))
    [void]$xml.AppendChild($xml.CreateElement('MixxxEffects'))
}
function Set-PresetOrder($listName, [string[]]$wanted) {
    # Mixxx lists only the presets named here, in this order, after the empty
    # '---' preset at position 0. The mapping loads presets by that position.
    $list = $xml.DocumentElement.SelectSingleNode($listName)
    if ($null -eq $list) {
        $list = $xml.CreateElement($listName)
        [void]$xml.DocumentElement.AppendChild($list)
    }
    foreach ($child in @($list.ChildNodes)) {
        if ($child.Name -eq 'ChainPresetName' -and $wanted -contains $child.InnerText.Trim()) {
            [void]$list.RemoveChild($child)
        }
    }
    for ($i = $wanted.Count - 1; $i -ge 0; $i--) {
        $node = $xml.CreateElement('ChainPresetName')
        $node.InnerText = $wanted[$i]
        [void]$list.PrependChild($node)
    }
}
# Sound Color FX: positions 1-6 of the QuickEffect list.
Set-PresetOrder 'QuickEffectPresetList' @('RX3 REVERB', 'RX3 PING PONG', 'RX3 NOISE',
    'RX3 FILTER', 'RX3 PITCH', 'RX3 CRUSH')
# Beat FX: positions 1-3 of the effect chain list (effect units 3 and 4).
Set-PresetOrder 'ChainPresetList' @('XDJ-R1 TRANS', 'XDJ-R1 FLANGER', 'XDJ-R1 ECHO')
$xml.Save($effects)

Write-Host "XDJ-R1 preset installed in $controllers"
Write-Host 'Start NauticMixxx, open Preferences > Controllers, select the XDJ-R1, choose'
Write-Host '"Pioneer XDJ-R1 (NauticMixxx RX3)" and tick Enabled.'
