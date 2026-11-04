/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as aluCosting from "../aluCosting.js";
import type * as anchor from "../anchor.js";
import type * as attendance from "../attendance.js";
import type * as backups from "../backups.js";
import type * as billFlow from "../billFlow.js";
import type * as billLedger from "../billLedger.js";
import type * as billLocks from "../billLocks.js";
import type * as billWhatsApp from "../billWhatsApp.js";
import type * as bills from "../bills.js";
import type * as cash from "../cash.js";
import type * as catalog from "../catalog.js";
import type * as chain from "../chain.js";
import type * as clearPile from "../clearPile.js";
import type * as contactBackups from "../contactBackups.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as dayBookMarks from "../dayBookMarks.js";
import type * as deviceKeys from "../deviceKeys.js";
import type * as devices from "../devices.js";
import type * as documents from "../documents.js";
import type * as files from "../files.js";
import type * as filing from "../filing.js";
import type * as guaranteeClaims from "../guaranteeClaims.js";
import type * as history from "../history.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as integrity from "../integrity.js";
import type * as inventory from "../inventory.js";
import type * as itemCosts from "../itemCosts.js";
import type * as itemFold from "../itemFold.js";
import type * as itemSame from "../itemSame.js";
import type * as jobs from "../jobs.js";
import type * as ledgerViews from "../ledgerViews.js";
import type * as lib_attachmentFiles from "../lib/attachmentFiles.js";
import type * as lib_billFlow from "../lib/billFlow.js";
import type * as lib_billFlowStages from "../lib/billFlowStages.js";
import type * as lib_billRows from "../lib/billRows.js";
import type * as lib_billText from "../lib/billText.js";
import type * as lib_cashPage from "../lib/cashPage.js";
import type * as lib_contactRead from "../lib/contactRead.js";
import type * as lib_entries from "../lib/entries.js";
import type * as lib_guarded from "../lib/guarded.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_integrity from "../lib/integrity.js";
import type * as lib_inventoryPin from "../lib/inventoryPin.js";
import type * as lib_inventorySeed from "../lib/inventorySeed.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_ots from "../lib/ots.js";
import type * as lib_parties from "../lib/parties.js";
import type * as lib_pin from "../lib/pin.js";
import type * as lib_receipts from "../lib/receipts.js";
import type * as lib_rename from "../lib/rename.js";
import type * as lib_seal from "../lib/seal.js";
import type * as lib_spelling from "../lib/spelling.js";
import type * as lib_staffPay from "../lib/staffPay.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_trashLinks from "../lib/trashLinks.js";
import type * as lib_workPieces from "../lib/workPieces.js";
import type * as masters from "../masters.js";
import type * as merge from "../merge.js";
import type * as mica from "../mica.js";
import type * as migrateLedger from "../migrateLedger.js";
import type * as money from "../money.js";
import type * as monthly from "../monthly.js";
import type * as photoSwap from "../photoSwap.js";
import type * as photos from "../photos.js";
import type * as prices from "../prices.js";
import type * as printJobs from "../printJobs.js";
import type * as receipts from "../receipts.js";
import type * as reports from "../reports.js";
import type * as review from "../review.js";
import type * as seed from "../seed.js";
import type * as shopWhatsApp from "../shopWhatsApp.js";
import type * as staffPay from "../staffPay.js";
import type * as tags from "../tags.js";
import type * as tidy from "../tidy.js";
import type * as toto from "../toto.js";
import type * as trash from "../trash.js";
import type * as twilio from "../twilio.js";
import type * as voucherInbox from "../voucherInbox.js";
import type * as vouchers from "../vouchers.js";
import type * as whatsapp from "../whatsapp.js";
import type * as workOrders from "../workOrders.js";
import type * as workshop from "../workshop.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ai: typeof ai;
  aluCosting: typeof aluCosting;
  anchor: typeof anchor;
  attendance: typeof attendance;
  backups: typeof backups;
  billFlow: typeof billFlow;
  billLedger: typeof billLedger;
  billLocks: typeof billLocks;
  billWhatsApp: typeof billWhatsApp;
  bills: typeof bills;
  cash: typeof cash;
  catalog: typeof catalog;
  chain: typeof chain;
  clearPile: typeof clearPile;
  contactBackups: typeof contactBackups;
  crons: typeof crons;
  customers: typeof customers;
  dayBookMarks: typeof dayBookMarks;
  deviceKeys: typeof deviceKeys;
  devices: typeof devices;
  documents: typeof documents;
  files: typeof files;
  filing: typeof filing;
  guaranteeClaims: typeof guaranteeClaims;
  history: typeof history;
  http: typeof http;
  inbox: typeof inbox;
  integrity: typeof integrity;
  inventory: typeof inventory;
  itemCosts: typeof itemCosts;
  itemFold: typeof itemFold;
  itemSame: typeof itemSame;
  jobs: typeof jobs;
  ledgerViews: typeof ledgerViews;
  "lib/attachmentFiles": typeof lib_attachmentFiles;
  "lib/billFlow": typeof lib_billFlow;
  "lib/billFlowStages": typeof lib_billFlowStages;
  "lib/billRows": typeof lib_billRows;
  "lib/billText": typeof lib_billText;
  "lib/cashPage": typeof lib_cashPage;
  "lib/contactRead": typeof lib_contactRead;
  "lib/entries": typeof lib_entries;
  "lib/guarded": typeof lib_guarded;
  "lib/history": typeof lib_history;
  "lib/integrity": typeof lib_integrity;
  "lib/inventoryPin": typeof lib_inventoryPin;
  "lib/inventorySeed": typeof lib_inventorySeed;
  "lib/money": typeof lib_money;
  "lib/numbering": typeof lib_numbering;
  "lib/ots": typeof lib_ots;
  "lib/parties": typeof lib_parties;
  "lib/pin": typeof lib_pin;
  "lib/receipts": typeof lib_receipts;
  "lib/rename": typeof lib_rename;
  "lib/seal": typeof lib_seal;
  "lib/spelling": typeof lib_spelling;
  "lib/staffPay": typeof lib_staffPay;
  "lib/text": typeof lib_text;
  "lib/trashLinks": typeof lib_trashLinks;
  "lib/workPieces": typeof lib_workPieces;
  masters: typeof masters;
  merge: typeof merge;
  mica: typeof mica;
  migrateLedger: typeof migrateLedger;
  money: typeof money;
  monthly: typeof monthly;
  photoSwap: typeof photoSwap;
  photos: typeof photos;
  prices: typeof prices;
  printJobs: typeof printJobs;
  receipts: typeof receipts;
  reports: typeof reports;
  review: typeof review;
  seed: typeof seed;
  shopWhatsApp: typeof shopWhatsApp;
  staffPay: typeof staffPay;
  tags: typeof tags;
  tidy: typeof tidy;
  toto: typeof toto;
  trash: typeof trash;
  twilio: typeof twilio;
  voucherInbox: typeof voucherInbox;
  vouchers: typeof vouchers;
  whatsapp: typeof whatsapp;
  workOrders: typeof workOrders;
  workshop: typeof workshop;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
