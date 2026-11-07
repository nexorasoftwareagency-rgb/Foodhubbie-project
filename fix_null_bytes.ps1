$content = Get-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Raw -Encoding UTF8
$content = $content.Replace("`0", "")
Set-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Value $content -Encoding UTF8
Write-Host 'Removed null bytes'