import { configuration, serviceToken } from './config.mjs';
const config = configuration(), name = process.env.SERVICE_NAME;
const token = await serviceToken(config);
const response = await fetch(`http://127.0.0.1:${config.ports[name]}${name === 'workflow' ? '/api/health' : '/health'}`, { headers: { 'x-platform-token': token }, signal: AbortSignal.timeout(2000) });
if (!response.ok) process.exitCode = 1;
