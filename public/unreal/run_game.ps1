# Ultimate Football for Unreal - one command: update, build and start the game.
$ProgressPreference = 'SilentlyContinue'
$repo = "ezjgabin-spec/Football"
try { $sha = (Invoke-RestMethod -UserAgent "Mozilla/5.0" -Uri "https://api.github.com/repos/$repo/commits/main").sha } catch { $sha = "main" }
$global:FbRaw = "https://raw.githubusercontent.com/$repo/$sha/public/unreal/"
Write-Host "[FB] version $sha"
iex ((Invoke-WebRequest -UseBasicParsing -UserAgent "Mozilla/5.0" -Uri ($FbRaw + "stage.ps1")).Content)
