# Ultimate Football for Unreal - installs the code, builds it, makes the materials, starts the game, then shows the game's log lines.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$proj = "C:\Users\ezjga\OneDrive\Documents\Unreal Projects\MyProject2"
$name = "MyProject2"
$api  = "MYPROJECT2_API"
$ue   = "C:\Program Files\Epic Games\UE_5.8"
$src  = "$proj\Source\$name"
$utf8 = New-Object System.Text.UTF8Encoding $false
if (-not $FbRaw) { $FbRaw = "https://raw.githubusercontent.com/ezjgabin-spec/Football/main/public/unreal/" }
function Get-Text($rel) {
    $r = Invoke-WebRequest -UseBasicParsing -UserAgent "Mozilla/5.0" -Uri ($FbRaw + $rel)
    $t = $r.Content
    if ($t -is [byte[]]) { $t = [System.Text.Encoding]::UTF8.GetString($t) }
    return $t
}
if (-not (Test-Path "$proj\$name.uproject")) { Write-Host "[FB] FAIL project not found at $proj"; return }
if (-not (Test-Path $src)) { Write-Host "[FB] FAIL no Source\$name folder"; return }
if (Get-Process UnrealEditor -ErrorAction SilentlyContinue) { Write-Host "[FB] STOP: Unreal is still open. Close it completely, then run this again."; return }

# ---- 1. code
$files = @("FbData.h","FbSim.h","FbSim.cpp","FbMatch.h","FbMatch.cpp","FbHUD.h","FbHUD.cpp","FbPC.h","FbPC.cpp","FbGameMode.h","FbGameMode.cpp","FbWebGame.h","FbWebGame.cpp")
try {
    foreach ($f in $files) {
        $t = (Get-Text ("cpp/" + $f)).Replace("FBGAME_API", $api)
        [System.IO.File]::WriteAllText("$src\$f", $t, $utf8)
    }
    Write-Host "[FB] OK   code files written ($($files.Count))"
} catch { Write-Host "[FB] FAIL downloading code: $_"; return }

$build = @"
using UnrealBuildTool;

public class $name : ModuleRules
{
	public $name(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "AssetRegistry", "Slate", "SlateCore", "WebBrowser", "ProceduralMeshComponent", "Json" });
	}
}
"@
[System.IO.File]::WriteAllText("$src\$name.Build.cs", $build, $utf8)

# ---- 2. plugins the game needs (Unreal's web browser, procedural meshes)
$up = "$proj\$name.uproject"
$j = Get-Content $up -Raw | ConvertFrom-Json
$pl = @()
if ($j.PSObject.Properties.Name -contains "Plugins") { $pl = @($j.Plugins) }
$changed = $false
foreach ($pn in @("WebBrowserWidget", "ProceduralMeshComponent", "PythonScriptPlugin")) {
    if (-not ($pl | Where-Object { $_.Name -eq $pn })) { $pl += [pscustomobject]@{ Name = $pn; Enabled = $true }; $changed = $true }
}
if ($changed) {
    if ($j.PSObject.Properties.Name -contains "Plugins") { $j.Plugins = $pl } else { $j | Add-Member -NotePropertyName Plugins -NotePropertyValue $pl }
    Copy-Item $up "$up.bak3" -Force
    [System.IO.File]::WriteAllText($up, ($j | ConvertTo-Json -Depth 20), $utf8)
    Write-Host "[FB] OK   plugins turned on in the project file"
}

