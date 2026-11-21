param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId,
  [Parameter(Mandatory)][Alias('Profile')][string]$AwsProfile,
  [ValidateSet('us-east-1','us-east-2','us-west-2')][string]$Region = 'us-east-1',
  [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]+([.-][a-z0-9]+)+$')][string]$Domain,
  [Parameter(Mandatory)][ValidatePattern('^Z[A-Z0-9]+$')][string]$HostedZoneId,
  [Parameter(Mandatory)][string]$CertificateArn,
  [ValidatePattern('^[a-z][a-z0-9-]{2,30}$')][string]$StackName = 'compliance-demo',
  [ValidateSet('va-ssa','va-audit')][string]$Scenario = 'va-ssa',
  [ValidateRange(1,12)][int]$RunHours = 4,
  [switch]$Execute,
  [switch]$AllowBillableResources
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$build = Get-Content -LiteralPath (Join-Path $repo 'dist/aws-demo/latest.json') -Raw | ConvertFrom-Json
$actualHash = (Get-FileHash -LiteralPath $build.archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $build.sha256) { throw 'Build archive changed. Rebuild before deploying.' }
function Invoke-Aws([string[]]$Arguments) {
  $output = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS operation failed: $($Arguments[0]) $($Arguments[1])" }
  return ($output -join "`n")
}
$identity = (Invoke-Aws @('sts','get-caller-identity')) | ConvertFrom-Json
if ($identity.Account -ne $ExpectedAccountId) { throw 'Signed-in AWS account does not match ExpectedAccountId. Nothing was created.' }
if ($CertificateArn -notmatch "^arn:aws:acm:${Region}:${ExpectedAccountId}:certificate/[a-f0-9-]+$") { throw 'Certificate must belong to this region and account.' }
$certificate = ((Invoke-Aws @('acm','describe-certificate','--certificate-arn',$CertificateArn)) | ConvertFrom-Json).Certificate
if ($certificate.Status -ne 'ISSUED') { throw 'HTTPS certificate is not issued.' }
$covered = @($certificate.SubjectAlternativeNames | Where-Object { $_ -eq $Domain -or ($_ -like '*.*' -and $_.StartsWith('*.') -and $Domain.Substring($Domain.IndexOf('.') + 1) -eq $_.Substring(2)) })
if ($covered.Count -eq 0) { throw 'Certificate does not cover the demo domain.' }
$zone = ((Invoke-Aws @('route53','get-hosted-zone','--id',$HostedZoneId)) | ConvertFrom-Json).HostedZone
$zoneName = $zone.Name.TrimEnd('.')
if ($zone.Config.PrivateZone -or ($Domain -ne $zoneName -and -not $Domain.EndsWith(".$zoneName"))) { throw 'Domain must belong to the selected public hosted zone.' }
$artifactTemplate = Join-Path $build.directory 'artifacts.template.json'
$applicationTemplate = Join-Path $build.directory 'application.template.json'
Invoke-Aws @('cloudformation','validate-template','--template-body',"file://$artifactTemplate") | Out-Null
Invoke-Aws @('cloudformation','validate-template','--template-body',"file://$applicationTemplate") | Out-Null
Write-Host "Validated plan for account $ExpectedAccountId in $Region, https://$Domain, scenario $Scenario."
Write-Host 'Creates EC2, ALB, public IPv4, EBS, S3, Cognito, IAM, networking and a DNS record. Free hosting is NOT guaranteed.'
Write-Host "EC2 stops after $RunHours hours per boot; ALB and storage keep charging until cleaned up."
if (-not $Execute) { Write-Host 'Read-only preflight finished. No resources created.'; return }
if (-not $AllowBillableResources) { throw 'Execution requires an agreed cost allowance and -AllowBillableResources. No resources created.' }
$artifactStack = "$StackName-artifacts"
Invoke-Aws @('cloudformation','deploy','--stack-name',$artifactStack,'--template-file',$artifactTemplate,'--no-fail-on-empty-changeset') | Out-Null
$storage = (Invoke-Aws @('cloudformation','describe-stacks','--stack-name',$artifactStack)) | ConvertFrom-Json
$bucket = ($storage.Stacks[0].Outputs | Where-Object OutputKey -eq 'Bucket').OutputValue
$key = "builds/$($build.sha256).tar.gz"
$uploaded = (Invoke-Aws @('s3api','put-object','--bucket',$bucket,'--key',$key,'--body',$build.archive,'--expected-bucket-owner',$ExpectedAccountId,'--server-side-encryption','AES256')) | ConvertFrom-Json
if (-not $uploaded.VersionId -or $uploaded.VersionId -eq 'null') { throw 'Artifact versioning must be enabled.' }
$parameters = @(
  "ArtifactBucket=$bucket", "ArtifactKey=$key", "ArtifactVersion=$($uploaded.VersionId)", "ArtifactSha256=$($build.sha256)",
  "DemoDomain=$Domain", "HostedZoneId=$HostedZoneId", "CertificateArn=$CertificateArn",
  "SignInDomainPrefix=$StackName-$ExpectedAccountId-$Region", "Scenario=$Scenario", "RunHours=$RunHours"
)
$arguments = @('cloudformation','deploy','--stack-name',$StackName,'--template-file',$applicationTemplate,'--capabilities','CAPABILITY_IAM','--no-fail-on-empty-changeset','--parameter-overrides') + $parameters
Invoke-Aws $arguments | Out-Null
$deployed = (Invoke-Aws @('cloudformation','describe-stacks','--stack-name',$StackName)) | ConvertFrom-Json
$deployed.Stacks[0].Outputs | Format-Table OutputKey,OutputValue -AutoSize
Write-Host 'Stack created. Instance bootstrap, HTTPS sign-in and the full demo still require verification. No demo user was created or emailed.'
