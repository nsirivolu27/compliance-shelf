// CloudFront viewer-request function. The template substitutes only a password hash.
var crypto = require('crypto');
function handler(event) {
  var request = event.request;
  var authorization = request.headers.authorization;
  if (!authorization || authorization.value.length > 2048 ||
      crypto.createHash('sha256').update(authorization.value).digest('hex') !== '__AUTH_HASH__') {
    return { statusCode: 401, statusDescription: 'Unauthorized', headers: {
      'www-authenticate': { value: 'Basic realm="Compliance Platform synthetic demo", charset="UTF-8"' },
      'cache-control': { value: 'no-store' },
      'content-type': { value: 'text/plain; charset=utf-8' }
    }, body: 'Sign in with the demo credentials supplied by the project owner.' };
  }
  // The origin receives neither the shared password nor a cached authenticated response.
  delete request.headers.authorization;
  return request;
}
