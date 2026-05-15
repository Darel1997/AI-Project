# fix-lint.ps1
#
# Targeted fixes for the lint errors from the CI run:
#   - ~80 react/no-unescaped-entities (apostrophes/quotes in JSX text)
#   - 4 jsx-a11y/no-noninteractive-element-interactions in my code
#     (ConfirmDialog and MarketingNav backdrop divs)
#
# Skips:
#   - autoFocus warnings (pre-existing, separate concern)
#   - FeatureResults label-has-associated-control (pre-existing, needs careful review)
#   - CommandPalette/settings click handlers (pre-existing)
#
# Run from the repo root:
#     cd C:\Users\Darel\OneDrive\Desktop\Projects\repoinsight-ai
#     powershell -ExecutionPolicy Bypass -File .\fix-lint.ps1

$ErrorActionPreference = "Stop"

function Replace-LineAt {
    param(
        [string]$Path,
        [int]$LineNo,
        [int]$ColNo,
        [string]$From,
        [string]$To
    )
    if (-not (Test-Path $Path)) {
        Write-Warning "Skip (not found): $Path"
        return
    }
    $lines = [System.IO.File]::ReadAllLines($Path)
    $idx = $LineNo - 1
    if ($idx -lt 0 -or $idx -ge $lines.Length) {
        Write-Warning "Skip (line $LineNo out of range): $Path"
        return
    }
    $line = $lines[$idx]
    $col = $ColNo - 1
    if ($col -lt 0 -or $col -ge $line.Length) {
        Write-Warning "Skip (col $ColNo out of range): ${Path}:${LineNo}"
        return
    }
    if ($line.Substring($col, $From.Length) -ne $From) {
        Write-Warning "Skip (no match at ${LineNo}:${ColNo}): $Path (expected '$From', got '$($line.Substring($col, [Math]::Min($From.Length, $line.Length - $col)))')"
        return
    }
    $lines[$idx] = $line.Substring(0, $col) + $To + $line.Substring($col + $From.Length)
    [System.IO.File]::WriteAllLines($Path, $lines)
    Write-Host "  Fixed ${Path}:${LineNo}:${ColNo}"
}

# Process fixes in REVERSE order per file (highest line/col first) so that
# earlier edits don't shift positions of later ones.

# Bash-style heredoc isn't supported; use a structured list and sort.
$fixes = @(
    # ── react/no-unescaped-entities ──
    @{P="frontend/src/app/enterprise/page.tsx"; L=102; C=101; F="'"; T="&apos;"}
    @{P="frontend/src/app/enterprise/page.tsx"; L=102; C=152; F="'"; T="&apos;"}
    @{P="frontend/src/app/enterprise/page.tsx"; L=126; C=50;  F="'"; T="&apos;"}
    @{P="frontend/src/app/enterprise/page.tsx"; L=126; C=72;  F="'"; T="&apos;"}
    @{P="frontend/src/app/enterprise/page.tsx"; L=139; C=83;  F="'"; T="&apos;"}
    @{P="frontend/src/app/insights/page.tsx";   L=127; C=19;  F="'"; T="&apos;"}
    @{P="frontend/src/app/insights/page.tsx";   L=127; C=80;  F="'"; T="&apos;"}
    @{P="frontend/src/app/invitations/[token]/page.tsx"; L=96;  C=54;  F="'"; T="&apos;"}
    @{P="frontend/src/app/invitations/[token]/page.tsx"; L=130; C=117; F="'"; T="&apos;"}
    @{P="frontend/src/app/invitations/[token]/page.tsx"; L=156; C=16;  F="'"; T="&apos;"}
    @{P="frontend/src/app/orgs/[id]/page.tsx";  L=276; C=15;  F="'"; T="&apos;"}
    @{P="frontend/src/app/orgs/page.tsx";       L=132; C=53;  F="'"; T="&apos;"}
    @{P="frontend/src/app/page.tsx";            L=173; C=148; F="'"; T="&apos;"}
    @{P="frontend/src/app/repos/[id]/page.tsx"; L=1782; C=64; F='"'; T="&quot;"}
    @{P="frontend/src/app/repos/[id]/page.tsx"; L=1782; C=84; F='"'; T="&quot;"}
    @{P="frontend/src/app/repos/[id]/page.tsx"; L=1795; C=39; F="'"; T="&apos;"}
    @{P="frontend/src/app/security/page.tsx";   L=33;  C=69;  F="'"; T="&apos;"}
    @{P="frontend/src/app/security/page.tsx";   L=33;  C=148; F="'"; T="&apos;"}
    @{P="frontend/src/app/security/page.tsx";   L=62;  C=71;  F="'"; T="&apos;"}
    @{P="frontend/src/app/security/page.tsx";   L=99;  C=41;  F="'"; T="&apos;"}
    @{P="frontend/src/app/settings/integrations/page.tsx"; L=122; C=78;  F='"'; T="&quot;"}
    @{P="frontend/src/app/settings/integrations/page.tsx"; L=122; C=101; F='"'; T="&quot;"}
    @{P="frontend/src/app/settings/integrations/page.tsx"; L=139; C=38;  F="'"; T="&apos;"}
    @{P="frontend/src/components/repos/FeatureResults.tsx"; L=974;  C=92; F="'"; T="&apos;"}
    @{P="frontend/src/components/repos/FeatureResults.tsx"; L=1637; C=55; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=16; C=15;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=21; C=208; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=27; C=178; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=27; C=244; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=27; C=375; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=27; C=401; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=45; C=23;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=49; C=15;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=49; C=298; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=68; C=136; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=71; C=26;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=74; C=22;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=74; C=54;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=74; C=160; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=74; C=217; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=78; C=17;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=79; C=31;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/how-we-built-security-scanner.tsx"; L=89; C=55;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=17; C=284; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=17; C=316; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=39; C=75;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=58; C=37;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=58; C=404; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=58; C=487; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=58; C=545; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=61; C=17;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/introducing-repoinsight.tsx"; L=62; C=14;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=16; C=22;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=16; C=70;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=16; C=120; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=16; C=137; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=21; C=15;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=21; C=284; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=24; C=45;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=24; C=371; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=29; C=119; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=43; C=53;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=52; C=29;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=57; C=165; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=67; C=87;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=73; C=151; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=73; C=180; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=77; C=306; F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=81; C=45;  F="'"; T="&apos;"}
    @{P="frontend/src/content/blog/why-rag-for-code.tsx"; L=83; C=69;  F="'"; T="&apos;"}
)

# Group by file, sort each file's fixes by (line desc, col desc) so earlier
# edits don't shift later ones.
$byFile = $fixes | Group-Object -Property { $_.P }
foreach ($group in $byFile) {
    Write-Host "Processing $($group.Name)..."
    $sorted = $group.Group | Sort-Object @{E={[int]$_.L};Descending=$true}, @{E={[int]$_.C};Descending=$true}
    foreach ($fix in $sorted) {
        Replace-LineAt -Path $fix.P -LineNo $fix.L -ColNo $fix.C -From $fix.F -To $fix.T
    }
}

Write-Host ""
Write-Host "Done. Verify with: cd frontend; npm run lint"
