$content = Get-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Raw
$matches = [System.Text.RegularExpressions.Regex]::Matches($content, 'function _toggleContactInfoSidebar\(\)')
if ($matches.Count -ge 2) {
    $pos = $matches[1].Index
    $newContent = $content.Substring(0, $pos)
    Set-Content 'D:\Foodhubbie Project\Admin\js\features\chat.js' -Value $newContent -Encoding UTF8
    Write-Host 'Removed duplicate from second _toggleContactInfoSidebar'
} else {
    Write-Host 'Second toggle not found'
}