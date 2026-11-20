$ErrorActionPreference = 'Stop'

# Official download inspected 2026-11-09. The vendor's stable URL is mutable,
# so an upstream replacement MUST be reviewed and its digest updated explicitly.
# The archive contains CodeSignTool 1.3.3; its --version still reports v1.3.0.
$toolUri = 'https://www.ssl.com/download/codesigntool-for-windows/'
$expectedSha256 = '317d429be3aa12a5f2c1ffdd575eab0cb0ce5e2408ab0056bcdcaab29875f73d'

if ($env:OS -ne 'Windows_NT') { throw 'Windows signing setup requires Windows.' }
$javaHome = $env:JAVA_HOME
if (-not $javaHome) { $javaHome = $env:JAVA_HOME_17_X64 }
if (-not $javaHome -or -not (Test-Path -LiteralPath (Join-Path $javaHome 'bin/java.exe') -PathType Leaf)) {
    throw 'Install Java 17 with actions/setup-java before setting up Windows signing.'
}

$temporaryBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$installDirectory = Join-Path $temporaryBase ('clawx-codesigntool-' + [guid]::NewGuid().ToString('N'))
if ($installDirectory -match "[\r\n]" -or $javaHome -match "[\r\n]") { throw 'Invalid signing tool path.' }
New-Item -ItemType Directory -Path $installDirectory | Out-Null
$archive = Join-Path $installDirectory 'codesigntool.zip'
Invoke-WebRequest -Uri $toolUri -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedSha256) {
    throw 'CodeSignTool download digest differs from the reviewed release. Refusing to install.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $installDirectory
if (-not (Test-Path -LiteralPath (Join-Path $installDirectory 'jar/code_sign_tool-1.3.3.jar') -PathType Leaf)) {
    throw 'CodeSignTool archive is missing the expected JAR.'
}
Remove-Item -LiteralPath $archive
# Use a maintained Java runtime from the runner instead of the archive's JDK.
$env:JAVA_HOME = $javaHome
$env:ES_CODE_SIGN_TOOL_PATH = $installDirectory
if ($env:GITHUB_ENV) {
    Add-Content -LiteralPath $env:GITHUB_ENV -Value "JAVA_HOME=$javaHome" -Encoding utf8
    Add-Content -LiteralPath $env:GITHUB_ENV -Value "ES_CODE_SIGN_TOOL_PATH=$installDirectory" -Encoding utf8
}
Write-Host 'Pinned CodeSignTool installed. No signing request was sent.'
