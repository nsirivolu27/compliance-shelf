param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId,
  [Alias('Profile')][string]$AwsProfile = 'compliance-demo',
  [ValidateSet('us-east-1')][string]$Region = 'us-east-1',
  [ValidatePattern('^[a-z][a-z0-9-]{2,30}$')][string]$StackName = 'compliance-demo-public',
  [ValidateSet('va-ssa','va-audit')][string]$Scenario = 'va-audit',
  [ValidateRange(1,12)][int]$RunHours = 12,
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$build = Get-Content -LiteralPath (Join-Path $repo 'dist/aws-demo/latest.json') -Raw | ConvertFrom-Json
function Invoke-Aws([string[]]$Arguments) {
  $output = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS operation failed: $($Arguments[0]) $($Arguments[1])" }
  return ($output -join "`n")
}
$identity = (Invoke-Aws @('sts','get-caller-identity')) | ConvertFrom-Json
if ($identity.Account -ne $ExpectedAccountId) { throw 'Wrong AWS account; nothing created.' }
$plan = (Invoke-Aws @('freetier','get-account-plan-state')) | ConvertFrom-Json
if ($plan.accountPlanType -ne 'FREE' -or $plan.accountPlanStatus -ne 'ACTIVE' -or $plan.accountPlanRemainingCredits.amount -lt 5) {
  throw 'This launcher requires an active FREE plan with at least $5 in credits. It never upgrades plans.'
}
$hash = (Get-FileHash -LiteralPath $build.archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $build.sha256) { throw 'Archive changed; rebuild.' }
$template = Join-Path $build.directory 'cloudfront.template.json'
$storageTemplate = Join-Path $build.directory 'artifacts.template.json'
Invoke-Aws @('cloudformation','validate-template','--template-body',"file://$template") | Out-Null
Invoke-Aws @('cloudformation','validate-template','--template-body',"file://$storageTemplate") | Out-Null
$prefixes = (Invoke-Aws @('ec2','describe-managed-prefix-lists','--filters','Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing')) | ConvertFrom-Json
$prefix = $prefixes.PrefixLists[0].PrefixListId
if (-not $prefix) { throw 'CloudFront network prefix unavailable.' }
Write-Host "Ready: account $ExpectedAccountId, active FREE plan, $($plan.accountPlanRemainingCredits.amount) USD credits."
Write-Host "Private EC2 + CloudFront password + NAT + encrypted storage. EC2 stops $RunHours hours after boot; NAT and storage continue consuming credits."
if (-not $Execute) { Write-Host 'Preflight only; no resources created.'; return }
$local = Join-Path $repo '.local/aws-demo-access'
New-Item -ItemType Directory -Force $local | Out-Null
$accessPath = Join-Path $local "$StackName.json"
if (Test-Path -LiteralPath $accessPath) {
  $access = Get-Content -LiteralPath $accessPath -Raw | ConvertFrom-Json
  if ($access.accountId -ne $ExpectedAccountId) { throw 'Saved demo access belongs to another account.' }
} else {
  $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
  $access = [pscustomobject]@{ accountId=$ExpectedAccountId; stack=$StackName; region=$Region; username='reviewer'; password=$password; url=$null }
  $access | ConvertTo-Json | Set-Content -LiteralPath $accessPath
}
$authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($access.username):$($access.password)"))
$authHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($authorization))).ToLowerInvariant()
$artifactStack = 'compliance-demo-artifacts'
Invoke-Aws @('cloudformation','deploy','--stack-name',$artifactStack,'--template-file',$storageTemplate,'--no-fail-on-empty-changeset') | Out-Null
$storage = (Invoke-Aws @('cloudformation','describe-stacks','--stack-name',$artifactStack)) | ConvertFrom-Json
$bucket = ($storage.Stacks[0].Outputs | Where-Object OutputKey -eq 'Bucket').OutputValue
$key = "builds/$hash.tar.gz"
$uploaded = (Invoke-Aws @('s3api','put-object','--bucket',$bucket,'--key',$key,'--body',$build.archive,'--expected-bucket-owner',$ExpectedAccountId,'--server-side-encryption','AES256')) | ConvertFrom-Json
if (-not $uploaded.VersionId -or $uploaded.VersionId -eq 'null') { throw 'Artifact bucket must be versioned.' }
$parameters = @("ArtifactBucket=$bucket", "ArtifactKey=$key", "ArtifactVersion=$($uploaded.VersionId)", "ArtifactSha256=$hash", "CloudFrontPrefixList=$prefix", "DemoAuthHash=$authHash", "Scenario=$Scenario", "RunHours=$RunHours")
Invoke-Aws (@('cloudformation','deploy','--stack-name',$StackName,'--template-file',$template,'--capabilities','CAPABILITY_IAM','--no-fail-on-empty-changeset','--parameter-overrides') + $parameters) | Out-Null
$stack = ((Invoke-Aws @('cloudformation','describe-stacks','--stack-name',$StackName)) | ConvertFrom-Json).Stacks[0]
$outputs = @{}; foreach ($item in $stack.Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }
$access.url = $outputs.Url
$access | ConvertTo-Json | Set-Content -LiteralPath $accessPath
$outputs | ConvertTo-Json | Set-Content (Join-Path $local "$StackName-outputs.json")
Write-Host "Stack created: $($outputs.Url). Password saved locally at $accessPath; it is not printed."
Write-Host 'Configure the generated hostname on the private proxy through Systems Manager, then verify sign-in and the live demo before sharing.'
