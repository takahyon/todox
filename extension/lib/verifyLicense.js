(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TodoxVerifyLicense = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  const publicKeyCache = new Map();

  class LicenseVerificationError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "LicenseVerificationError";
      this.code = code;
    }
  }

  function decodeBase64Url(input) {
    if (typeof input !== "string" || input.length === 0) {
      throw new LicenseVerificationError("Empty base64 input", "FORMAT");
    }
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    try {
      if (typeof atob === "function") {
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      }
      if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(padded, "base64"));
      }
    } catch (error) {
      throw new LicenseVerificationError("Invalid base64 content", "FORMAT");
    }
    throw new LicenseVerificationError("Base64 decoding not supported", "UNSUPPORTED");
  }

  function encodeBase64Url(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new LicenseVerificationError("encodeBase64Url expects Uint8Array", "FORMAT");
    }
    if (typeof btoa === "function") {
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    throw new LicenseVerificationError("Base64 encoding not supported", "UNSUPPORTED");
  }

  async function importPublicKey(base64, cryptoImpl) {
    if (!cryptoImpl || !cryptoImpl.subtle) {
      throw new LicenseVerificationError("WebCrypto not available", "UNSUPPORTED");
    }
    if (publicKeyCache.has(base64)) {
      return publicKeyCache.get(base64);
    }
    const raw = decodeBase64Url(base64);
    try {
      const key = await cryptoImpl.subtle.importKey(
        "raw",
        raw,
        { name: "Ed25519" },
        false,
        ["verify"]
      );
      publicKeyCache.set(base64, key);
      return key;
    } catch (error) {
      throw new LicenseVerificationError("Failed to import public key", "UNSUPPORTED");
    }
  }

  function validatePayload(payload, nowMs) {
    if (!payload || typeof payload !== "object") {
      throw new LicenseVerificationError("License payload missing", "FORMAT");
    }
    if (payload.iss !== "TodoX") {
      throw new LicenseVerificationError("Unexpected issuer", "FORMAT");
    }
    if (payload.aud && payload.aud !== "client") {
      throw new LicenseVerificationError("Unexpected audience", "FORMAT");
    }
    if (payload.ver !== 1) {
      throw new LicenseVerificationError("Unsupported license version", "UNSUPPORTED");
    }
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
      throw new LicenseVerificationError("Missing timestamps", "FORMAT");
    }
    if (payload.iat > payload.exp) {
      throw new LicenseVerificationError("Invalid timestamp ordering", "FORMAT");
    }
    if (typeof payload.nonce !== "string" || payload.nonce.length < 8) {
      throw new LicenseVerificationError("Nonce missing", "FORMAT");
    }
    if (!Array.isArray(payload.features)) {
      throw new LicenseVerificationError("Features missing", "FORMAT");
    }
    const nowSec = Math.floor(nowMs / 1000);
    if (payload.exp <= nowSec) {
      throw new LicenseVerificationError("License expired", "EXPIRED");
    }
    if (payload.iat > nowSec + 300) {
      throw new LicenseVerificationError("License not yet valid", "FORMAT");
    }
    return payload;
  }

  async function verifyLicenseToken(token, publicKeyBase64, options = {}) {
    const { now = Date.now(), crypto: cryptoImpl = (typeof globalThis !== "undefined" ? globalThis.crypto : undefined) } = options;
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new LicenseVerificationError("License token missing", "FORMAT");
    }
    if (typeof publicKeyBase64 !== "string" || publicKeyBase64.length === 0) {
      throw new LicenseVerificationError("Public key missing", "FORMAT");
    }
    const parts = token.split(".");
    if (parts.length !== 2) {
      throw new LicenseVerificationError("License token structure invalid", "FORMAT");
    }
    const [payloadPart, signaturePart] = parts;
    const payloadBytes = decodeBase64Url(payloadPart);
    if (!textDecoder) {
      throw new LicenseVerificationError("TextDecoder unavailable", "UNSUPPORTED");
    }
    let payload;
    try {
      payload = JSON.parse(textDecoder.decode(payloadBytes));
    } catch (error) {
      throw new LicenseVerificationError("License payload is not valid JSON", "FORMAT");
    }
    const signature = decodeBase64Url(signaturePart);
    const subtle = cryptoImpl?.subtle;
    if (!subtle) {
      throw new LicenseVerificationError("WebCrypto not available", "UNSUPPORTED");
    }
    const key = await importPublicKey(publicKeyBase64, cryptoImpl);
    let verified = false;
    try {
      verified = await subtle.verify({ name: "Ed25519" }, key, signature, payloadBytes);
    } catch (error) {
      throw new LicenseVerificationError("Signature verification failed", "SIGNATURE");
    }
    if (!verified) {
      throw new LicenseVerificationError("Signature mismatch", "SIGNATURE");
    }
    validatePayload(payload, now);
    return { payload };
  }

  return {
    verifyLicenseToken,
    decodeBase64Url,
    encodeBase64Url,
    LicenseVerificationError,
  };
});
