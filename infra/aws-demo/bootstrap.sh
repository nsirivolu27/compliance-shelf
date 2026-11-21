#!/bin/bash
set -euo pipefail
dnf install -y awscli-2 tar gzip
install -d -m 755 /opt/compliance-platform
aws s3api get-object --region '${AWS::Region}' --bucket '${ArtifactBucket}' --key '${ArtifactKey}' --version-id '${ArtifactVersion}' /tmp/compliance-demo.tar.gz
echo '${ArtifactSha256}  /tmp/compliance-demo.tar.gz' | sha256sum --check --strict
tar -xzf /tmp/compliance-demo.tar.gz -C /opt/compliance-platform --no-same-owner
cd /opt/compliance-platform
bash infra/aws-demo/install.sh '${Scenario}' '${GatewayPort}' '${RunHours}' '${DemoDomain}'
