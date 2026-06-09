$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dbPath = Join-Path $root 'data\db.json'
$dbBackupPath = Join-Path $root 'data\db.backup.json'
$appTitle = 'MoonFox monitor'
$appSubtitle = 'Следит за системой, пока ты спишь.'
$appVersion = '0.6.0'

function Log($msg) {
  $ts = (Get-Date).ToString('HH:mm:ss')
  Write-Host "[$ts] $msg"
}

function Ensure-Db {
  $dataDir = Split-Path $dbPath
  if (!(Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }
  if (!(Test-Path $dbPath)) {
    $json = @'
{"settings":{"title":"MoonFox monitor","subtitle":"Следит за системой, пока ты спишь.","version":"0.6.0","language":"ru","interval":30,"timeout":10,"showMs":true,"autoOpen":true,"telegramToken":"","telegramChat":"","uiScale":0.72,"textScale":0.82,"autoRefresh":0,"port":8000,"siteWarn":1000,"siteCrit":3000,"deviceWarn":150,"deviceCrit":300},"sites":[],"routers":[],"events":[],"history":[],"graphs":[{"id":"main_graph","title":"Общий график","type":"site_response","style":"line","height":260,"note":""}]}
'@
    [IO.File]::WriteAllText($dbPath, $json, [Text.UTF8Encoding]::new($false))
  }
}

function Load-Db {
  Ensure-Db
  try {
    $txt = [IO.File]::ReadAllText($dbPath, [Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($txt)) { throw 'Database is empty' }
    $db = $txt | ConvertFrom-Json
  } catch {
    if (!(Test-Path $dbBackupPath -PathType Leaf)) { throw }
    Log 'Main database is damaged. Loading backup.'
    $txt = [IO.File]::ReadAllText($dbBackupPath, [Text.Encoding]::UTF8)
    $db = $txt | ConvertFrom-Json
    Copy-Item -LiteralPath $dbBackupPath -Destination $dbPath -Force
  }
  if ($null -eq $db.settings) { $db | Add-Member -NotePropertyName settings -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $db.sites) { $db | Add-Member -NotePropertyName sites -NotePropertyValue @() }
  if ($null -eq $db.routers) { $db | Add-Member -NotePropertyName routers -NotePropertyValue @() }
  if ($null -eq $db.events) { $db | Add-Member -NotePropertyName events -NotePropertyValue @() }
  if ($null -eq $db.history) { $db | Add-Member -NotePropertyName history -NotePropertyValue @() }
  if ($null -eq $db.graphs) { $db | Add-Member -NotePropertyName graphs -NotePropertyValue @() }
  Ensure-SettingsDefaults $db
  return $db
}

function Save-Db($db) {
  $json = $db | ConvertTo-Json -Depth 30
  $null = $json | ConvertFrom-Json
  $tempPath = $dbPath + '.tmp'
  [IO.File]::WriteAllText($tempPath, $json, [Text.UTF8Encoding]::new($false))
  try {
    if (Test-Path $dbPath -PathType Leaf) {
      [IO.File]::Replace($tempPath, $dbPath, $dbBackupPath, $true)
    } else {
      [IO.File]::Move($tempPath, $dbPath)
    }
  } catch {
    if (Test-Path $dbPath -PathType Leaf) { Copy-Item -LiteralPath $dbPath -Destination $dbBackupPath -Force }
    Move-Item -LiteralPath $tempPath -Destination $dbPath -Force
  } finally {
    if (Test-Path $tempPath -PathType Leaf) { Remove-Item -LiteralPath $tempPath -Force }
  }
}

function Send($ctx, $text, $type) {
  if ($null -eq $ctx -or $null -eq $ctx.Response) { return }
  if ([string]::IsNullOrWhiteSpace($type)) { $type = 'application/json; charset=utf-8' }
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $ctx.Response.ContentType = $type
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  } catch {
    # Response can already be closed by another branch. Do not spam CMD with disposed-response errors.
    try { $ctx.Response.Close() } catch {}
  }
}

function ReadBody($ctx) {
  $sr = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
  return $sr.ReadToEnd()
}

function NewId {
  return ([guid]::NewGuid().ToString('N').Substring(0,10))
}

function AddEvent($db, $msg, $level) {
  if ([string]::IsNullOrWhiteSpace($level)) { $level = 'ok' }
  $ev = [pscustomobject]@{ time=(Get-Date).ToString('HH:mm:ss'); date=(Get-Date).ToString('dd.MM.yyyy HH:mm:ss'); ts=(Get-Date).ToString('o'); text=$msg; level=$level }
  $arr = @($db.events)
  $arr = @($ev) + $arr | Select-Object -First 80
  $db.events = $arr
}

function SendTelegram($db, $text) {
  $token = ''
  $chat = ''
  try { $token = [string]$db.settings.telegramToken } catch {}
  try { $chat = [string]$db.settings.telegramChat } catch {}
  if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($chat)) {
    return [pscustomobject]@{ ok=$false; error='Telegram token or chat ID is empty' }
  }
  try {
    $uri = 'https://api.telegram.org/bot' + $token + '/sendMessage'
    $payload = @{ chat_id=$chat; text=$text } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 12 | Out-Null
    Log 'Telegram message sent'
    return [pscustomobject]@{ ok=$true; error='' }
  } catch {
    $err = $_.Exception.Message
    Log ('Telegram error: ' + $err)
    return [pscustomobject]@{ ok=$false; error=$err }
  }
}

function GetTelegramCommandInterval($db) {
  $value = GetSettingInt $db 'telegramCommandInterval' 5
  if ($value -lt 3) { return 3 }
  if ($value -gt 60) { return 60 }
  return $value
}

function GetTelegramUpdateOffset($db) {
  try { return [long]$db.settings.telegramUpdateOffset } catch { return [long]0 }
}

function LimitTelegramText($text) {
  $value = [string]$text
  if ($value.Length -le 3900) { return $value }
  return $value.Substring(0, 3880) + "`n..."
}

function RegisterTelegramCommands($db) {
  $token = [string]$db.settings.telegramToken
  if ([string]::IsNullOrWhiteSpace($token)) {
    return [pscustomobject]@{ ok=$false; error='Telegram token is empty' }
  }
  try {
    $commands = @(
      @{ command='status'; description='Общее состояние мониторинга' },
      @{ command='sites'; description='Список сайтов' },
      @{ command='devices'; description='Список устройств' },
      @{ command='problems'; description='Активные проблемы' },
      @{ command='check'; description='Запустить проверку' },
      @{ command='help'; description='Список команд' }
    )
    $payload = @{ commands=$commands } | ConvertTo-Json -Depth 5 -Compress
    $uri = 'https://api.telegram.org/bot' + $token + '/setMyCommands'
    Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 8 | Out-Null
    return [pscustomobject]@{ ok=$true; error='' }
  } catch {
    return [pscustomobject]@{ ok=$false; error=$_.Exception.Message }
  }
}

function GetTelegramCommandReply($db, $command) {
  $sites = @($db.sites)
  $devices = @($db.routers)
  $availableSites = @($sites | Where-Object { $_.status -eq 'OK' -or $_.status -eq 'SLOW' }).Count
  $availableDevices = @($devices | Where-Object { $_.status -eq 'OK' -or $_.status -eq 'SLOW' }).Count
  $problemSites = @($sites | Where-Object { $_.status -eq 'BAD' -or $_.status -eq 'SLOW' })
  $problemDevices = @($devices | Where-Object { $_.status -eq 'BAD' -or $_.status -eq 'SLOW' })
  switch ($command) {
    'status' {
      return ("🦊 MoonFox monitor`n`n" +
        "Сайты: $availableSites/$($sites.Count) доступны`n" +
        "Устройства: $availableDevices/$($devices.Count) доступны`n" +
        "Активных проблем: $($problemSites.Count + $problemDevices.Count)`n" +
        'Время: ' + (Get-Date).ToString('dd.MM.yyyy HH:mm:ss'))
    }
    'sites' {
      if (-not $sites.Count) { return 'Сайты не добавлены.' }
      $lines = @($sites | ForEach-Object {
        $icon = if ($_.status -eq 'OK') { '🟢' } elseif ($_.status -eq 'SLOW') { '🟡' } elseif ($_.status -eq 'BAD') { '🔴' } else { '⚪' }
        "$icon $($_.name) — $([int]$_.response) мс"
      })
      return LimitTelegramText ("🌐 Сайты`n`n" + ($lines -join "`n"))
    }
    'devices' {
      if (-not $devices.Count) { return 'Устройства не добавлены.' }
      $lines = @($devices | ForEach-Object {
        $icon = if ($_.status -eq 'OK') { '🟢' } elseif ($_.status -eq 'SLOW') { '🟡' } elseif ($_.status -eq 'BAD') { '🔴' } else { '⚪' }
        "$icon $($_.name) — $([int]$_.ping) мс"
      })
      return LimitTelegramText ("🖥 Устройства`n`n" + ($lines -join "`n"))
    }
    'problems' {
      if (-not $problemSites.Count -and -not $problemDevices.Count) { return '✅ Активных проблем нет.' }
      $lines = @()
      $lines += @($problemSites | ForEach-Object { "🌐 $($_.name): $($_.status)" })
      $lines += @($problemDevices | ForEach-Object { "🖥 $($_.name): $($_.status)" })
      return LimitTelegramText ("⚠ Активные проблемы`n`n" + ($lines -join "`n"))
    }
    'help' {
      return ("Команды MoonFox monitor:`n`n" +
        "/status — общее состояние`n" +
        "/sites — список сайтов`n" +
        "/devices — список устройств`n" +
        "/problems — активные проблемы`n" +
        "/check — запустить проверку`n" +
        "/help — список команд")
    }
    default { return '' }
  }
}

