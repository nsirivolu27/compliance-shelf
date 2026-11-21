# AWS demo preparation

Two deployment options are available. The domain-free path below is the selected submission setup. Deployment results and the actual URL belong in the current Codex handoff; template creation alone is not proof that a site is live.

## Domain-free submission setup

`cloudfront.template.json` uses an AWS-provided HTTPS address, a CloudFront password check on every request, and a private EC2 origin. It requires no purchased domain, ACM certificate, public server IP, or load balancer. A NAT gateway supplies outbound package installation and Systems Manager access. The existing Nginx proxy validates the generated hostname and same-origin requests before reaching the unchanged loopback services. Caching is disabled for the whole application; the shared password header is removed before forwarding.

The user selected a shared demo password for submission. This is browser HTTP Basic authentication over HTTPS, not individual Cognito accounts or per-user agency permissions. Use a private browser window and close it to finish; browsers cache Basic authentication credentials. The audit actor remains `local-demo-operator`. Demo access details are generated in the ignored `.local/aws-demo-access/` folder and never included in the source archive or printed by the launcher. Share them deliberately with intended demo viewers.

```powershell
npm run build:aws-demo
.\infra\aws-demo\deploy-free.ps1 -ExpectedAccountId 123456789012 -AwsProfile compliance-demo
```

The default command is read-only preflight. With `-Execute`, it deploys only if AWS reports the selected account has an ACTIVE FREE plan and at least USD5 of credits. It never upgrades the account. The deployed scenario defaults to `va-audit`; `-Scenario va-ssa` chooses the two-agency paperwork seed. The selected stack defaults to `compliance-demo-public`. After creation, run `configure-cloudfront.ps1 -ExpectedAccountId <account>` to configure Nginx through Systems Manager with the generated hostname, and inspect the returned command's completion. Verify HTTP 401 without credentials and the full authenticated journey. A generated CloudFront URL alone is not a successful demo.

`node infra/aws-demo/verify-cloud.mjs` exercises the deployed `va-audit` workspace with the saved local demo credentials. It intentionally adds an SSA paperwork example through the API if absent, while preserving the seeded VA case. It checks password denial, foreign-origin rejection, service health, a refused stale save, the active hold, document processing and the downloaded packet digest. It saves synthetic verification exports under `.local/aws-demo-verification`. This is an API check, not a browser interaction or a user study.

AWS Free-plan credits are consumed by the running resources. EC2 stops 12 hours after boot by default for this launcher. NAT, storage and any CloudFront traffic continue consuming credits until cleanup; the timer is not a full shutdown or spend cap. Do not upgrade to a Paid plan as a workaround for a restricted service. Export required demo data before deliberately deleting this stack and inspecting retained artifact objects.

## Optional custom-domain configuration

The remainder describes the earlier ALB/Cognito option (`deploy.ps1`). It is separate from the selected shared-password CloudFront path and does require domain ownership and a certificate.

## What runs

Browser → HTTPS Application Load Balancer → Cognito sign-in → private Nginx target → existing loopback gateway → all eight Node services. The EC2 host runs Amazon Linux 2023 and its namespaced Node 22 package. JSON workspace, documents, and jobs remain on encrypted EBS. This is one synthetic demo workspace, not a horizontally scalable or production deployment.

The security group admits port 8080 only from the load balancer. There is no public SSH or direct gateway port. The proxy checks the public Host and Origin before translating valid requests to the loopback origin. Existing app checks and API contracts stay unchanged. The application process is restricted to loopback; no AWS credentials are passed into service children. Administrators use Systems Manager.

Cognito controls entry only. Application audit events still identify the shared `local-demo-operator`; they do not prove which Cognito user took an action. All invited demo users can use the same workspace. No invitation is sent by these scripts. There is no app logout control yet: end the demo in a private browser window and close it afterward; ALB sessions last one hour. This is not agency authorization or an official audit system.

## Cost and prerequisites

AWS is optional for recording the demo. Local launch remains free of AWS charges. This public stack creates billable EC2, ALB, public IPv4 addresses, EBS, S3 and potentially Cognito usage. Credits/free-tier coverage must be checked in the actual account; no zero-dollar promise is made.

Required: signed-in AWS CLI profile, selected account and region, an existing public Route 53 zone, a hostname in that zone, an issued ACM certificate covering that hostname in the same region, and an agreed cost allowance. Purchasing a domain is not included. A `vt.edu` email address alone does not provide an AWS account, DNS control, or Virginia Tech authorization.

