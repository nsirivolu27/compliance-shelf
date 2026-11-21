import { pathToFileURL } from 'node:url';

export function proxyConfiguration(domain, port) {
  if (!/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(domain)) throw new Error('Invalid demo domain');
  if (!Number.isInteger(port) || port < 1024 || port > 65000) throw new Error('Invalid demo port');
  return `# Reachable only from the authenticated load balancer security group.
map $http_origin $origin_allowed {
  default 0;
  "" 1;
  "https://${domain}" 1;
}
map $http_origin $local_origin {
  default "";
  "https://${domain}" "http://127.0.0.1:${port}";
}
map $host $host_allowed {
  default 0;
  "${domain}" 1;
}
server {
  listen 8080 default_server;
  server_name ${domain};
  client_max_body_size 1m;
  # ALB health probes use the target IP as Host, and never expose this listener publicly.
  location = /healthz { access_log off; return 200 'proxy ready'; }
  location / {
    if ($host_allowed = 0) { return 421; }
    if ($origin_allowed = 0) { return 403; }
    proxy_pass http://127.0.0.1:${port};
    proxy_set_header Host "127.0.0.1:${port}";
    proxy_set_header Origin $local_origin;
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header X-Forwarded-Proto "";
    proxy_set_header X-Forwarded-For "";
    proxy_set_header X-Platform-Token "";
    # This demo does not consume identity claims; do not pass unused tokens into it.
    proxy_set_header X-Amzn-Oidc-Accesstoken "";
    proxy_set_header X-Amzn-Oidc-Data "";
    proxy_set_header X-Amzn-Oidc-Identity "";
    proxy_read_timeout 60s;
    add_header Cache-Control "no-store" always;
  }
}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(proxyConfiguration(process.argv[2], Number(process.argv[3])));
}
