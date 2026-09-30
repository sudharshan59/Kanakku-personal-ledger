$ErrorActionPreference = 'Stop'

$clientId = ''
if (Test-Path '.env') {
    $envLine = Get-Content '.env' | Where-Object { $_ -match '^GOOGLE_ANDROID_CLIENT_ID=' } | Select-Object -First 1
    if ($envLine) {
        $clientId = ($envLine -replace '^GOOGLE_ANDROID_CLIENT_ID=', '').Trim().Trim('"')
    }
}
$clientId = $clientId.Trim()
if ([string]::IsNullOrWhiteSpace($clientId) -or $clientId -notmatch '^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$') {
    throw 'GOOGLE_ANDROID_CLIENT_ID is missing or invalid in .env.'
}
$configJson = @{ clientId = $clientId } | ConvertTo-Json -Compress
Set-Content '.\app\src\main\assets\config.js' "window.KANAKKU_CONFIG = $configJson;" -Encoding utf8
$authResources = "<?xml version=`"1.0`" encoding=`"utf-8`"?><resources><string name=`"google_client_id`">$clientId</string></resources>"
Set-Content '.\app\src\main\res\values\google_auth.xml' $authResources -Encoding utf8

$gradleCommand = if (Test-Path '.\gradlew.bat') {
    '.\gradlew.bat'
} elseif (Get-Command gradle -ErrorAction SilentlyContinue) {
    (Get-Command gradle).Source
} else {
    Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists" -Filter gradle.bat -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not $gradleCommand) {
    Write-Error 'Gradle was not found. Install Android Studio with the Android SDK, or install Gradle and add its bin folder to PATH.'
    exit 1
}

& $gradleCommand assembleDebug
if ($LASTEXITCODE -ne 0) {
    throw 'Android build failed.'
}

New-Item -ItemType Directory -Force -Path '.\build' | Out-Null
$apkPath = '.\app\build\outputs\apk\debug\app-debug.apk'
Copy-Item $apkPath '.\build\kanakku-debug.apk' -Force

Write-Host "APK saved to: $((Resolve-Path '.\build\kanakku-debug.apk').Path)"
