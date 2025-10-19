const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { verifyLicenseToken, encodeBase64Url, LicenseVerificationError } = require('../extension/lib/verifyLicense.js');

globalThis.crypto = webcrypto;

function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function createToken(payload, privateKey) {
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = Buffer.from(payloadJson, 'utf8');
  return webcrypto.subtle.sign({ name: 'Ed25519' }, privateKey, payloadBytes).then((signature) => {
    const payloadPart = encodeBase64Url(new Uint8Array(payloadBytes));
    const signaturePart = encodeBase64Url(new Uint8Array(signature));
    return `${payloadPart}.${signaturePart}`;
  });
}

test('verifyLicenseToken accepts valid licenses', async () => {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519', namedCurve: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyBase64 = toBase64(publicKeyRaw);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'TodoX',
    aud: 'client',
    ver: 1,
    iat: now,
    exp: now + 3600,
    nonce: 'unit-test-nonce',
    features: ['themes', 'focus_bgm'],
  };
  const token = await createToken(payload, keyPair.privateKey);
  const result = await verifyLicenseToken(token, publicKeyBase64);
  assert.deepEqual(result.payload, payload);
});

test('verifyLicenseToken rejects tampered payloads', async () => {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519', namedCurve: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyBase64 = toBase64(publicKeyRaw);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'TodoX',
    aud: 'client',
    ver: 1,
    iat: now,
    exp: now + 3600,
    nonce: 'tamper-nonce',
    features: ['themes'],
  };
  const token = await createToken(payload, keyPair.privateKey);
  const parts = token.split('.');
  const tamperedPayload = { ...payload, features: ['themes', 'focus_bgm'] };
  const tamperedPayloadBytes = Buffer.from(JSON.stringify(tamperedPayload), 'utf8');
  const tamperedToken = `${encodeBase64Url(new Uint8Array(tamperedPayloadBytes))}.${parts[1]}`;
  await assert.rejects(() => verifyLicenseToken(tamperedToken, publicKeyBase64), (error) => {
    assert.ok(error instanceof LicenseVerificationError);
    assert.equal(error.code, 'SIGNATURE');
    return true;
  });
});

test('verifyLicenseToken rejects expired licenses', async () => {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519', namedCurve: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyBase64 = toBase64(publicKeyRaw);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'TodoX',
    aud: 'client',
    ver: 1,
    iat: now - 7200,
    exp: now - 60,
    nonce: 'expired-nonce',
    features: ['themes'],
  };
  const token = await createToken(payload, keyPair.privateKey);
  await assert.rejects(() => verifyLicenseToken(token, publicKeyBase64), (error) => {
    assert.ok(error instanceof LicenseVerificationError);
    assert.equal(error.code, 'EXPIRED');
    return true;
  });
});
