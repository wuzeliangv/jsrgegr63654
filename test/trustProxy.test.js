const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTrustProxyCidrs,
  parseTrustProxyValue,
  resolveTrustProxyConfig,
} = require('../src/utils/trustProxy');

test('parseTrustProxyCidrs parses comma separated values', () => {
  const cidrs = parseTrustProxyCidrs(' 10.0.0.0/8, 192.168.1.10 , ::1/128 ');
  assert.deepEqual(cidrs, ['10.0.0.0/8', '192.168.1.10', '::1/128']);
});

test('parseTrustProxyValue keeps compatibility with existing TRUST_PROXY behavior', () => {
  assert.equal(parseTrustProxyValue('false'), false);
  assert.equal(parseTrustProxyValue('0'), false);
  assert.equal(parseTrustProxyValue('2'), 2);
  assert.equal(parseTrustProxyValue('loopback, linklocal, uniquelocal'), 'loopback, linklocal, uniquelocal');
});

test('resolveTrustProxyConfig prefers TRUST_PROXY_CIDRS and restricts trusted proxies', () => {
  const config = resolveTrustProxyConfig({
    TRUST_PROXY: '1',
    TRUST_PROXY_CIDRS: '10.0.0.0/8,192.168.1.10,::1/128',
  });
  assert.equal(config.mode, 'cidr');
  assert.equal(config.value('10.10.20.30'), true);
  assert.equal(config.value('192.168.1.10'), true);
  assert.equal(config.value('::1'), true);
  assert.equal(config.value('198.51.100.20'), false);
});

test('resolveTrustProxyConfig falls back to TRUST_PROXY when no CIDRs are configured', () => {
  const config = resolveTrustProxyConfig({
    TRUST_PROXY: '3',
    TRUST_PROXY_CIDRS: '',
  });
  assert.equal(config.mode, 'default');
  assert.equal(config.value, 3);
});
