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
import type * as attendance from "../attendance.js";
import type * as billLedger from "../billLedger.js";
import type * as billLocks from "../billLocks.js";
import type * as bills from "../bills.js";
import type * as cash from "../cash.js";
import type * as catalog from "../catalog.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as documents from "../documents.js";
import type * as files from "../files.js";
import type * as history from "../history.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as ledgerViews from "../ledgerViews.js";
import type * as lib_billText from "../lib/billText.js";
import type * as lib_entries from "../lib/entries.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_numbering from "../lib/numbering.js";
import type * as lib_parties from "../lib/parties.js";
import type * as lib_pin from "../lib/pin.js";
import type * as lib_spelling from "../lib/spelling.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_trashLinks from "../lib/trashLinks.js";
import type * as masters from "../masters.js";
import type * as merge from "../merge.js";
import type * as migrateLedger from "../migrateLedger.js";
import type * as photos from "../photos.js";
import type * as printJobs from "../printJobs.js";
import type * as reports from "../reports.js";
import type * as review from "../review.js";
import type * as seed from "../seed.js";
import type * as tags from "../tags.js";
import type * as tidy from "../tidy.js";
import type * as toto from "../toto.js";
import type * as trash from "../trash.js";
import type * as twilio from "../twilio.js";
import type * as vouchers from "../vouchers.js";
import type * as whatsapp from "../whatsapp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ai: typeof ai;
  attendance: typeof attendance;
  billLedger: typeof billLedger;
  billLocks: typeof billLocks;
  bills: typeof bills;
  cash: typeof cash;
  catalog: typeof catalog;
  crons: typeof crons;
  customers: typeof customers;
  documents: typeof documents;
  files: typeof files;
  history: typeof history;
  http: typeof http;
  inbox: typeof inbox;
  ledgerViews: typeof ledgerViews;
  "lib/billText": typeof lib_billText;
  "lib/entries": typeof lib_entries;
  "lib/history": typeof lib_history;
  "lib/money": typeof lib_money;
  "lib/numbering": typeof lib_numbering;
  "lib/parties": typeof lib_parties;
  "lib/pin": typeof lib_pin;
  "lib/spelling": typeof lib_spelling;
  "lib/text": typeof lib_text;
  "lib/trashLinks": typeof lib_trashLinks;
  masters: typeof masters;
  merge: typeof merge;
  migrateLedger: typeof migrateLedger;
  photos: typeof photos;
  printJobs: typeof printJobs;
  reports: typeof reports;
  review: typeof review;
  seed: typeof seed;
  tags: typeof tags;
  tidy: typeof tidy;
  toto: typeof toto;
  trash: typeof trash;
  twilio: typeof twilio;
  vouchers: typeof vouchers;
  whatsapp: typeof whatsapp;
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
