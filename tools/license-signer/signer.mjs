#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import nacl from 'tweetnacl';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64(source) {
  return Buffer.from(String(source).trim(), 'base64');
}

function fromBase64Url(source) {
  const normalized = String(source).trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(pad), 'base64');
}

async function ensureWritable(filePath, force = false) {
  try {
    await fs.access(filePath);
    if (!force) {
      throw new Error(`Refusing to overwrite existing file: ${filePath}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (!force) {
        throw error;
      }
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeFileIfNeeded(filePath, contents, force = false) {
  await ensureWritable(filePath, force);
  await fs.writeFile(filePath, contents, { encoding: 'utf8' });
}

function parseFeatures(input) {
  if (!input) {
    return ['themes', 'focus_bgm', 'local_analytics'];
  }
  if (Array.isArray(input)) {
    return input.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
  }
  return String(input)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function loadPrivateKey(keyPath) {
  const raw = await fs.readFile(keyPath, 'utf8');
  const buffer = fromBase64(raw);
  if (buffer.length === nacl.sign.secretKeyLength) {
    return new Uint8Array(buffer);
  }
  if (buffer.length === nacl.sign.seedLength) {
    return nacl.sign.keyPair.fromSeed(new Uint8Array(buffer)).secretKey;
  }
  throw new Error(`Unexpected private key length (${buffer.length}). Expected ${nacl.sign.secretKeyLength} bytes secret key or ${nacl.sign.seedLength} byte seed.`);
}

async function loadPublicKeyFromInput({ publicKey, publicKeyFile }) {
  if (publicKey) {
    return new Uint8Array(fromBase64(publicKey));
  }
  if (publicKeyFile) {
    const raw = await fs.readFile(publicKeyFile, 'utf8');
    return new Uint8Array(fromBase64(raw));
  }
  throw new Error('Public key is required');
}

function randomNonce() {
  return toBase64Url(randomBytes(24));
}

const cli = yargs(hideBin(process.argv))
  .scriptName('todox-license')
  .command(
    'generate',
    'Generate a new Ed25519 keypair for TodoX+',
    (yargs) =>
      yargs
        .option('out-private', {
          type: 'string',
          describe: 'Path to write the base64 encoded private key',
        })
        .option('out-public', {
          type: 'string',
          describe: 'Path to write the base64 encoded public key',
        })
        .option('force', {
          type: 'boolean',
          default: false,
          describe: 'Overwrite existing files',
        }),
    async (argv) => {
      const pair = nacl.sign.keyPair();
      const privateKeyB64 = toBase64(pair.secretKey);
      const publicKeyB64 = toBase64(pair.publicKey);
      if (argv.outPrivate) {
        await writeFileIfNeeded(argv.outPrivate, privateKeyB64, argv.force);
        console.log(`✔︎ Private key written to ${argv.outPrivate}`);
      } else {
        console.log('# Private key (base64)');
        console.log(privateKeyB64);
      }
      if (argv.outPublic) {
        await writeFileIfNeeded(argv.outPublic, publicKeyB64, argv.force);
        console.log(`✔︎ Public key written to ${argv.outPublic}`);
      } else {
        console.log('# Public key (base64)');
        console.log(publicKeyB64);
      }
    }
  )
  .command(
    'sign',
    'Sign a TodoX+ license payload',
    (yargs) =>
      yargs
        .option('key', {
          type: 'string',
          demandOption: true,
          describe: 'Path to the base64 encoded Ed25519 private key',
        })
        .option('features', {
          type: 'string',
          describe: 'Comma separated feature list (default: themes,focus_bgm,local_analytics)',
        })
        .option('subject', {
          type: 'string',
          describe: 'Optional license subject (email or purchaser id)',
        })
        .option('valid-days', {
          type: 'number',
          default: 365,
          describe: 'License validity period in days (ignored when --expires is set)',
        })
        .option('expires', {
          type: 'string',
          describe: 'ISO8601 expiration timestamp (overrides --valid-days)',
        })
        .option('nonce', {
          type: 'string',
          describe: 'Custom nonce (auto-generated when omitted)',
        })
        .option('output', {
          type: 'string',
          describe: 'Write the signed license token to a file',
        })
        .option('force', {
          type: 'boolean',
          default: false,
          describe: 'Allow overwriting the output file',
        }),
    async (argv) => {
      const secretKey = await loadPrivateKey(argv.key);
      const now = nowSeconds();
      let exp = now + Math.max(1, Number(argv.validDays || 0)) * 24 * 60 * 60;
      if (argv.expires) {
        const parsed = Date.parse(argv.expires);
        if (Number.isNaN(parsed)) {
          throw new Error('Unable to parse --expires value. Use ISO8601 format.');
        }
        exp = Math.floor(parsed / 1000);
      }
      const payload = {
        iss: 'TodoX',
        aud: 'client',
        ver: 1,
        iat: now,
        exp,
        nonce: argv.nonce || randomNonce(),
        features: parseFeatures(argv.features),
      };
      if (argv.subject) {
        payload.sub = argv.subject;
      }
      const payloadJson = JSON.stringify(payload);
      const payloadBytes = Buffer.from(payloadJson, 'utf8');
      const signature = nacl.sign.detached(new Uint8Array(payloadBytes), secretKey);
      const token = `${toBase64Url(payloadBytes)}.${toBase64Url(signature)}`;
      if (argv.output) {
        await writeFileIfNeeded(argv.output, token, argv.force);
        console.log(`✔︎ License token written to ${argv.output}`);
      } else {
        console.log(token);
      }
      console.log('\n# Payload');
      console.log(JSON.stringify(payload, null, 2));
    }
  )
  .command(
    'verify <token>',
    'Verify a signed TodoX+ license token',
    (yargs) =>
      yargs
        .positional('token', {
          type: 'string',
          describe: 'License token to verify',
        })
        .option('public-key', {
          type: 'string',
          describe: 'Base64 encoded public key',
        })
        .option('public-key-file', {
          type: 'string',
          describe: 'Path to file containing the base64 encoded public key',
        }),
    async (argv) => {
      const [payloadPart, signaturePart] = String(argv.token).split('.');
      if (!payloadPart || !signaturePart) {
        throw new Error('Token must be in <payload>.<signature> format');
      }
      const payloadBytes = fromBase64Url(payloadPart);
      let payload;
      try {
        payload = JSON.parse(Buffer.from(payloadBytes).toString('utf8'));
      } catch (error) {
        throw new Error('Payload is not valid JSON');
      }
      const signature = fromBase64Url(signaturePart);
      const publicKey = await loadPublicKeyFromInput(argv);
      const valid = nacl.sign.detached.verify(new Uint8Array(payloadBytes), new Uint8Array(signature), publicKey);
      if (!valid) {
        console.error('✖ Signature verification failed');
        process.exitCode = 1;
        return;
      }
      const now = nowSeconds();
      const expired = typeof payload.exp === 'number' && payload.exp <= now;
      const notYetValid = typeof payload.iat === 'number' && payload.iat > now + 300;
      console.log('✔︎ Signature valid');
      console.log(JSON.stringify(payload, null, 2));
      if (expired) {
        console.warn('⚠︎ License is expired');
      } else if (notYetValid) {
        console.warn('⚠︎ License is not yet valid');
      }
    }
  )
  .demandCommand()
  .strict()
  .help();

cli.parse();
