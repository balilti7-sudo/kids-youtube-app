$key = 'afDbx1u23h8Pn80eLJyPFWQbxsZ528fzWk0SRfMkwZY'
$path = 'C:\ProgramData\SafeTube\bridge.env'
if (Test-Path $path) {
  $lines = Get-Content $path -Encoding UTF8
  $out = [System.Collections.Generic.List[string]]::new()
  $done = $false
  foreach ($line in $lines) {
    if ($line -match '^\s*MEDIA_BRIDGE_WELCOME_KEY\s*=') { $out.Add(\"MEDIA_BRIDGE_WELCOME_KEY=$key\"); $done=$true }
    else { $out.Add($line) }
  }
  if (-not $done) { $out.Add(''); $out.Add('MEDIA_BRIDGE_WELCOME_KEY=' + $key) }
  Set-Content $path $out -Encoding utf8
  'bridge.env updated'
} else { 'no bridge.env' }
