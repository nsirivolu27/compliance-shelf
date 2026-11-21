#!/bin/bash
set -euo pipefail
# Executed by cloud-init as root, from the hash-checked application directory.
scenario="$1"
port="$2"
hours="$3"
domain="${4:-}"
[[ "$scenario" == va-ssa || "$scenario" == va-audit ]]
[[ "$port" =~ ^[0-9]+$ && "$hours" =~ ^[0-9]+$ ]]
dnf install -y nodejs22
/usr/bin/node-22 -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a!==22||b<18)process.exit(1)'
id compliance-demo >/dev/null 2>&1 || useradd --system --home-dir /var/lib/compliance-demo --shell /sbin/nologin compliance-demo
install -d -m 700 -o compliance-demo -g compliance-demo /var/lib/compliance-demo
cat > /etc/systemd/system/compliance-demo.service <<UNIT
[Unit]
Description=Compliance Platform synthetic demo
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=3
[Service]
Type=simple
User=compliance-demo
Group=compliance-demo
WorkingDirectory=/opt/compliance-platform
Environment=DEMO_STATE_DIR=/var/lib/compliance-demo/workspace
Environment=DEMO_SCENARIO=$scenario
Environment=PORT=$port
ExecStart=/usr/bin/node-22 /opt/compliance-platform/infra/aws-demo/start.mjs
Restart=on-failure
RestartSec=10
KillMode=mixed
TimeoutStopSec=25
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/compliance-demo
# The app needs only loopback. Package download and SSM use separate host processes.
IPAddressDeny=any
IPAddressAllow=localhost
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/compliance-demo-stop.service <<'UNIT'
[Unit]
Description=Stop the demo instance at the rehearsal time limit
[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -h now
UNIT
cat > /etc/systemd/system/compliance-demo-stop.timer <<UNIT
[Unit]
Description=Demo instance time limit (resets after each boot)
[Timer]
OnBootSec=${hours}h
Unit=compliance-demo-stop.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now amazon-ssm-agent compliance-demo-stop.timer compliance-demo.service
if [[ -n "$domain" || ! -f /etc/nginx/conf.d/compliance-demo.conf ]]; then
  domain="${domain:-pending.invalid}"
  [[ "$domain" =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ ]]
  dnf install -y nginx
  /usr/bin/node-22 infra/aws-demo/nginx.mjs "$domain" "$port" > /etc/nginx/conf.d/compliance-demo.conf
  # The stock server listens on 80; replace it so this host has only the intended proxy listener.
  cat > /etc/nginx/nginx.conf <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  server_tokens off;
  include /etc/nginx/conf.d/*.conf;
}
NGINX
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
fi
