param(
  [string]$OutputPath = (Join-Path $env:TEMP ("telegram-reminders-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.tar.gz'))
)

$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$files = @(Get-ChildItem -LiteralPath $projectDirectory -File -Filter '*.js' | Select-Object -ExpandProperty Name)
$files += @('package.json', 'package-lock.json', '.env', 'data.json', 'fonts', 'deploy')
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory $file))) {
    throw "Файл для переноса не найден: $file"
  }
}
if (Test-Path -LiteralPath $OutputPath) { throw "Архив уже существует: $OutputPath" }
$stageDirectory = Join-Path $env:TEMP ("telegram-reminders-stage-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stageDirectory -ErrorAction Stop | Out-Null
try {
  foreach ($file in $files | Where-Object { $_ -ne '.env' }) {
    Copy-Item -LiteralPath (Join-Path $projectDirectory $file) -Destination (Join-Path $stageDirectory $file) -Recurse -ErrorAction Stop
  }
  $envLines = @(Get-Content -LiteralPath (Join-Path $projectDirectory '.env') | Where-Object { $_ -notmatch '^\s*(?:export\s+)?OPENAI_API_KEY\s*=' })
  [System.IO.File]::WriteAllLines((Join-Path $stageDirectory '.env'), [string[]]$envLines, [System.Text.UTF8Encoding]::new($false))
  & tar.exe -czf $OutputPath -C $stageDirectory .
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать архив переноса' }
} finally {
  $resolvedStage = [System.IO.Path]::GetFullPath($stageDirectory)
  $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  if (-not $resolvedStage.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Небезопасный путь временной папки: $resolvedStage"
  }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force -ErrorAction Stop
}
Write-Output "Архив готов: $OutputPath"
Write-Output 'В архиве есть .env с токеном Telegram, но ключ OpenAI исключён. После переноса удалите архив с компьютера и сервера.'
