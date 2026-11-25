param(
  [Parameter(Mandatory = $true)]
  [string[]]$SvgPath
)

Set-StrictMode -Version Latest
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$imagePattern = '<image width="(?<w>[\d.]+)" height="(?<h>[\d.]+)" x="(?<x>[\d.]+)" y="(?<y>[\d.]+)" xlink:href="data:image/png;base64,[^"]+"\s*/>'

foreach ($path in $SvgPath) {
  $resolved = (Resolve-Path -LiteralPath $path).Path
  $svg = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8
  $pumlPath = [System.IO.Path]::ChangeExtension($resolved, '.puml')
  if (-not (Test-Path -LiteralPath $pumlPath)) {
    throw "Matching PlantUML source not found: $pumlPath"
  }
  $puml = Get-Content -LiteralPath $pumlPath -Raw -Encoding UTF8
  $kinds = @([regex]::Matches($puml, '\$business_(actor|customer|worker|entity)') | ForEach-Object { $_.Groups[1].Value })
  if ($kinds.Count -lt 1) {
    throw "No business symbol declarations found in $pumlPath"
  }
  $state = [pscustomobject]@{ Index = 0 }

  $svg = [regex]::Replace($svg, $imagePattern, [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)

    $width = [double]::Parse($match.Groups['w'].Value, $culture)
    $x = [double]::Parse($match.Groups['x'].Value, $culture) + 2
    $y = [double]::Parse($match.Groups['y'].Value, $culture) + 2
    $scale = ($width - 4) / 84
    $transform = 'translate({0} {1}) scale({2})' -f $x.ToString('0.###', $culture), $y.ToString('0.###', $culture), $scale.ToString('0.######', $culture)

    if ($state.Index -ge $kinds.Count) {
      throw "More embedded symbols than declarations in $resolved"
    }
    $kind = $kinds[$state.Index]

    if ($kind -in @('actor','customer')) {
      $shape = '<circle cx="42" cy="19" r="8"/><path d="M42 27 L42 49 M29 36 L55 36 M42 49 L31 72 M42 49 L53 72"/>'
      $className = 'business-actor-vector'
    }
    elseif ($kind -eq 'worker') {
      $shape = '<circle cx="42" cy="41" r="31"/><path d="M42 10 L53 3 M42 10 L52 14"/><circle cx="42" cy="28" r="6"/><path d="M42 34 L42 50 M32 40 L52 40 M42 50 L34 65 M42 50 L50 65"/><path d="M42 72 L67 59"/>'
      $className = 'business-worker-vector'
    }
    else {
      $shape = '<circle cx="42" cy="37" r="30"/><path d="M42 67 L66 55"/><path d="M10 67 L74 67"/>'
      $className = 'business-entity-vector'
    }

    $state.Index++
    return '<g class="business-symbol-vector {0}" transform="{1}" fill="none" stroke="#315E57" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round">{2}</g>' -f $className, $transform, $shape
  })

  if ($state.Index -ne $kinds.Count) {
    throw "Symbol count mismatch in ${resolved}: converted $($state.Index), expected $($kinds.Count)"
  }

  Set-Content -LiteralPath $resolved -Value $svg -Encoding utf8NoBOM
  Write-Output "Vectorized $($state.Index) symbol(s): $resolved"
}