function ProcessTelegramCommands($db) {
  if ($db.settings.telegramCommandsEnabled -ne $true) { return $false }
  $token = [string]$db.settings.telegramToken
  $allowedChat = [string]$db.settings.telegramChat
  if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($allowedChat)) { return $false }
  $offset = GetTelegramUpdateOffset $db
  try {
    if ($offset -le 0) {
      $initUri = 'https://api.telegram.org/bot' + $token + '/getUpdates?offset=-1&limit=1&timeout=0'
      $initial = Invoke-RestMethod -Uri $initUri -TimeoutSec 6
      $last = @($initial.result | Select-Object -Last 1)
      if ($last.Count) { SetObjectProperty $db.settings 'telegramUpdateOffset' ([long]$last[0].update_id + 1) }
      else { SetObjectProperty $db.settings 'telegramUpdateOffset' 1 }
      return $true
    }
    $uri = 'https://api.telegram.org/bot' + $token + '/getUpdates?offset=' + $offset + '&limit=20&timeout=0'
    $response = Invoke-RestMethod -Uri $uri -TimeoutSec 6
    $changed = $false
    foreach ($update in @($response.result)) {
      $nextOffset = [long]$update.update_id + 1
      if ($nextOffset -gt (GetTelegramUpdateOffset $db)) {
        SetObjectProperty $db.settings 'telegramUpdateOffset' $nextOffset
        $changed = $true
      }
      $message = $update.message
      if ($null -eq $message -or [string]$message.chat.id -ne $allowedChat) { continue }
      $text = ([string]$message.text).Trim()
      if ($text -notmatch '^/([a-zA-Z]+)(?:@[a-zA-Z0-9_]+)?(?:\s|$)') { continue }
      $command = $Matches[1].ToLowerInvariant()
      if ($command -eq 'check') {
        [void](SendTelegram $db '⏳ Проверка сайтов и устройств запущена.')
        CheckAll $db
        $changed = $true
        [void](SendTelegram $db ((GetTelegramCommandReply $db 'status') + "`n`n✅ Проверка завершена."))
      } elseif ($command -in @('status','sites','devices','problems','help','start')) {
        if ($command -eq 'start') { $command = 'help' }
        [void](SendTelegram $db (GetTelegramCommandReply $db $command))
      } else {
        [void](SendTelegram $db 'Неизвестная команда. Используйте /help.')
      }
    }
    return $changed
  } catch {
    Log ('Telegram commands error: ' + $_.Exception.Message)
    return $false
  }
}


function Fix-ImportedDb($imported, $currentSettings) {
  if ($null -eq $imported.settings) { $imported | Add-Member -NotePropertyName settings -NotePropertyValue ([pscustomobject]@{}) -Force }
  if ($null -eq $imported.sites) { $imported | Add-Member -NotePropertyName sites -NotePropertyValue @() -Force }
  if ($null -eq $imported.routers) { $imported | Add-Member -NotePropertyName routers -NotePropertyValue @() -Force }
  if ($null -eq $imported.events) { $imported | Add-Member -NotePropertyName events -NotePropertyValue @() -Force }
  if ($null -eq $imported.history) { $imported | Add-Member -NotePropertyName history -NotePropertyValue @() -Force }
  if ($null -eq $imported.graphs -or @($imported.graphs).Count -eq 0) {
    $imported | Add-Member -NotePropertyName graphs -NotePropertyValue @([pscustomobject]@{ id='main_graph'; title='Общий график'; type='site_response'; style='line'; height=260; note='' }) -Force
  }

  # Keep program port and browser-open setting from current database if imported config does not have them.
  if ($null -ne $currentSettings) {
    if ($null -eq $imported.settings.port -and $null -ne $currentSettings.port) { $imported.settings | Add-Member -NotePropertyName port -NotePropertyValue $currentSettings.port -Force }
    if ($null -eq $imported.settings.autoOpen -and $null -ne $currentSettings.autoOpen) { $imported.settings | Add-Member -NotePropertyName autoOpen -NotePropertyValue $currentSettings.autoOpen -Force }
  }

  foreach ($s in @($imported.sites)) {
    if ($null -eq $s.id -or [string]::IsNullOrWhiteSpace([string]$s.id)) { $s | Add-Member -NotePropertyName id -NotePropertyValue (NewId) -Force }
    if ($null -eq $s.color -or [string]::IsNullOrWhiteSpace([string]$s.color)) { $s | Add-Member -NotePropertyName color -NotePropertyValue '#35f0ff' -Force }
    if ($null -eq $s.status) { $s | Add-Member -NotePropertyName status -NotePropertyValue 'WAIT' -Force }
    if ($null -eq $s.code) { $s | Add-Member -NotePropertyName code -NotePropertyValue 0 -Force }
    if ($null -eq $s.response) { $s | Add-Member -NotePropertyName response -NotePropertyValue 0 -Force }
    if ($null -eq $s.checked) { $s | Add-Member -NotePropertyName checked -NotePropertyValue '-' -Force }
    if ($null -eq $s.lastFailure) { $s | Add-Member -NotePropertyName lastFailure -NotePropertyValue 'Никогда' -Force }
    if ($null -eq $s.ping) { $s | Add-Member -NotePropertyName ping -NotePropertyValue 0 -Force }
    if ($null -eq $s.pingSynthetic) { $s | Add-Member -NotePropertyName pingSynthetic -NotePropertyValue $false -Force }
    if ($null -eq $s.dns) { $s | Add-Member -NotePropertyName dns -NotePropertyValue @() -Force }
    if ($null -eq $s.ssl) { $s | Add-Member -NotePropertyName ssl -NotePropertyValue $null -Force }
  }

  foreach ($r in @($imported.routers)) {
    if ($null -eq $r.id -or [string]::IsNullOrWhiteSpace([string]$r.id)) { $r | Add-Member -NotePropertyName id -NotePropertyValue (NewId) -Force }
    if ($null -eq $r.color -or [string]::IsNullOrWhiteSpace([string]$r.color)) { $r | Add-Member -NotePropertyName color -NotePropertyValue '#7c5cff' -Force }
    if ($null -eq $r.status) { $r | Add-Member -NotePropertyName status -NotePropertyValue 'WAIT' -Force }
    if ($null -eq $r.ping) { $r | Add-Member -NotePropertyName ping -NotePropertyValue 0 -Force }
    if ($null -eq $r.port) { $r | Add-Member -NotePropertyName port -NotePropertyValue 0 -Force }
    if ($null -eq $r.portOk) { $r | Add-Member -NotePropertyName portOk -NotePropertyValue $true -Force }
    if ($null -eq $r.checkType -or [string]::IsNullOrWhiteSpace([string]$r.checkType)) { $r | Add-Member -NotePropertyName checkType -NotePropertyValue 'ping' -Force }
    if ($null -eq $r.checked) { $r | Add-Member -NotePropertyName checked -NotePropertyValue '-' -Force }
    if ($null -eq $r.lastFailure) { $r | Add-Member -NotePropertyName lastFailure -NotePropertyValue 'Никогда' -Force }
    if ($null -eq $r.ports) {
      $legacyPorts = @()
      if ([int]$r.port -gt 0) { $legacyPorts = @([int]$r.port) }
      $r | Add-Member -NotePropertyName ports -NotePropertyValue $legacyPorts -Force
    }
    if ($null -eq $r.portResults) { $r | Add-Member -NotePropertyName portResults -NotePropertyValue @() -Force }
  }

  Ensure-SettingsDefaults $imported
  return $imported
}

function GetSettingInt($db, $name, $def) {
  try {
    $v = $db.settings.$name
    if ($null -ne $v -and [int]$v -gt 0) { return [int]$v }
  } catch {}
  return [int]$def
}

function GetCheckInterval($db) {
  return GetSettingInt $db 'interval' 30
}

function GetSiteCheckInterval($db) {
  return GetSettingInt $db 'siteInterval' (GetCheckInterval $db)
}

