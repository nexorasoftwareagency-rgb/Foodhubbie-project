$content = Get-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Raw -Encoding UTF8
# Remove BOM if present
if ($content.StartsWith([char]0xFEFF)) {
    $content = $content.Substring(1)
}
# Normalize line endings to LF
$content = $content.Replace("`r`n", "`n").Replace("`r", "`n")
Set-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Value $content -Encoding UTF8 -NoNewline
Write-Host 'Fixed encoding and line endings'