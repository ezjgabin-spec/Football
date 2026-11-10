# Ultimate Football for Unreal - installs the playable game into the project. Run in Windows PowerShell.
$ErrorActionPreference = 'Stop'
$proj = "C:\Users\ezjga\OneDrive\Documents\Unreal Projects\MyProject2"
$name = "MyProject2"
$api  = "MYPROJECT2_API"
$base = "https://raw.githubusercontent.com/ezjgabin-spec/Football/main/public/unreal/cpp/"
$src  = "$proj\Source\$name"
$utf8 = New-Object System.Text.UTF8Encoding $false
if (-not (Test-Path "$proj\$name.uproject")) { Write-Host "[FB] FAIL project not found at $proj"; return }
if (-not (Test-Path $src)) { Write-Host "[FB] FAIL no Source\$name folder"; return }

$files = @("FbData.h","FbSim.h","FbSim.cpp","FbMatch.h","FbMatch.cpp","FbHUD.h","FbHUD.cpp","FbPC.h","FbPC.cpp","FbGameMode.h","FbGameMode.cpp")
foreach ($f in $files) {
    $t = (Invoke-WebRequest -UseBasicParsing -UserAgent "Mozilla/5.0" -Uri ($base + $f)).Content
    if ($t -is [byte[]]) { $t = [System.Text.Encoding]::UTF8.GetString($t) }
    $t = $t.Replace("FBGAME_API", $api)
    [System.IO.File]::WriteAllText("$src\$f", $t, $utf8)
    Write-Host "[FB] OK   wrote $f ($($t.Length) chars)"
}

$build = @"
using UnrealBuildTool;

public class $name : ModuleRules
{
	public $name(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "AssetRegistry" });
	}
}
"@
[System.IO.File]::WriteAllText("$src\$name.Build.cs", $build, $utf8)
Write-Host "[FB] OK   Build.cs now lists AssetRegistry"

$ini = "$proj\Config\DefaultEngine.ini"
$sec = "[/Script/EngineSettings.GameMapsSettings]"
$new = @("GlobalDefaultGameMode=/Script/$name.FbGameMode", "GameDefaultMap=/Game/Football/Maps/FootballField.FootballField", "EditorStartupMap=/Game/Football/Maps/FootballField.FootballField")
$keys = @("GlobalDefaultGameMode", "GameDefaultMap", "EditorStartupMap")
$lines = @()
if (Test-Path $ini) { Copy-Item $ini "$ini.bak" -Force; $lines = @(Get-Content $ini) }
$kept = @()
foreach ($l in $lines) {
    $drop = $false
    foreach ($k in $keys) { if ($l.Trim().StartsWith($k + "=")) { $drop = $true } }
    if (-not $drop) { $kept += $l }
}
$idx = -1
for ($i = 0; $i -lt $kept.Count; $i++) { if ($kept[$i].Trim() -eq $sec) { $idx = $i; break } }
if ($idx -ge 0) {
    $out = @()
    for ($i = 0; $i -lt $kept.Count; $i++) { $out += $kept[$i]; if ($i -eq $idx) { $out += $new } }
} else {
    $out = $kept + @("", $sec) + $new
}
[System.IO.File]::WriteAllText($ini, (($out -join "`n") + "`n"), $utf8)
Write-Host "[FB] OK   DefaultEngine.ini: game mode = FbGameMode, start level = FootballField"

if (-not (Test-Path "$proj\Content\Football\Maps\FootballField.umap")) { Write-Host "[FB] WARNING the FootballField level is missing - tell Claude" }
Write-Host "[FB] DONE. Now CLOSE Unreal completely, double-click $name.uproject, click YES to build, then press Play."
