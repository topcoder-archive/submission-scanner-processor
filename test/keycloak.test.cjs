const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { test, mock } = require('node:test');
const nock = require('nock');
const issuer = 'https://scanner-worker.test/realms/m2m';
const clientId = 'scanner-worker';
Object.assign(process.env, {
  M2M_PROVIDER: 'keycloak', KEYCLOAK_ISSUER: issuer, KEYCLOAK_AUDIENCE: 'https://api.test',
  KEYCLOAK_TOKEN_URL: 'https://scanner-worker.test/m2m/token', KEYCLOAK_CLIENT_ID: clientId,
  KEYCLOAK_CLIENT_SECRET: 'synthetic-secret', KEYCLOAK_SCOPE: 'write:bus_api',
});
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
// Isolate auth transport from the helper's eager ClamAV startup loop.
mock.method(require('clamav.js'), 'version', (port, host, timeout, callback) => callback(null, 'synthetic ClamAV'))
mock.method(require('clamav.js'), 'createScanner', () => ({}))
const { postToBusAPI } = require('../src/common/helper');
/** Sign an isolated service fixture; optional changes exercise rejected token contracts. */
function token(changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'skills' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: issuer, aud: 'https://api.test', sub: 'service-skills',
    azp: clientId, gty: 'client-credentials', scope: 'write:bus_api', iat: now, exp: now + 900, ...changes })).toString('base64url');
  const input = `${h}.${p}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
test('Bus transport rejects invalid tokens and caches verified service credentials', async () => {
  nock.disableNetConnect();
  nock(issuer).persist().get('/protocol/openid-connect/certs').reply(200, {
    keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'skills', alg: 'RS256', use: 'sig' }],
  });
  try {
    for (const changes of [{ aud: 'wrong' }, { azp: 'other-client' }, { scope: 'read:bus_topics' }, { roles: ['administrator'] }]) {
      const mock = nock('https://scanner-worker.test').post('/m2m/token').reply(200, { access_token: token(changes), expires_in: 900 });
      await assert.rejects(postToBusAPI({}), /^Error: Keycloak M2M token request failed$/);
      assert.equal(mock.isDone(), true);
    }
    const jwt = token();
    const mock = nock('https://scanner-worker.test').post('/m2m/token', body => body.scope === 'write:bus_api').reply(200, { access_token: jwt, expires_in: 900 });
    const bus = nock('https://api.topcoder-dev.com', { reqheaders: { authorization: `Bearer ${jwt}` } }).post('/v5/bus/events').twice().reply(200, { accepted: true });
    assert.equal((await postToBusAPI({})).data.accepted, true);
    assert.equal((await postToBusAPI({})).data.accepted, true);
    assert.equal(bus.isDone(), true);
    assert.equal(mock.isDone(), true);
  } finally { nock.cleanAll(); nock.enableNetConnect(); }
});