function GetDeviceCheckInterval($db) {
  return GetSettingInt $db 'deviceInterval' (GetCheckInterval $db)
}

function EnsureSetting($db, $name, $value) {
  try {
    if ($null -eq $db.settings.$name) {
      $db.settings | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
    }
  } catch {
    $db.settings | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
  }
}

function Ensure-SettingsDefaults($db) {
  SetObjectProperty $db.settings 'title' $appTitle
  SetObjectProperty $db.settings 'subtitle' $appSubtitle
  SetObjectProperty $db.settings 'version' $appVersion
  EnsureSetting $db 'language' 'ru'
  EnsureSetting $db 'notifyDown' $true
  EnsureSetting $db 'notifySlow' $true
  EnsureSetting $db 'notifyRecovered' $true
  EnsureSetting $db 'tgSiteDown' 'Сайт недоступен'
  EnsureSetting $db 'tgSiteSlow' 'Сайт отвечает медленно'
  EnsureSetting $db 'tgSiteRecovered' 'Сайт снова доступен'
  EnsureSetting $db 'tgDeviceDown' 'Устройство недоступно'
  EnsureSetting $db 'tgDeviceSlow' 'Высокий ping'
  EnsureSetting $db 'tgDeviceRecovered' 'Устройство снова доступно'
  EnsureSetting $db 'siteRepeatMinutes' 10
  EnsureSetting $db 'deviceRepeatMinutes' 10
  EnsureSetting $db 'failureConfirmChecks' 2
  EnsureSetting $db 'siteInterval' (GetCheckInterval $db)
  EnsureSetting $db 'deviceInterval' (GetCheckInterval $db)
  EnsureSetting $db 'siteOverviewStyle' 'line'
  EnsureSetting $db 'deviceOverviewStyle' 'line'
  EnsureSetting $db 'telegramCommandsEnabled' $false
  EnsureSetting $db 'telegramCommandInterval' 5
  EnsureSetting $db 'telegramUpdateOffset' 0
  EnsureSetting $db 'themePreset' 'dark'
  EnsureSetting $db 'themeAccent' '#7c5cff'
  EnsureSetting $db 'themeButton' '#24457f'
  EnsureSetting $db 'themeOk' '#20e68a'
  EnsureSetting $db 'themeBad' '#ff4d6d'
  EnsureSetting $db 'themeBg' '#080d1b'
  EnsureSetting $db 'themePanel' '#101a36'
}

function SetObjectProperty($obj, $name, $value) {
  try { $obj.$name = $value } catch { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }
}

function ConfirmObservedStatus($obj, $observedStatus, $threshold) {
  if ($threshold -lt 1) { $threshold = 1 }
  $previous = [string]$obj.status
  if ($observedStatus -eq 'OK') {
    SetObjectProperty $obj 'failureCount' 0
    SetObjectProperty $obj 'pendingStatus' ''
    return 'OK'
  }
  if ($previous -eq $observedStatus) {
    SetObjectProperty $obj 'failureCount' $threshold
    SetObjectProperty $obj 'pendingStatus' $observedStatus
    return $observedStatus
  }
  $pending = ''
  $count = 0
  try { $pending = [string]$obj.pendingStatus } catch {}
  try { $count = [int]$obj.failureCount } catch {}
  if ($pending -eq $observedStatus) { $count++ } else { $pending = $observedStatus; $count = 1 }
  SetObjectProperty $obj 'pendingStatus' $pending
  SetObjectProperty $obj 'failureCount' $count
  if ($count -ge $threshold) { return $observedStatus }
  if ($previous -eq 'BAD' -or $previous -eq 'SLOW') { return $previous }
  return $(if ($previous) { $previous } else { 'WAIT' })
}

function NormalizeTelegramTitle($value, $fallback) {
  $v = [string]$value
  if ([string]::IsNullOrWhiteSpace($v)) { return $fallback }
  if ($v.Contains('{')) { return $fallback }
  if ($v.Contains("`n")) { $v = $v.Split("`n")[0] }
  $v = $v.Trim()
  if ([string]::IsNullOrWhiteSpace($v)) { return $fallback }
  return $v
}

function BuildSiteTelegram($db, $key, $fallback, $icon, $site, $response, $warning, $critical, $timeNow) {
  $title = NormalizeTelegramTitle $db.settings.$key $fallback
  return ($icon + ' ' + $title + "`n`n" +
    'Сайт: ' + [string]$site.name + "`n" +
    'Адрес: ' + [string]$site.url + "`n" +
    'Ответ: ' + [string]$response + ' мс' + "`n" +
    'Порог предупреждения: ' + [string]$warning + ' мс' + "`n" +
    'Критичный порог: ' + [string]$critical + ' мс' + "`n" +
    'Время: ' + [string]$timeNow)
}

function BuildDeviceTelegram($db, $key, $fallback, $icon, $device, $ping, $warning, $critical, $timeNow) {
  $title = NormalizeTelegramTitle $db.settings.$key $fallback
  return ($icon + ' ' + $title + "`n`n" +
    'Устройство: ' + [string]$device.name + "`n" +
    'Адрес: ' + [string]$device.address + "`n" +
    'Ping: ' + [string]$ping + ' мс' + "`n" +
    'Порог предупреждения: ' + [string]$warning + ' мс' + "`n" +
    'Критичный порог: ' + [string]$critical + ' мс' + "`n" +
    'Время: ' + [string]$timeNow)
}


function GetRepeatMinutes($db, $name, $def) {
  try {
    $v = [int]$db.settings.$name
    if ($v -ge 0) { return $v }
  } catch {}
  return $def
}

function GetLastNotifyAt($obj) {
  try {
    if ($null -ne $obj.lastNotifyAt -and -not [string]::IsNullOrWhiteSpace([string]$obj.lastNotifyAt)) {
      return [datetime]::Parse([string]$obj.lastNotifyAt)
    }
  } catch {}
  return $null
}

function ShouldSendProblemNotify($obj, $prevStatus, $newStatus, $repeatMinutes) {
  if ($prevStatus -ne $newStatus) { return $true }
  if ($repeatMinutes -le 0) { return $false }
  $last = GetLastNotifyAt $obj
  if ($null -eq $last) { return $true }
  $mins = ((Get-Date) - $last).TotalMinutes
  return ($mins -ge $repeatMinutes)
}

function MarkNotifySent($obj, $status) {
  try { $obj.lastNotifyAt = (Get-Date).ToString('o') } catch { $obj | Add-Member -NotePropertyName lastNotifyAt -NotePropertyValue ((Get-Date).ToString('o')) -Force }
  try { $obj.lastNotifyStatus = $status } catch { $obj | Add-Member -NotePropertyName lastNotifyStatus -NotePropertyValue $status -Force }
}

function SetLastFailure($obj) {
  try { $obj.lastFailure = (Get-Date).ToString('dd.MM.yyyy HH:mm') } catch {
    $obj | Add-Member -NotePropertyName lastFailure -NotePropertyValue ((Get-Date).ToString('dd.MM.yyyy HH:mm')) -Force
  }
}


