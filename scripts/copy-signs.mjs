#!/usr/bin/env node
/**
 * Copies the Signs look (design/signs: the base stylesheet and its lettering)
 * into each small app that has been brought over to it. They are separate
 * projects, built one folder at a time, so they cannot import it from here;
 * they carry a copy in src/signs/. Run after changing the source, and add an
 * app to the list when it is brought over (DESIGN.md says how).
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APPS = ['workshop-web', 'mechanic-web', 'pay-web', 'voucher-web', 'print-web', 'inventory-web', 'stock-web', 'mica-web']
for (const app of APPS) {
  const to = path.join(root, app, 'src', 'signs')
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(path.join(root, 'design', 'signs'), to, { recursive: true })
  console.log(`copied into ${path.relative(root, to)}`)
}
