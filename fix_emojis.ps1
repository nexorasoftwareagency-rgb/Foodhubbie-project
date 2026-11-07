$content = Get-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Raw
$matches = [System.Text.RegularExpressions.Regex]::Matches($content, 'const emojis =')
if ($matches.Count -ge 2) {
    $pos = $matches[1].Index
    $newContent = $content.Substring(0, $pos)
    Set-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Value $newContent -Encoding UTF8
    Write-Host 'Removed duplicate emojis'
} else {
    Write-Host 'Second emojis not found'
}