# ---- 3. project settings: this game mode, this level
$ini = "$proj\Config\DefaultEngine.ini"
$sec = "[/Script/EngineSettings.GameMapsSettings]"
$new = @("GlobalDefaultGameMode=/Script/$name.FbGameMode", "GameDefaultMap=/Game/Football/Maps/FootballField.FootballField", "EditorStartupMap=/Game/Football/Maps/FootballField.FootballField")
$keys = @("GlobalDefaultGameMode", "GameDefaultMap", "EditorStartupMap")
$lines = @()
if (Test-Path $ini) { $lines = @(Get-Content $ini) }
$kept = @()
foreach ($l in $lines) { $drop = $false; foreach ($k in $keys) { if ($l.Trim().StartsWith($k + "=")) { $drop = $true } }; if (-not $drop) { $kept += $l } }
$idx = -1
for ($i = 0; $i -lt $kept.Count; $i++) { if ($kept[$i].Trim() -eq $sec) { $idx = $i; break } }
if ($idx -ge 0) { $out = @(); for ($i = 0; $i -lt $kept.Count; $i++) { $out += $kept[$i]; if ($i -eq $idx) { $out += $new } } } else { $out = $kept + @("", $sec) + $new }
[System.IO.File]::WriteAllText($ini, (($out -join "`n") + "`n"), $utf8)

# ---- 4. the bridge script (runs inside the game page) and the material script
try {
    New-Item -ItemType Directory -Force -Path "$proj\FbWeb" | Out-Null
    $js = Get-Text "web/ue_bridge.js"
    [System.IO.File]::WriteAllText("$proj\FbWeb\ue_bridge.js", $js, $utf8)
    $pyDir = "$env:USERPROFILE\fbweb"
    New-Item -ItemType Directory -Force -Path $pyDir | Out-Null
    $py = Get-Text "web/make_web_materials.py"
    [System.IO.File]::WriteAllText("$pyDir\make_web_materials.py", $py, $utf8)
    Write-Host "[FB] OK   bridge script ($($js.Length) chars) and material script written"
} catch { Write-Host "[FB] FAIL downloading web files: $_"; return }

# ---- 5. build
Write-Host "[FB] building (a few minutes)..."
& "$ue\Engine\Build\BatchFiles\Build.bat" "${name}Editor" Win64 Development "-Project=$proj\$name.uproject" *> "$env:USERPROFILE\build_log.txt"
$res = Select-String -Path "$env:USERPROFILE\build_log.txt" -Pattern "Result: Succeeded" -Quiet
if (-not $res) {
    Write-Host "[FB] BUILD FAILED - send these lines to Claude:"
    Select-String -Path "$env:USERPROFILE\build_log.txt" -Pattern "error|Error:|Result:" | Select-Object -First 40 | ForEach-Object { $_.Line }
    return
}
Write-Host "[FB] OK   build succeeded"

# ---- 6. materials (only when they are not there yet)
if (-not (Test-Path "$proj\Content\Football\Web\M_FbAdd.uasset")) {
    Write-Host "[FB] making the materials (a minute or two, one time)..."
    & "$ue\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "$proj\$name.uproject" -run=pythonscript "-script=$pyDir\make_web_materials.py" -unattended -nosplash *> "$env:USERPROFILE\mat_log.txt"
    Select-String -Path "$env:USERPROFILE\mat_log.txt", "$proj\Saved\Logs\$name.log" -Pattern "\[FBM\]" -ErrorAction SilentlyContinue | ForEach-Object { ($_.Line -replace '^.*\[FBM\]', '[FBM]') } | Select-Object -Last 8
    if (Test-Path "$proj\Content\Football\Web\M_FbAdd.uasset") { Write-Host "[FB] OK   materials made" }
    else { Write-Host "[FB] WARNING materials were not made - the game will show plain colours. Tell Claude." }
} else { Write-Host "[FB] OK   materials already there" }

# ---- 7. play
Write-Host "[FB] starting the game. Close the game window when you are done; the log lines print after that."
Start-Process -Wait "$ue\Engine\Binaries\Win64\UnrealEditor.exe" -ArgumentList "`"$proj\$name.uproject`" /Game/Football/Maps/FootballField -game -windowed -ResX=1600 -ResY=900 -log"
Select-String -Path "$proj\Saved\Logs\$name.log" -Pattern "\[FB\]" | Select-Object -Last 45 | ForEach-Object { ($_.Line -replace '^\[[0-9.:\-]+\]\[\s*\d+\]LogTemp: ', '') }
