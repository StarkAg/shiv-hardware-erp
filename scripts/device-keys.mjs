#!/usr/bin/env node
/**
 * Makes the key pair device tokens are signed with (convex/deviceKeys.ts) and
 * prints the two commands that put it on a deployment. Run once per
 * deployment; running it again signs out every device, since their tokens were
 * signed with the old key.
 *
 *   node scripts/device-keys.mjs            # prints the commands
 *   node scripts/device-keys.mjs --prod     # the same, with --prod on them
 */
import { generateKeyPairSync } from 'node:crypto'

const prod = process.argv.includes('--prod') ? ' --prod' : ''
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const jwk = publicKey.export({ format: 'jwk' })
const jwks = JSON.stringify({ keys: [{ ...jwk, kid: 'shiv-devices-1', use: 'sig', alg: 'ES256' }] })

const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`
console.log(`npx convex env set${prod} DEVICE_JWT_KEY -- ${q(pem.trim())}`)
console.log(`npx convex env set${prod} DEVICE_JWKS -- ${q(jwks)}`)
