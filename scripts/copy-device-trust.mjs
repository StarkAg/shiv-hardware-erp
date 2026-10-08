#!/usr/bin/env node
/**
 * Copies the trusted-device PIN screen (src/lib/deviceTrust) into each small
 * app. They are separate projects with their own React, so they cannot import
 * it from here; they carry a copy. Run after changing the source.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APPS = ['cash-web', 'order-web', 'sort-web', 'voucher-web', 'mica-web', 'stock-web', 'inventory-web', 'attendance-web']
  .map((app) => [app, path.join(root, app, 'src', 'deviceTrust')])
// Shiv Rates, in the ShivLedger repo beside this one, reads the panel's bills.
const rates = path.join(root, '..', 'ShivLedger', 'rates')
if (existsSync(rates)) APPS.push(['ShivLedger/rates', path.join(rates, 'deviceTrust')])
for (const [app, to] of APPS) {
  mkdirSync(to, { recursive: true })
  for (const file of ['deviceTrust.js', 'PinGate.jsx']) {
    cpSync(path.join(root, 'src/lib/deviceTrust', file), path.join(to, file))
  }
  console.log(`copied into ${path.relative(root, to)}`)
}
