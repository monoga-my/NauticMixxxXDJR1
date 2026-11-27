# Installs the Pioneer XDJ-R1 preset into an existing NauticMixxx 2.0 install
# on Windows, without rebuilding the app.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-xdj-r1-windows.ps1
#
# Close NauticMixxx first. The script copies the mapping, its shared RX3
# browser scripts and the RX3 PITCH / RX3 CRUSH Sound Color FX chains into
# %LOCALAPPDATA%\NauticMixxx, then puts the six RX3 Quick Effect presets at the
# top of the Quick Effect list in the order the mapping expects:
# REVERB, PING PONG, NOISE, FILTER, PITCH, CRUSH. Your other presets are kept.
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
                   'RX3 PITCH.xml', 'RX3 CRUSH.xml') {
    Copy-Item -LiteralPath (Join-Path $projectRoot "effects\chains\$chain") -Destination $chains -Force
}

$effects = Join-Path $ProfileDir 'effects.xml'
$xml = New-Object System.Xml.XmlDocument
if (Test-Path -LiteralPath $effects) {
    Copy-Item -LiteralPath $effects -Destination "$effects.before-xdj-r1" -Force
    $xml.Load($effects)
} else {
    [void]$xml.AppendChild($xml.CreateXmlDeclaration('1.0', 'utf-8', $null))
    [void]$xml.AppendChild($xml.CreateElement('Effects'))
}
$list = $xml.DocumentElement.SelectSingleNode('QuickEffectPresetList')
if ($null -eq $list) {
    $list = $xml.CreateElement('QuickEffectPresetList')
    [void]$xml.DocumentElement.AppendChild($list)
}
$wanted = @('RX3 REVERB', 'RX3 PING PONG', 'RX3 NOISE', 'RX3 FILTER', 'RX3 PITCH', 'RX3 CRUSH')
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
$xml.Save($effects)

Write-Host "XDJ-R1 preset installed in $controllers"
Write-Host 'Start NauticMixxx, open Preferences > Controllers, select the XDJ-R1, choose'
Write-Host '"Pioneer XDJ-R1 (NauticMixxx RX3)" and tick Enabled.'
