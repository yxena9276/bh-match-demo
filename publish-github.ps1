[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')]
    [string]$RepoName = 'bh-match-demo',
    [switch]$Plan
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectDirectory = $PSScriptRoot
$expectedAccount = 'yxena9276'
$publishPaths = @('.gitignore', '.gitattributes', '.github', 'bh-demo', 'package.json', 'README.md', 'publish-github.ps1')

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Publication stopped; no force push is used." }
}

function Get-OptionalGhJson {
    param([string[]]$Arguments)
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = & gh @Arguments 2>$null
        if ($LASTEXITCODE -eq 0 -and $result) { return ($result | ConvertFrom-Json) }
        return $null
    } finally { $ErrorActionPreference = $savedPreference }
}

Push-Location -LiteralPath $projectDirectory
try {
    foreach ($publishPath in $publishPaths) {
        if (-not (Test-Path -LiteralPath $publishPath)) { throw "Missing project file: $publishPath" }
    }
    if ($Plan) {
        Write-Host "Account: $expectedAccount"
        Write-Host "Public repository: $expectedAccount/$RepoName"
        Write-Host 'Steps: test; verify login; create repository; commit selected files; push; enable Pages; deploy; verify HTTP response.'
        Write-Host 'Only the following paths will be staged:'
        $publishPaths | ForEach-Object { Write-Host "  $_" }
        Write-Host 'AAA.xlsx and work/ are excluded. No credentials are printed or written by this script.'
        return
    }

    foreach ($program in @('gh', 'git', 'node', 'npm')) {
        if (-not (Get-Command $program -ErrorAction SilentlyContinue)) { throw "Required command not found: $program" }
    }
    Invoke-Checked -Program npm -Arguments @('test')
    $viewer = (Invoke-Checked -Program gh -Arguments @('api', 'user', '--jq', '{login:.login,id:.id}')) | ConvertFrom-Json
    if ($viewer.login -ne $expectedAccount) {
        throw "Logged in as $($viewer.login), expected $expectedAccount. Switch the GitHub CLI account before publishing."
    }
    $fullName = "$($viewer.login)/$RepoName"
    $remoteUrl = "https://github.com/$fullName.git"

    if (-not (Test-Path -LiteralPath '.git')) {
        Invoke-Checked -Program git -Arguments @('init', '-b', 'main')
    }
    $gitRoot = Invoke-Checked -Program git -Arguments @('rev-parse', '--show-toplevel')
    if ([IO.Path]::GetFullPath($gitRoot) -ne [IO.Path]::GetFullPath($projectDirectory)) {
        throw 'The Git repository root does not match this project directory.'
    }
    $branch = Invoke-Checked -Program git -Arguments @('symbolic-ref', '--short', 'HEAD')
    if ($branch -ne 'main') { throw 'This script expects the main branch and will not switch branches automatically.' }
    $existingRemotes = @(Invoke-Checked -Program git -Arguments @('remote'))
    if ($existingRemotes -contains 'origin') {
        $origin = Invoke-Checked -Program git -Arguments @('remote', 'get-url', 'origin')
        if ($origin -notin @($remoteUrl, "https://github.com/$fullName", "git@github.com:$fullName.git")) {
            throw "Existing origin points to a different repository: $origin"
        }
    }
    $trackedExcel = Invoke-Checked -Program git -Arguments @('ls-files', '--', 'AAA.xlsx')
    if ($trackedExcel) { throw 'AAA.xlsx is tracked. Remove it from the index before publishing; the original workbook must not be uploaded.' }
    $staged = @(Invoke-Checked -Program git -Arguments @('diff', '--cached', '--name-only'))
    foreach ($entry in $staged) {
        if ($entry -and $entry -notmatch '^(\.gitignore|\.gitattributes|package\.json|README\.md|publish-github\.ps1|\.github/.*|bh-demo/.*)$') {
            throw "An unrelated file is already staged: $entry. Unstage it before publishing."
        }
    }

    $repository = Get-OptionalGhJson -Arguments @('repo', 'view', $fullName, '--json', 'nameWithOwner,isEmpty,url')
    if (-not $repository) {
        Invoke-Checked -Program gh -Arguments @('repo', 'create', $fullName, '--public', '--description', 'Desensitized BH parts-combination matching demo')
    } elseif (-not $repository.isEmpty -and $existingRemotes -notcontains 'origin') {
        throw "Repository $fullName already contains files. Choose a different -RepoName; existing remote content will not be overwritten."
    }
    if ($existingRemotes -notcontains 'origin') {
        Invoke-Checked -Program git -Arguments @('remote', 'add', 'origin', $remoteUrl)
    }

    $gitUserName = & git config --get user.name
    if (-not $gitUserName) { Invoke-Checked -Program git -Arguments @('config', '--local', 'user.name', $viewer.login) }
    $gitUserEmail = & git config --get user.email
    if (-not $gitUserEmail) {
        Invoke-Checked -Program git -Arguments @('config', '--local', 'user.email', "$($viewer.id)+$($viewer.login)@users.noreply.github.com")
    }
    Invoke-Checked -Program git -Arguments (@('add', '--') + $publishPaths)
    $changes = @(Invoke-Checked -Program git -Arguments @('diff', '--cached', '--name-only'))
    if ($changes.Count -gt 0) {
        Invoke-Checked -Program git -Arguments @('commit', '-m', 'Add tested BH matching demo and Pages deployment')
    }
    Invoke-Checked -Program git -Arguments @('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '-u', 'origin', 'main')

    $pages = Get-OptionalGhJson -Arguments @('api', "repos/$fullName/pages")
    if (-not $pages) {
        Invoke-Checked -Program gh -Arguments @('api', '--method', 'POST', "repos/$fullName/pages", '-f', 'build_type=workflow', '--silent')
    } else {
        Invoke-Checked -Program gh -Arguments @('api', '--method', 'PUT', "repos/$fullName/pages", '-f', 'build_type=workflow', '--silent')
    }
    Invoke-Checked -Program gh -Arguments @('workflow', 'run', 'pages.yml', '--repo', $fullName, '--ref', 'main')
    $commit = Invoke-Checked -Program git -Arguments @('rev-parse', 'HEAD')
    $runId = $null
    for ($attempt = 0; $attempt -lt 20 -and -not $runId; $attempt++) {
        Start-Sleep -Seconds 3
        $runId = Invoke-Checked -Program gh -Arguments @('run', 'list', '--repo', $fullName, '--workflow', 'pages.yml', '--event', 'workflow_dispatch', '--commit', $commit, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId')
    }
    if (-not $runId) { throw "Deployment was requested but no run was found yet. Check https://github.com/$fullName/actions" }
    Invoke-Checked -Program gh -Arguments @('run', 'watch', [string]$runId, '--repo', $fullName, '--exit-status')
    $siteUrl = Invoke-Checked -Program gh -Arguments @('api', "repos/$fullName/pages", '--jq', '.html_url')
    $verified = $false
    for ($attempt = 0; $attempt -lt 12 -and -not $verified; $attempt++) {
        try {
            $page = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 20
            $sample = Invoke-RestMethod -Uri "$($siteUrl.TrimEnd('/'))/data/sample.json" -TimeoutSec 20
            $verified = ($page.StatusCode -eq 200 -and $page.Content.Contains('parts-input') -and $sample.combinations.Count -eq 7)
        } catch { $verified = $false }
        if (-not $verified) { Start-Sleep -Seconds 5 }
    }
    Write-Host "Repository: https://github.com/$fullName"
    Write-Host "Website: $siteUrl"
    if (-not $verified) { throw 'The workflow succeeded but public HTTP verification is not complete. Keep the URL and retry it shortly.' }
    Write-Host 'Published and HTTP-verified. New BH records remain local to each browser.'
} finally { Pop-Location }