function TestTcpPort($address, $port, $timeoutMs) {
  if ($null -eq $port -or [int]$port -le 0) { return $true }
  try {
    $client = New-Object Net.Sockets.TcpClient
    $iar = $client.BeginConnect($address, [int]$port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne([int]$timeoutMs, $false)
    if ($ok) { $client.EndConnect($iar) }
    $client.Close()
    return [bool]$ok
  } catch {
    return $false
  }
}

function GetHostFromTarget($target) {
  $value = [string]$target
  try {
    if ($value -match '^https?://') { return ([Uri]$value).DnsSafeHost }
  } catch {}
  $value = $value.Trim()
  if ($value -match '^[a-zA-Z0-9.-]+$') { return $value }
  throw 'Invalid host'
}

function ParsePorts($value) {
  $ports = @()
  foreach ($part in @($value) -join ',' -split '[,;\s]+') {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    $p = 0
    if ([int]::TryParse($part, [ref]$p) -and $p -ge 1 -and $p -le 65535) { $ports += $p }
  }
  return @($ports | Sort-Object -Unique)
}

function GetDnsInfo($hostName) {
  try {
    return @([Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.IPAddressToString } | Sort-Object -Unique)
  } catch { return @() }
}

function TestSyntheticIp($address) {
  $ip = $null
  if (-not [Net.IPAddress]::TryParse([string]$address, [ref]$ip)) { return $false }
  $bytes = $ip.GetAddressBytes()
  return ($bytes.Length -eq 4 -and $bytes[0] -eq 198 -and ($bytes[1] -eq 18 -or $bytes[1] -eq 19))
}

function TestPrivateIPv4($address) {
  $ip = $null
  if (-not [Net.IPAddress]::TryParse([string]$address, [ref]$ip)) { return $false }
  $bytes = $ip.GetAddressBytes()
  if ($bytes.Length -ne 4) { return $false }
  return (
    $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
  )
}

function GetLocalNetworkInfo {
  $addresses = @()
  try {
    foreach ($config in @(Get-NetIPConfiguration -ErrorAction Stop)) {
      foreach ($entry in @($config.IPv4Address)) {
        $address = [string]$entry.IPAddress
        if (TestPrivateIPv4 $address) {
          $parts = $address.Split('.')
          $addresses += [pscustomobject]@{
            address = $address
            subnet = ($parts[0..2] -join '.') + '.0/24'
            interface = [string]$config.InterfaceAlias
            preferred = ($null -ne $config.IPv4DefaultGateway)
          }
        }
      }
    }
  } catch {}
  if ($addresses.Count -eq 0) {
    try {
      foreach ($adapter in @([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces())) {
        if ($adapter.OperationalStatus -ne [Net.NetworkInformation.OperationalStatus]::Up) { continue }
        foreach ($entry in @($adapter.GetIPProperties().UnicastAddresses)) {
          if ($entry.Address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { continue }
          $address = [string]$entry.Address.IPAddressToString
          if (TestPrivateIPv4 $address) {
            $parts = $address.Split('.')
            $addresses += [pscustomobject]@{
              address = $address
              subnet = ($parts[0..2] -join '.') + '.0/24'
              interface = [string]$adapter.Name
              preferred = ($adapter.NetworkInterfaceType -ne [Net.NetworkInformation.NetworkInterfaceType]::Tunnel)
            }
          }
        }
      }
    } catch {}
  }
  $addresses = @($addresses | Sort-Object @{Expression='preferred';Descending=$true},interface,address -Unique)
  return [pscustomobject]@{
    suggested = if ($addresses.Count) { [string]$addresses[0].subnet } else { '' }
    interfaces = $addresses
  }
}

function InvokeLocalNetworkScan($cidr) {
  $networkInfo = GetLocalNetworkInfo
  if ([string]::IsNullOrWhiteSpace([string]$cidr)) { $cidr = $networkInfo.suggested }
  $cidr = ([string]$cidr).Trim()
  if ($cidr -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/24$') {
    throw 'Укажите частную IPv4-подсеть в формате 192.168.1.0/24'
  }
  $octets = @(1..4 | ForEach-Object { [int]$Matches[$_] })
  if (@($octets | Where-Object { $_ -lt 0 -or $_ -gt 255 }).Count -gt 0) { throw 'Некорректный IPv4-адрес' }
  $baseAddress = ($octets[0..2] -join '.') + '.0'
  if (-not (TestPrivateIPv4 $baseAddress)) { throw 'Разрешено сканирование только частных локальных IPv4-подсетей' }
  $subnet = $baseAddress + '/24'
  $prefix = $octets[0..2] -join '.'

  $jobs = @()
  foreach ($hostNumber in 1..254) {
    $address = $prefix + '.' + $hostNumber
    $ping = New-Object Net.NetworkInformation.Ping
    try {
      $jobs += [pscustomobject]@{ address=$address; ping=$ping; task=$ping.SendPingAsync($address, 650) }
    } catch {
      $ping.Dispose()
    }
  }

  $alive = @()
  foreach ($job in $jobs) {
    try {
      $reply = $job.task.GetAwaiter().GetResult()
      if ($reply.Status -eq [Net.NetworkInformation.IPStatus]::Success) {
        $alive += [pscustomobject]@{ address=$job.address; ping=[int]$reply.RoundtripTime }
      }
    } catch {
    } finally {
      try { $job.ping.Dispose() } catch {}
    }
  }

  $macByAddress = @{}
  try {
    foreach ($line in @(& arp.exe -a 2>$null)) {
      if ($line -match '^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{17})\s+') {
        $macByAddress[$Matches[1]] = $Matches[2].ToUpperInvariant()
      }
    }
  } catch {}

  $devices = @()
  foreach ($item in $alive) {
    $hostName = ''
    try {
      $dnsTask = [Net.Dns]::GetHostEntryAsync($item.address)
      if ($dnsTask.Wait(350)) { $hostName = [string]$dnsTask.Result.HostName }
    } catch {}
    $devices += [pscustomobject]@{
      address = $item.address
      name = $hostName
      mac = if ($macByAddress.ContainsKey($item.address)) { [string]$macByAddress[$item.address] } else { '' }
      ping = [int]$item.ping
    }
  }
  return [pscustomobject]@{
    subnet = $subnet
    scanned = 254
    devices = @($devices | Sort-Object { [version]$_.address })
  }
}

function GetDnsRecords($hostName) {
  $records = @()
  if (-not (Get-Command Resolve-DnsName -ErrorAction SilentlyContinue)) { return $records }
  foreach ($type in @('A','AAAA','CNAME','MX','NS')) {
    try {
      foreach ($item in @(Resolve-DnsName -Name $hostName -Type $type -DnsOnly -ErrorAction Stop)) {
        $value = ''
        if ($item.IPAddress) { $value = [string]$item.IPAddress }
        elseif ($item.NameHost) { $value = [string]$item.NameHost }
        elseif ($item.NameExchange) { $value = ([string]$item.Preference + ' ' + [string]$item.NameExchange).Trim() }
        if (-not [string]::IsNullOrWhiteSpace($value)) {
          $records += [pscustomobject]@{ type=$type; name=[string]$item.Name; value=$value; ttl=[int]$item.TTL }
        }
      }
    } catch {}
  }
  return @($records | Sort-Object type,value -Unique)
}

function GetSslInfo($hostName, $port=443, $timeoutMs=5000) {
  $client = $null
  $ssl = $null
  try {
    $client = New-Object Net.Sockets.TcpClient
    $iar = $client.BeginConnect($hostName, [int]$port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs, $false)) { throw 'Connection timeout' }
    $client.EndConnect($iar)
    $ssl = [Net.Security.SslStream]::new($client.GetStream(), $false)
    $ssl.AuthenticateAsClient($hostName)
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
    $days = [int][Math]::Floor(($cert.NotAfter.ToUniversalTime() - (Get-Date).ToUniversalTime()).TotalDays)
    return [pscustomobject]@{ ok=($days -ge 0); validFrom=$cert.NotBefore.ToString('dd.MM.yyyy'); validTo=$cert.NotAfter.ToString('dd.MM.yyyy'); daysLeft=$days; issuer=$cert.Issuer; subject=$cert.Subject; policyErrors='None'; error='' }
  } catch {
    return [pscustomobject]@{ ok=$false; validFrom=''; validTo=''; daysLeft=-1; issuer=''; subject=''; policyErrors='ValidationFailed'; error=$_.Exception.Message }
  } finally {
    if ($ssl) { try { $ssl.Dispose() } catch {} }
    if ($client) { try { $client.Close() } catch {} }
  }
}

function InvokeDiagnostic($target, $type, $portsValue) {
  $hostName = GetHostFromTarget $target
  switch ($type) {
    'ping' {
      $items = @()
      $addresses = @(GetDnsInfo $hostName)
      $synthetic = @($addresses | Where-Object { TestSyntheticIp $_ }).Count -gt 0
      try {
        $ping = New-Object Net.NetworkInformation.Ping
        1..4 | ForEach-Object {
          try {
            $reply = $ping.Send($hostName, 3000)
            $items += [pscustomobject]@{ ok=($reply.Status -eq 'Success'); ms=if($reply.Status -eq 'Success'){[int]$reply.RoundtripTime}else{0}; status=[string]$reply.Status }
          } catch { $items += [pscustomobject]@{ ok=$false; ms=0; status=$_.Exception.Message } }
        }
      } finally { if ($ping) { $ping.Dispose() } }
      return [pscustomobject]@{ type='ping'; host=$hostName; addresses=$addresses; syntheticProxy=$synthetic; results=$items }
    }
    'dns' {
      return [pscustomobject]@{ type='dns'; host=$hostName; addresses=@(GetDnsInfo $hostName); records=@(GetDnsRecords $hostName) }
    }
    'ssl' {
      return [pscustomobject]@{ type='ssl'; host=$hostName; certificate=(GetSslInfo $hostName) }
    }
    'ports' {
      $results = @()
      foreach ($p in @(ParsePorts $portsValue)) { $results += [pscustomobject]@{ port=$p; open=[bool](TestTcpPort $hostName $p 2500) } }
      return [pscustomobject]@{ type='ports'; host=$hostName; results=$results }
    }
    'trace' {
      $output = & tracert.exe -d -h 15 -w 1000 $hostName 2>&1 | Out-String
      return [pscustomobject]@{ type='trace'; host=$hostName; output=$output.Trim() }
    }
    'whois' {
      $parsedIp = $null
      $isIp = [Net.IPAddress]::TryParse($hostName, [ref]$parsedIp)
      $candidates = if ($isIp) { @($hostName) } else {
        $normalized = $hostName.Trim('.').ToLowerInvariant()
        $list = @($normalized)
        if ($normalized.StartsWith('www.')) { $list += $normalized.Substring(4) }
        @($list | Select-Object -Unique)
      }
      $lastError = ''
      foreach ($candidate in $candidates) {
        try {
          $rdapKind = if ($isIp) { 'ip' } else { 'domain' }
          $result = Invoke-RestMethod -Uri ('https://rdap.org/' + $rdapKind + '/' + [Uri]::EscapeDataString($candidate)) -TimeoutSec 12
          $events = @($result.events | ForEach-Object { [pscustomobject]@{ action=$_.eventAction; date=$_.eventDate } })
          return [pscustomobject]@{ type='whois'; host=$hostName; query=$candidate; handle=$result.handle; name=$result.ldhName; status=@($result.status); nameservers=@($result.nameservers | ForEach-Object { $_.ldhName }); events=$events }
        } catch {
          $lastError = $_.Exception.Message
        }
      }
      return [pscustomobject]@{ type='whois'; host=$hostName; query=$candidates[-1]; notFound=$true; error='RDAP data was not found for this domain or IP address'; details=$lastError }
    }
    default { throw 'Unknown diagnostic type' }
  }
}

function CheckAll($db, $checkSites=$true, $checkDevices=$true) {
  Log 'Check started'
  $timeout = GetSettingInt $db 'timeout' 10
  $siteWarn = GetSettingInt $db 'siteWarn' 1000
  $siteCrit = GetSettingInt $db 'siteCrit' 3000
  $deviceWarn = GetSettingInt $db 'deviceWarn' 150
  $deviceCrit = GetSettingInt $db 'deviceCrit' 300
  $siteRepeatMinutes = GetRepeatMinutes $db 'siteRepeatMinutes' 10
  $deviceRepeatMinutes = GetRepeatMinutes $db 'deviceRepeatMinutes' 10
  $failureConfirmChecks = GetSettingInt $db 'failureConfirmChecks' 2

  if ($checkSites) {
  foreach ($s in @($db.sites)) {
    $prevStatus = [string]$s.status
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $ok = $false
    $code = 0
    try {
      $resp = Invoke-WebRequest -Uri $s.url -UseBasicParsing -TimeoutSec $timeout
      $code = [int]$resp.StatusCode
      if ($code -ge 200 -and $code -lt 400) { $ok = $true }
    } catch {
      $code = 0
      $ok = $false
    }
    $sw.Stop()
    $ms = [int]$sw.ElapsedMilliseconds
    try {
      $siteHost = GetHostFromTarget $s.url
      $siteDns = @(GetDnsInfo $siteHost)
      SetObjectProperty $s 'dns' $siteDns
      SetObjectProperty $s 'pingSynthetic' (@($siteDns | Where-Object { TestSyntheticIp $_ }).Count -gt 0)
      $sitePing = 0
      $sitePingClient = $null
      try {
        $sitePingClient = New-Object Net.NetworkInformation.Ping
        $pingReply = $sitePingClient.Send($siteHost, 2500)
        if ($pingReply.Status -eq 'Success') { $sitePing = [int]$pingReply.RoundtripTime }
      } catch {} finally { if ($sitePingClient) { $sitePingClient.Dispose() } }
      SetObjectProperty $s 'ping' $sitePing
      if ([string]$s.url -match '^https://') { SetObjectProperty $s 'ssl' (GetSslInfo $siteHost) }
      else { SetObjectProperty $s 'ssl' $null }
    } catch {
      SetObjectProperty $s 'dns' @()
      SetObjectProperty $s 'ping' 0
      SetObjectProperty $s 'pingSynthetic' $false
      SetObjectProperty $s 'ssl' $null
    }
    $timeNow = (Get-Date).ToString('dd.MM.yyyy HH:mm:ss')
    $telegramText = ''
    if ($ok -and $ms -ge $siteCrit) {
      $observedStatus = 'BAD'; $statusLevel = 'bad'; $msg = 'Сайт "' + $s.name + '" критично медленный'
      $s.status = ConfirmObservedStatus $s $observedStatus $failureConfirmChecks
      if ($s.status -ne $observedStatus) { $statusLevel = 'ok' }
      if ($s.status -eq $observedStatus -and $prevStatus -ne $observedStatus) { SetLastFailure $s }
      if (($s.status -eq $observedStatus) -and ($db.settings.notifySlow -ne $false) -and (ShouldSendProblemNotify $s $prevStatus $s.status $siteRepeatMinutes)) { $telegramText = BuildSiteTelegram $db 'tgSiteSlow' 'Сайт отвечает медленно' '🟡' $s $ms $siteWarn $siteCrit $timeNow }
    } elseif ($ok -and $ms -ge $siteWarn) {
      $observedStatus = 'SLOW'; $statusLevel = 'warn'; $msg = 'Сайт "' + $s.name + '" отвечает медленно'
      $s.status = ConfirmObservedStatus $s $observedStatus $failureConfirmChecks
      if ($s.status -ne $observedStatus) { $statusLevel = 'ok' }
      if (($s.status -eq $observedStatus) -and ($db.settings.notifySlow -ne $false) -and (ShouldSendProblemNotify $s $prevStatus $s.status $siteRepeatMinutes)) { $telegramText = BuildSiteTelegram $db 'tgSiteSlow' 'Сайт отвечает медленно' '🟡' $s $ms $siteWarn $siteCrit $timeNow }
    } elseif ($ok) {
      $observedStatus = 'OK'; $s.status = ConfirmObservedStatus $s $observedStatus $failureConfirmChecks; $statusLevel = 'ok'; $msg = 'Сайт "' + $s.name + '" доступен'
      if (($prevStatus -eq 'BAD' -or $prevStatus -eq 'SLOW') -and $db.settings.notifyRecovered -ne $false) {
        $telegramText = BuildSiteTelegram $db 'tgSiteRecovered' 'Сайт снова доступен' '🟢' $s $ms $siteWarn $siteCrit $timeNow; $statusLevel = 'recovered'; $msg = 'Сайт "' + $s.name + '" снова доступен'
      }
    } else {
      $observedStatus = 'BAD'; $statusLevel = 'bad'; $msg = 'Сайт "' + $s.name + '" недоступен'
      $s.status = ConfirmObservedStatus $s $observedStatus $failureConfirmChecks
      if ($s.status -ne $observedStatus) { $statusLevel = 'ok' }
      if ($s.status -eq $observedStatus -and $prevStatus -ne $observedStatus) { SetLastFailure $s }
      if (($s.status -eq $observedStatus) -and ($db.settings.notifyDown -ne $false) -and (ShouldSendProblemNotify $s $prevStatus $s.status $siteRepeatMinutes)) { $telegramText = BuildSiteTelegram $db 'tgSiteDown' 'Сайт недоступен' '🔴' $s $ms $siteWarn $siteCrit $timeNow }
    }
    $s.code = $code
    $s.response = $ms
    $s.checked = (Get-Date).ToString('HH:mm:ss')
    $db.history += [pscustomobject]@{ ts=(Get-Date).ToString('o'); time=(Get-Date).ToString('HH:mm:ss'); kind='site'; objectId=$s.id; name=$s.name; value=$ms; ok=$ok; code=$code; status=$s.status; observedStatus=$observedStatus }
    if ($statusLevel -eq 'recovered' -or (($statusLevel -eq 'bad' -or $statusLevel -eq 'warn') -and $prevStatus -ne $s.status)) { AddEvent $db $msg $statusLevel }
    if (![string]::IsNullOrWhiteSpace($telegramText)) { [void](SendTelegram $db $telegramText); MarkNotifySent $s $s.status }
  }
  }

  if ($checkDevices) {
  foreach ($r in @($db.routers)) {
    $prevStatus = [string]$r.status
    $checkType = 'ping'
    try { if ($r.checkType) { $checkType = [string]$r.checkType } } catch {}
    $port = 0
    try { if ($r.port) { $port = [int]$r.port } } catch { $port = 0 }
    $ports = @()
    try { $ports = @(ParsePorts $r.ports) } catch {}
    if ($ports.Count -eq 0 -and $port -gt 0) { $ports = @($port) }
    if ($ports.Count -gt 0) { $port = [int]$ports[0] }

    $sw = [Diagnostics.Stopwatch]::StartNew()
    $pingOk = $true
    if ($checkType -eq 'ping' -or $checkType -eq 'both') {
      $pingOk = Test-Connection -ComputerName $r.address -Count 1 -Quiet -ErrorAction SilentlyContinue
    }
    $sw.Stop()
    if ($pingOk) { $ping = [int]$sw.ElapsedMilliseconds } else { $ping = 0 }

    $portOk = $true
    $portResults = @()
    if (($checkType -eq 'tcp' -or $checkType -eq 'both') -and $ports.Count -gt 0) {
      foreach ($p in $ports) {
        $isOpen = [bool](TestTcpPort $r.address $p 3000)
        $portResults += [pscustomobject]@{ port=[int]$p; open=$isOpen }
        if (-not $isOpen) { $portOk = $false }
      }
    }

    $ok = $false
    if ($checkType -eq 'ping') { $ok = $pingOk }
    elseif ($checkType -eq 'tcp') { $ok = $portOk }
    else { $ok = ($pingOk -and $portOk) }

    try { $r.portOk = [bool]$portOk } catch { $r | Add-Member -NotePropertyName portOk -NotePropertyValue ([bool]$portOk) -Force }
    SetObjectProperty $r 'ports' $ports
    SetObjectProperty $r 'portResults' $portResults
    try { $r.checkType = $checkType } catch { $r | Add-Member -NotePropertyName checkType -NotePropertyValue $checkType -Force }

    $timeNow = (Get-Date).ToString('dd.MM.yyyy HH:mm:ss')
    $telegramText = ''
    if (-not $ok) {
      $observedStatus = 'BAD'; $statusLevel = 'bad'
      if (($checkType -eq 'tcp' -or $checkType -eq 'both') -and $ports.Count -gt 0 -and -not $portOk) {
        $closedPorts = @($portResults | Where-Object { -not $_.open } | ForEach-Object { $_.port }) -join ', '
        $msg = 'Устройство "' + $r.name + '" закрытые порты: ' + $closedPorts
      } else {
        $msg = 'Устройство "' + $r.name + '" недоступно'
      }
      $r.status = ConfirmObservedStatus $r $observedStatus $failureConfirmChecks
      if ($r.status -ne $observedStatus) { $statusLevel = 'ok' }
      if ($r.status -eq $observedStatus -and $prevStatus -ne $observedStatus) { SetLastFailure $r }
      if (($r.status -eq $observedStatus) -and ($db.settings.notifyDown -ne $false) -and (ShouldSendProblemNotify $r $prevStatus $r.status $deviceRepeatMinutes)) { $telegramText = BuildDeviceTelegram $db 'tgDeviceDown' 'Устройство недоступно' '🔴' $r $ping $deviceWarn $deviceCrit $timeNow }
    } elseif (($checkType -eq 'ping' -or $checkType -eq 'both') -and $ping -ge $deviceCrit) {
      $observedStatus = 'BAD'; $statusLevel = 'bad'; $msg = 'Устройство "' + $r.name + '" критично медленное'
      $r.status = ConfirmObservedStatus $r $observedStatus $failureConfirmChecks
      if ($r.status -ne $observedStatus) { $statusLevel = 'ok' }
      if ($r.status -eq $observedStatus -and $prevStatus -ne $observedStatus) { SetLastFailure $r }
      if (($r.status -eq $observedStatus) -and ($db.settings.notifySlow -ne $false) -and (ShouldSendProblemNotify $r $prevStatus $r.status $deviceRepeatMinutes)) { $telegramText = BuildDeviceTelegram $db 'tgDeviceSlow' 'Высокий ping' '🟡' $r $ping $deviceWarn $deviceCrit $timeNow }
    } elseif (($checkType -eq 'ping' -or $checkType -eq 'both') -and $ping -ge $deviceWarn) {
      $observedStatus = 'SLOW'; $statusLevel = 'warn'; $msg = 'Устройство "' + $r.name + '" высокий ping'
      $r.status = ConfirmObservedStatus $r $observedStatus $failureConfirmChecks
      if ($r.status -ne $observedStatus) { $statusLevel = 'ok' }
      if (($r.status -eq $observedStatus) -and ($db.settings.notifySlow -ne $false) -and (ShouldSendProblemNotify $r $prevStatus $r.status $deviceRepeatMinutes)) { $telegramText = BuildDeviceTelegram $db 'tgDeviceSlow' 'Высокий ping' '🟡' $r $ping $deviceWarn $deviceCrit $timeNow }
    } else {
      $observedStatus = 'OK'; $r.status = ConfirmObservedStatus $r $observedStatus $failureConfirmChecks; $statusLevel = 'ok'
      if (($checkType -eq 'tcp' -or $checkType -eq 'both') -and $ports.Count -gt 0) {
        $msg = 'Устройство "' + $r.name + '" доступно, порты открыты'
      } else {
        $msg = 'Устройство "' + $r.name + '" доступно'
      }
      if (($prevStatus -eq 'BAD' -or $prevStatus -eq 'SLOW') -and $db.settings.notifyRecovered -ne $false) {
        $telegramText = BuildDeviceTelegram $db 'tgDeviceRecovered' 'Устройство снова доступно' '🟢' $r $ping $deviceWarn $deviceCrit $timeNow; $statusLevel = 'recovered'; $msg = 'Устройство "' + $r.name + '" снова доступно'
      }
    }
    $r.ping = $ping
    $r.checked = (Get-Date).ToString('HH:mm:ss')
    $db.history += [pscustomobject]@{ ts=(Get-Date).ToString('o'); time=(Get-Date).ToString('HH:mm:ss'); kind='router'; objectId=$r.id; name=$r.name; value=$ping; ok=$ok; code=0; status=$r.status; observedStatus=$observedStatus; port=$port; ports=$ports; portOk=$portOk }
    if ($statusLevel -eq 'recovered' -or (($statusLevel -eq 'bad' -or $statusLevel -eq 'warn') -and $prevStatus -ne $r.status)) { AddEvent $db $msg $statusLevel }
    if (![string]::IsNullOrWhiteSpace($telegramText)) { [void](SendTelegram $db $telegramText); MarkNotifySent $r $r.status }
  }
  }

  $db.history = @($db.history | Select-Object -Last 500)
  Log ('Check finished. Sites: ' + @($db.sites).Count + ', devices: ' + @($db.routers).Count)
}

$db0 = Load-Db
$port = 8000
try {
  if ($db0.settings -and $db0.settings.port) { $port = [int]$db0.settings.port }
} catch { $port = 8000 }
if ($port -lt 1024 -or $port -gt 65535) { $port = 8000 }
$url = "http://127.0.0.1:$port/"

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($url)
try {
  $listener.Start()
} catch {
  Write-Host "Port busy or access denied: $url"
  Write-Host "Change port in data\db.json or close the program using this port."
  pause
  exit
}

if ($db0.settings.autoOpen -ne $false) { Start-Process $url }
Log ("Monitoring started: $url")

$nextSiteCheckAt = (Get-Date).AddSeconds((GetSiteCheckInterval $db0))
$nextDeviceCheckAt = (Get-Date).AddSeconds((GetDeviceCheckInterval $db0))
$nextTelegramPollAt = (Get-Date).AddSeconds(2)

while ($listener.IsListening) {
  $now = Get-Date
  if ($now -ge $nextSiteCheckAt -or $now -ge $nextDeviceCheckAt) {
    try {
      $backgroundDb = Load-Db
      $runSites = $now -ge $nextSiteCheckAt
      $runDevices = $now -ge $nextDeviceCheckAt
      CheckAll $backgroundDb $runSites $runDevices
      Save-Db $backgroundDb
      if ($runSites) { $nextSiteCheckAt = (Get-Date).AddSeconds((GetSiteCheckInterval $backgroundDb)) }
      if ($runDevices) { $nextDeviceCheckAt = (Get-Date).AddSeconds((GetDeviceCheckInterval $backgroundDb)) }
    } catch {
      Log ('Background check error: ' + $_.Exception.Message)
      $nextSiteCheckAt = (Get-Date).AddSeconds(30)
      $nextDeviceCheckAt = (Get-Date).AddSeconds(30)
    }
  }
  if ($now -ge $nextTelegramPollAt) {
    try {
      $telegramDb = Load-Db
      if (ProcessTelegramCommands $telegramDb) { Save-Db $telegramDb }
      $nextTelegramPollAt = (Get-Date).AddSeconds((GetTelegramCommandInterval $telegramDb))
    } catch {
      Log ('Telegram poll error: ' + $_.Exception.Message)
      $nextTelegramPollAt = (Get-Date).AddSeconds(10)
    }
  }
  $pendingContext = $listener.BeginGetContext($null, $null)
  while (-not $pendingContext.AsyncWaitHandle.WaitOne(1000)) {
    $now = Get-Date
    if ($now -ge $nextSiteCheckAt -or $now -ge $nextDeviceCheckAt) {
      try {
        $backgroundDb = Load-Db
        $runSites = $now -ge $nextSiteCheckAt
        $runDevices = $now -ge $nextDeviceCheckAt
        CheckAll $backgroundDb $runSites $runDevices
        Save-Db $backgroundDb
        if ($runSites) { $nextSiteCheckAt = (Get-Date).AddSeconds((GetSiteCheckInterval $backgroundDb)) }
        if ($runDevices) { $nextDeviceCheckAt = (Get-Date).AddSeconds((GetDeviceCheckInterval $backgroundDb)) }
      } catch {
        Log ('Background check error: ' + $_.Exception.Message)
        $nextSiteCheckAt = (Get-Date).AddSeconds(30)
        $nextDeviceCheckAt = (Get-Date).AddSeconds(30)
      }
    }
    if ($now -ge $nextTelegramPollAt) {
      try {
        $telegramDb = Load-Db
        if (ProcessTelegramCommands $telegramDb) { Save-Db $telegramDb }
        $nextTelegramPollAt = (Get-Date).AddSeconds((GetTelegramCommandInterval $telegramDb))
      } catch {
        Log ('Telegram poll error: ' + $_.Exception.Message)
        $nextTelegramPollAt = (Get-Date).AddSeconds(10)
      }
    }
  }
  $ctx = $listener.EndGetContext($pendingContext)
  $path = $ctx.Request.Url.AbsolutePath
  Log ($ctx.Request.HttpMethod + ' ' + $path)
  try {
    if ($path -eq '/') { $path = '/index.html' }
    if ($path -like '/api/*') {
      $db = Load-Db
      switch -Regex ($path) {
        '^/api/state$' { Send $ctx ($db | ConvertTo-Json -Depth 30); continue }
        '^/api/check$' { CheckAll $db; Save-Db $db; Send $ctx ($db | ConvertTo-Json -Depth 30); continue }
        '^/api/site/add$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          if ($b.url -notmatch '^https?://') { $b.url = 'https://' + $b.url }
          if ($b.color) { $color = $b.color } else { $color = '#35f0ff' }
          $db.sites += [pscustomobject]@{ id=NewId; name=$b.name; url=$b.url; color=$color; status='WAIT'; code=0; response=0; ping=0; dns=@(); ssl=$null; checked='-'; lastFailure='Никогда' }
          Save-Db $db; Log 'Saved: site/add'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/site/update$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          if ($b.url -notmatch '^https?://') { $b.url = 'https://' + $b.url }
          foreach ($x in @($db.sites)) { if ($x.id -eq $b.id) { $x.name=$b.name; $x.url=$b.url; if ($b.color) { $x.color=$b.color } } }
          Save-Db $db; Log 'Saved: site/update'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/site/move$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $items = @($db.sites)
          $index = -1
          for ($i=0; $i -lt $items.Count; $i++) { if ($items[$i].id -eq $b.id) { $index=$i; break } }
          if ($index -ge 0) {
            $target = if ([string]$b.direction -eq 'up') { $index-1 } else { $index+1 }
            if ($target -ge 0 -and $target -lt $items.Count) {
              $temp=$items[$index]; $items[$index]=$items[$target]; $items[$target]=$temp
              $db.sites=$items
              Save-Db $db
            }
          }
          Send $ctx '{"ok":true}'; continue
        }
        '^/api/site/delete$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $deletedName = $null
          foreach ($x in @($db.sites)) { if ($x.id -eq $b.id) { $deletedName = $x.name } }
          $db.sites = @($db.sites | Where-Object { $_.id -ne $b.id })
          if ($deletedName) { $db.history = @($db.history | Where-Object { !($_.kind -eq 'site' -and (($_.objectId -and $_.objectId -eq $b.id) -or (!$_.objectId -and $_.name -eq $deletedName))) }) }
          Save-Db $db; Log 'Saved: site/delete'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/router/add$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          if ($b.color) { $color = $b.color } else { $color = '#7c5cff' }
          $ports = @(ParsePorts $b.ports)
          if ($ports.Count -eq 0 -and $null -ne $b.port) { $ports = @(ParsePorts $b.port) }
          $port = if ($ports.Count) { [int]$ports[0] } else { 0 }
          $checkType = [string]$b.checkType
          if ($checkType -notin @('ping','tcp','both')) { $checkType = 'ping' }
          $db.routers += [pscustomobject]@{ id=NewId; name=$b.name; address=$b.address; type=$b.type; color=$color; status='WAIT'; ping=0; port=$port; ports=$ports; portOk=$true; portResults=@(); checkType=$checkType; checked='-'; lastFailure='Никогда' }
          Save-Db $db; Log 'Saved: router/add'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/router/update$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $ports = @(ParsePorts $b.ports)
          if ($ports.Count -eq 0 -and $null -ne $b.port) { $ports = @(ParsePorts $b.port) }
          $port = if ($ports.Count) { [int]$ports[0] } else { 0 }
          $checkType = [string]$b.checkType
          if ($checkType -notin @('ping','tcp','both')) { $checkType = 'ping' }
          foreach ($x in @($db.routers)) {
            if ($x.id -eq $b.id) {
              $x.name=$b.name
              $x.address=$b.address
              if($b.type){$x.type=$b.type}
              if ($b.color) { $x.color=$b.color }
              try { $x.port=$port } catch { $x | Add-Member -NotePropertyName port -NotePropertyValue $port -Force }
              SetObjectProperty $x 'ports' $ports
              SetObjectProperty $x 'portResults' @()
              try { $x.checkType=$checkType } catch { $x | Add-Member -NotePropertyName checkType -NotePropertyValue $checkType -Force }
            }
          }
          Save-Db $db; Log 'Saved: router/update'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/router/move$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $items = @($db.routers)
          $index = -1
          for ($i=0; $i -lt $items.Count; $i++) { if ($items[$i].id -eq $b.id) { $index=$i; break } }
          if ($index -ge 0) {
            $target = if ([string]$b.direction -eq 'up') { $index-1 } else { $index+1 }
            if ($target -ge 0 -and $target -lt $items.Count) {
              $temp=$items[$index]; $items[$index]=$items[$target]; $items[$target]=$temp
              $db.routers=$items
              Save-Db $db
            }
          }
          Send $ctx '{"ok":true}'; continue
        }
        '^/api/network/info$' {
          Send $ctx ((GetLocalNetworkInfo) | ConvertTo-Json -Depth 6)
          continue
        }
        '^/api/network/scan$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $result = InvokeLocalNetworkScan ([string]$b.subnet)
          Send $ctx ($result | ConvertTo-Json -Depth 8)
          continue
        }
        '^/api/diagnostic$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $kind = [string]$b.kind
          $diagnosticType = [string]$b.type
          if ($diagnosticType -notin @('ping','dns','ssl','ports','trace','whois')) { throw 'Unsupported diagnostic type' }
          $obj = $null
          $target = ''
          $portsValue = ''
          if ($kind -eq 'site') {
            $obj = @($db.sites | Where-Object { $_.id -eq $b.id } | Select-Object -First 1)
            if ($obj.Count) { $obj = $obj[0]; $target = [string]$obj.url }
          } elseif ($kind -eq 'router') {
            $obj = @($db.routers | Where-Object { $_.id -eq $b.id } | Select-Object -First 1)
            if ($obj.Count) { $obj = $obj[0]; $target = [string]$obj.address; $portsValue = @($obj.ports) -join ',' }
          }
          if ($null -eq $obj -or [string]::IsNullOrWhiteSpace($target)) { throw 'Object not found' }
          if ($diagnosticType -eq 'ports' -and $kind -eq 'site') {
            $hostUri = [Uri]$target
            $portsValue = if ($hostUri.IsDefaultPort) { if ($hostUri.Scheme -eq 'https') { '443' } else { '80' } } else { [string]$hostUri.Port }
          }
          $result = InvokeDiagnostic $target $diagnosticType $portsValue
          Send $ctx ($result | ConvertTo-Json -Depth 12)
          continue
        }
        '^/api/router/delete$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $deletedName = $null
          foreach ($x in @($db.routers)) { if ($x.id -eq $b.id) { $deletedName = $x.name } }
          $db.routers = @($db.routers | Where-Object { $_.id -ne $b.id })
          if ($deletedName) { $db.history = @($db.history | Where-Object { !($_.kind -eq 'router' -and (($_.objectId -and $_.objectId -eq $b.id) -or (!$_.objectId -and $_.name -eq $deletedName))) }) }
          Save-Db $db; Log 'Saved: router/delete'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/port/check$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $p = [int]$b.port
          $free = $false
          try { $tcp = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse('127.0.0.1'), $p); $tcp.Start(); $tcp.Stop(); $free = $true } catch { $free = $false }
          if ($free) { $freeText = 'true' } else { $freeText = 'false' }
          Send $ctx ('{"free":' + $freeText + ',"port":' + $p + '}'); continue
        }
        '^/api/telegram/test$' {
          $res = SendTelegram $db 'Тестовое сообщение от программы мониторинга. Telegram уведомления работают.'
          Send $ctx ($res | ConvertTo-Json -Compress)
          continue
        }
        '^/api/telegram/commands/test$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          if ($null -ne $b.telegramToken) { $db.settings.telegramToken = [string]$b.telegramToken }
          if ($null -ne $b.telegramChat) { $db.settings.telegramChat = [string]$b.telegramChat }
          if ([string]::IsNullOrWhiteSpace([string]$db.settings.telegramToken) -or [string]::IsNullOrWhiteSpace([string]$db.settings.telegramChat)) {
            Send $ctx '{"ok":false,"error":"Telegram token or chat ID is empty"}'
            continue
          }
          $registered = RegisterTelegramCommands $db
          if (-not $registered.ok) {
            Send $ctx ($registered | ConvertTo-Json -Compress)
            continue
          }
          $res = SendTelegram $db (GetTelegramCommandReply $db 'help')
          Send $ctx ($res | ConvertTo-Json -Compress)
          continue
        }
        '^/api/events/clear$' {
          $db.events = @()
          Save-Db $db; Log 'Saved: events/clear'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/reset/all$' {
          $db.sites = @()
          $db.routers = @()
          $db.history = @()
          $db.events = @()
          $db.graphs = @([pscustomobject]@{ id='main_graph'; title='Общий график'; type='site_response'; style='line'; height=260; note='' })
          Save-Db $db; Log 'Saved: reset/all'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/import/config$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $b = Fix-ImportedDb $b $db.settings
          Save-Db $b; Log 'Saved: import/config'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/settings/save$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $db.settings.title = $appTitle
          $db.settings.subtitle = $appSubtitle
          if ($null -ne $b.language -and [string]$b.language -in @('ru','en')) { $db.settings.language = [string]$b.language }
          $db.settings.interval = [int]$b.interval
          if ($null -ne $b.siteInterval) { $db.settings.siteInterval = [int]$b.siteInterval }
          if ($null -ne $b.deviceInterval) { $db.settings.deviceInterval = [int]$b.deviceInterval }
          $db.settings.timeout = [int]$b.timeout
          if ($null -ne $b.port) { $db.settings.port = [int]$b.port }
          $db.settings.showMs = [bool]$b.showMs
          $db.settings.autoOpen = [bool]$b.autoOpen
          $db.settings.telegramToken = $b.telegramToken
          $db.settings.telegramChat = $b.telegramChat
          if ($null -ne $b.telegramCommandsEnabled) {
            $wasEnabled = ($db.settings.telegramCommandsEnabled -eq $true)
            $db.settings.telegramCommandsEnabled = [bool]$b.telegramCommandsEnabled
            if (-not $wasEnabled -and $db.settings.telegramCommandsEnabled) { $db.settings.telegramUpdateOffset = 0 }
          }
          if ($null -ne $b.telegramCommandInterval) {
            $commandInterval = [int]$b.telegramCommandInterval
            if ($commandInterval -lt 3) { $commandInterval = 3 }
            if ($commandInterval -gt 60) { $commandInterval = 60 }
            $db.settings.telegramCommandInterval = $commandInterval
          }
          $db.settings.uiScale = [double]$b.uiScale
          $db.settings.textScale = [double]$b.textScale
          if ($null -ne $b.autoRefresh) { $db.settings.autoRefresh = [int]$b.autoRefresh }
          if ($null -ne $b.siteWarn) { $db.settings.siteWarn = [int]$b.siteWarn }
          if ($null -ne $b.siteCrit) { $db.settings.siteCrit = [int]$b.siteCrit }
          if ($null -ne $b.deviceWarn) { $db.settings.deviceWarn = [int]$b.deviceWarn }
          if ($null -ne $b.deviceCrit) { $db.settings.deviceCrit = [int]$b.deviceCrit }
          if ($null -ne $b.notifyDown) { $db.settings.notifyDown = [bool]$b.notifyDown }
          if ($null -ne $b.notifySlow) { $db.settings.notifySlow = [bool]$b.notifySlow }
          if ($null -ne $b.notifyRecovered) { $db.settings.notifyRecovered = [bool]$b.notifyRecovered }
          if ($null -ne $b.tgSiteDown) { $db.settings.tgSiteDown = [string]$b.tgSiteDown }
          if ($null -ne $b.tgSiteSlow) { $db.settings.tgSiteSlow = [string]$b.tgSiteSlow }
          if ($null -ne $b.tgSiteRecovered) { $db.settings.tgSiteRecovered = [string]$b.tgSiteRecovered }
          if ($null -ne $b.tgDeviceDown) { $db.settings.tgDeviceDown = [string]$b.tgDeviceDown }
          if ($null -ne $b.tgDeviceSlow) { $db.settings.tgDeviceSlow = [string]$b.tgDeviceSlow }
          if ($null -ne $b.tgDeviceRecovered) { $db.settings.tgDeviceRecovered = [string]$b.tgDeviceRecovered }
          if ($null -ne $b.siteRepeatMinutes) { $db.settings.siteRepeatMinutes = [int]$b.siteRepeatMinutes }
          if ($null -ne $b.deviceRepeatMinutes) { $db.settings.deviceRepeatMinutes = [int]$b.deviceRepeatMinutes }
          if ($null -ne $b.failureConfirmChecks) { $db.settings.failureConfirmChecks = [int]$b.failureConfirmChecks }
          if ($null -ne $b.siteOverviewStyle -and [string]$b.siteOverviewStyle -in @('line','bar','pie')) { $db.settings.siteOverviewStyle = [string]$b.siteOverviewStyle }
          if ($null -ne $b.deviceOverviewStyle -and [string]$b.deviceOverviewStyle -in @('line','bar','pie')) { $db.settings.deviceOverviewStyle = [string]$b.deviceOverviewStyle }
          if ($null -ne $b.themePreset) { $db.settings.themePreset = [string]$b.themePreset }
          if ($null -ne $b.themeAccent) { $db.settings.themeAccent = [string]$b.themeAccent }
          if ($null -ne $b.themeButton) { $db.settings.themeButton = [string]$b.themeButton }
          if ($null -ne $b.themeOk) { $db.settings.themeOk = [string]$b.themeOk }
          if ($null -ne $b.themeBad) { $db.settings.themeBad = [string]$b.themeBad }
          if ($null -ne $b.themeBg) { $db.settings.themeBg = [string]$b.themeBg }
          if ($null -ne $b.themePanel) { $db.settings.themePanel = [string]$b.themePanel }
          Save-Db $db
          $nextSiteCheckAt = (Get-Date).AddSeconds((GetSiteCheckInterval $db))
          $nextDeviceCheckAt = (Get-Date).AddSeconds((GetDeviceCheckInterval $db))
          $nextTelegramPollAt = (Get-Date).AddSeconds(1)
          Log 'Saved: settings'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/graph/add$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $db.graphs += [pscustomobject]@{ id=NewId; title=$b.title; type=$b.type; style=$b.style; height=[int]$b.height; note=$b.note }
          Save-Db $db; Log 'Saved: graph/add'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/graph/update$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          foreach ($x in @($db.graphs)) { if ($x.id -eq $b.id) { $x.title=$b.title; $x.type=$b.type; $x.style=$b.style; $x.height=[int]$b.height; $x.note=$b.note } }
          Save-Db $db; Log 'Saved: graph/update'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/graph/delete$' {
          $b = ReadBody $ctx | ConvertFrom-Json
          $db.graphs = @($db.graphs | Where-Object { $_.id -ne $b.id })
          Save-Db $db; Log 'Saved: graph/delete'; Send $ctx '{"ok":true}'; continue
        }
        '^/api/history/clear$' {
          $db.history = @(); $db.events = @()
          Save-Db $db; Log 'Saved: history/clear'; Send $ctx '{"ok":true}'; continue
        }
      }
      Send $ctx '{"error":"unknown api"}'
      continue
    }

    $safePath = $path.TrimStart('/') -replace '/', '\'
    $file = [IO.Path]::GetFullPath((Join-Path $root $safePath))
    $rootPrefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    if (-not $file.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      Send $ctx 'Forbidden' 'text/plain; charset=utf-8'
      continue
    }
    if (Test-Path $file -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ct = 'application/octet-stream'
      if ($ext -eq '.html') { $ct = 'text/html; charset=utf-8' }
      elseif ($ext -eq '.css') { $ct = 'text/css; charset=utf-8' }
      elseif ($ext -eq '.js') { $ct = 'application/javascript; charset=utf-8' }
      elseif ($ext -eq '.svg') { $ct = 'image/svg+xml; charset=utf-8' }
      elseif ($ext -eq '.json') { $ct = 'application/json; charset=utf-8' }
      $bytes = [IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentType = $ct
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
      continue
    }
    $ctx.Response.StatusCode = 404
    Send $ctx 'Not found' 'text/plain; charset=utf-8'
  } catch {
    $err = $_.Exception.Message.Replace('"','')
    Log ('ERROR: ' + $err)
    Send $ctx ('{"error":"' + $err + '"}')
  }
}