```powershell
aws login --profile compliance-demo --region us-east-1
aws sts get-caller-identity --profile compliance-demo --region us-east-1
```

Use local browser sign-in; never paste AWS access keys or login codes into chat. IAM Identity Center accounts may require `aws configure sso` and `aws sso login` instead.

## Build and review

From the repository root, with Node 22.18 or later:

```powershell
npm run verify
node infra/aws-demo/build.mjs
```

The build creates a fresh `dist/aws-demo/build-*` directory and `dist/aws-demo/latest.json`. It includes the source, UI, explicit public/synthetic fixtures, all synthetic document originals and text companions, and a file hash manifest. It excludes credentials, `.local`, saved workspaces, node_modules, Python/video files and facilitator answer keys. No upload occurs during build. Preserve the original PDF/text distinction; this package adds no OCR.

Generated files: `compliance-demo.tar.gz`, `artifacts.template.json`, `application.template.json`. The artifact bucket is private, encrypted and versioned. The instance role can fetch only the selected artifact key and version. Bootstrap checks its SHA-256 before extraction.

`deploy.ps1` defaults to read-only preflight: confirms account identity, domain zone, certificate and CloudFormation template validity. Supply real values, not these placeholders:

```powershell
.\infra\aws-demo\deploy.ps1 -ExpectedAccountId 123456789012 -Profile compliance-demo `
  -Domain demo.example.org -HostedZoneId ZEXAMPLE -CertificateArn arn:aws:acm:us-east-1:123456789012:certificate/REPLACE `
  -Scenario va-ssa
```

Only after cost approval and a successful preflight, add `-Execute -AllowBillableResources`. This creates resources and a DNS record. `va-ssa` seeds the VA/SSA paperwork examples; `va-audit` seeds the detailed VA document-review scenario. Choose before first launch. It does not combine the two fresh-workspace seeds or invent an SSA document pack.

The EC2 timer stops the instance after `RunHours` (default 4) from each boot. It is not a spend cap. ALB and storage charges continue. Template deployment success does not mean bootstrap or sign-in works: perform the verification below.

## End-to-end verification after deployment

1. Inspect stack events, target health, `cloud-init-output.log`, and `journalctl -u compliance-demo` through Systems Manager. Never paste session tokens. Confirm Node version, package hash, and all eight service health results.
2. Create a demo user deliberately in the Cognito console. Use suppressed invitations unless the owner explicitly authorizes sending one, and set/share credentials privately. Self-signup is disabled. The AWS console login and the demo login are separate.
3. In a fresh private browser window, confirm both the homepage and `/api/cases` redirect to sign-in; direct EC2 access must fail. After sign-in, check `/api/services`, cases and document intake. Confirm a foreign Origin is refused, and that a stale mutation still returns 409.
4. For `va-audit`: open the conflicting version documents, cite passages, verify references, record an evidence review, confirm a gap, assign a task, upload the remediation companion and repeat the review. The active hold must remain; nothing permits record destruction. For `va-ssa`, use the existing paperwork walkthroughs under `demo/va` and `demo/ssa`.
5. Download a case packet and audit report, recompute the packet digest, and keep exports locally. Restart `compliance-demo` and confirm the same case IDs, revisions, evidence and events remain. Verify public HTTPS again afterward.

`/var/lib/compliance-demo/workspace/demo-ready.json` records successful initialization. A restart reuses it. An incomplete seed, scenario mismatch, corrupt state or missing seeded case stops startup instead of replacing data. Export and inspect the folder before a deliberate fresh start. Never clear it automatically.

## Stop and cleanup

Stop EC2 promptly when the demo is over. To end ALB charges, export needed data and delete the application CloudFormation stack deliberately; this also deletes its instance, EBS workspace, DNS record and Cognito pool. Do not delete unrelated stacks. The artifact bucket is retained and objects expire after seven days; inspect all versions before separately deleting that bucket. Check Billing afterward for remaining resources. No automatic stack deletion is installed.

## Verification limits

Local tests cover persistent startup/restart, partial-seed refusal, template access constraints and proxy configuration. They are not AWS integration tests. CloudFormation account validation, Amazon Linux bootstrap, Nginx runtime behavior, Cognito browser sign-in, DNS, TLS and public end-to-end auditing remain unverified until deployment. There is no live agency connection, durable backup service, per-user authorization, production audit seal or LLM.

Official references: [ALB authentication and HTTPS requirements](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html), [Amazon Linux Node packages](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html), [AWS CLI sign-in](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [Systems Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html).
