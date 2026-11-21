param(
  [string]$AwsProfile = 'compliance-demo',
  [ValidateSet('us-east-1')][string]$Region = 'us-east-1',
  [ValidatePattern('^[a-z][a-z0-9-]{2,30}$')][string]$StackName = 'compliance-demo-public',
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId
)
$ErrorActionPreference = 'Stop'
function Invoke-Aws([string[]]$Arguments) {
  $output = & aws @Arguments --profile $AwsProfile --region $Region --no-cli-pager --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS operation failed: $($Arguments[0]) $($Arguments[1])" }
  return ($output -join "`n")
}
$identity = (Invoke-Aws @('sts','get-caller-identity')) | ConvertFrom-Json
if ($identity.Account -ne $ExpectedAccountId) { throw 'Wrong AWS account.' }
$stack = ((Invoke-Aws @('cloudformation','describe-stacks','--stack-name',$StackName)) | ConvertFrom-Json).Stacks[0]
if ($stack.StackStatus -notin @('CREATE_COMPLETE','UPDATE_COMPLETE')) { throw "Stack is not ready: $($stack.StackStatus)" }
$values = @{}; foreach ($item in $stack.Outputs) { $values[$item.OutputKey] = $item.OutputValue }
$instance = $values.InstanceId
$domain = $values.Domain
if ($instance -notmatch '^i-[0-9a-f]+$' -or $domain -notmatch '^[a-z0-9]+\.cloudfront\.net$') { throw 'Unexpected stack outputs.' }
$parameters = @{}; foreach ($item in $stack.Parameters) { $parameters[$item.ParameterKey] = $item.ParameterValue }
$scenario = $parameters.Scenario
$port = $parameters.GatewayPort
$hours = $parameters.RunHours
if ($scenario -notin @('va-audit','va-ssa') -or $port -notmatch '^\d+$' -or $hours -notmatch '^\d+$') { throw 'Unexpected startup parameters.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$folder = Join-Path $repo '.local/aws-demo-verification'
New-Item -ItemType Directory -Force $folder | Out-Null
$commandPath = Join-Path $folder 'configure-proxy-command.json'
@{ commands = @(
  'set -eu',
  'cloud-init status --wait || test -f /opt/compliance-platform/BUILD.json',
  'cd /opt/compliance-platform',
  "bash infra/aws-demo/install.sh '$scenario' '$port' '$hours' '$domain'",
  'systemctl reload nginx',
  "curl --fail --silent http://127.0.0.1:$port/api/services",
  'cat /var/lib/compliance-demo/workspace/demo-ready.json',
  'systemctl is-active compliance-demo nginx'
); executionTimeout = @('600') } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $commandPath
$available = $false
for ($attempt = 0; $attempt -lt 15; $attempt++) {
  $status = (Invoke-Aws @('ssm','describe-instance-information','--filters',"Key=InstanceIds,Values=$instance")) | ConvertFrom-Json
  if ($status.InstanceInformationList[0].PingStatus -eq 'Online') { $available = $true; break }
  Start-Sleep -Seconds 10
}
if (-not $available) { throw 'Instance did not become available through Systems Manager; inspect bootstrap before retrying.' }
$sent = (Invoke-Aws @('ssm','send-command','--instance-ids',$instance,'--document-name','AWS-RunShellScript','--comment','Configure the synthetic demo proxy for its generated HTTPS hostname','--parameters',"file://$commandPath")) | ConvertFrom-Json
$commandId = $sent.Command.CommandId
@{ commandId=$commandId; instanceId=$instance; url=$values.Url } | ConvertTo-Json | Set-Content (Join-Path $folder 'configure-command.json')
Write-Host "Configuration command sent: $commandId. Public URL: $($values.Url)"
Write-Host 'Inspect command completion, then verify authenticated and unauthenticated requests. No password is printed.'
