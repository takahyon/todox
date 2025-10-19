# TodoX License Signer

A tiny CLI for generating Ed25519 key pairs, signing TodoX+ license payloads, and verifying signed tokens. The tool never writes private keys unless you explicitly pass an output path. Keep the private key outside of version control and distribute only the public key.

## Installation

```bash
pnpm install
# or
yarn install
# or
npm install
```

## Commands

### Generate a key pair

```bash
npx todox-license generate --out-private ../secrets/license_ed25519.key --out-public ../secrets/license_public.key
```

Pass `--force` to overwrite existing files.

### Sign a license token

```bash
npx todox-license sign \
  --key ../secrets/license_ed25519.key \
  --subject user@example.com \
  --features themes,focus_bgm,local_analytics \
  --valid-days 365 \
  --output license.token
```

The command prints the compact token and the JSON payload (for auditing). Tokens are composed of `<base64url(payload)>.<base64url(signature)>` and can be distributed as unlock codes.

### Verify a token

```bash
npx todox-license verify "<token>" --public-key-file ../secrets/license_public.key
```

Verification checks the Ed25519 signature and reports if the license is expired or not yet valid.

## Environment Integration

- `LICENSE_PRIVATE_KEY_PATH` should point to the private key file (never commit it).
- `LICENSE_PUBLIC_KEY_BASE64` must be exposed to the client bundle for verification.
- `SPONSORS_URL` controls where the extension fetches sponsor inventory (can be a CDN or the bundled `sponsors.json`).
- `LICENSE_REDEEM_URL` (optional) enables server-side redemption; the client POSTs codes and expects `{ "licenseToken": "..." }`.

## Security Notes

- Keep the private key offline or in a secure secret manager.
- Rotate keys periodically and update the embedded public key in the extension.
- Feature flags are encoded in the payload; do not trust them without signature verification.
