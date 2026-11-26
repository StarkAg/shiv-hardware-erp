/**
 * The Railway project "shiv-hardware" (production), as Railway IaC.
 *
 * Replaces the per-folder railway.json files (Config as Code), which Railway
 * stops reading on 2026-12-01. Written by hand on 25 Nov 2026 from each
 * folder's own railway.json: `railway config migrate` read every service's
 * "railway.json" path from the repo root (the panel's file), but these
 * services are deployed by uploading their own folder (scripts/deploy.mjs),
 * so each one's file is the one in that folder.
 *
 *   railway config plan     what Railway would change (read it first)
 *   railway config apply    make it so
 *
 * Volumes are copied exactly from the live project: a volume left out of this
 * file is one `apply` would delete, and the WhatsApp logins live on them.
 * Variables (the secrets) stay managed in Railway, not here.
 */
import { defineRailway, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const alerts = { usage: { "100": {}, "80": {}, "95": {} } };
  const disk = { alerts, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 };
  const convexBackupsVolume = volume("convex-backups-volume", disk);
  const whatsappBillsVolume = volume("whatsapp-bills-volume", disk);
  const backupsVolume = volume("backups-volume", disk);
  const whatsappRemindersVolume = volume("whatsapp-reminders-volume", disk);
  const whatsappBridgeVolume = volume("whatsapp-bridge-volume", disk);

  // backup-job/: the nightly backups, always running (`serve`).
  const backups = service("backups", {
    build: { builder: "NIXPACKS", buildEnvironment: "V3" },
    start: "node backup.mjs serve",
    deploy: { restartPolicyType: "ALWAYS" },
    replicas: { "europe-west4-drams3a": 1 },
    volumeMounts: { "/data": backupsVolume },
  });

  // team-backup-job/: the Convex team backup, once a night at 21:30 UTC (3 am India).
  const convexBackups = service("convex-backups", {
    build: { builder: "NIXPACKS", buildEnvironment: "V3" },
    start: "node backup.mjs run",
    deploy: { cronSchedule: "30 21 * * *", restartPolicyType: "NEVER" },
    replicas: { "europe-west4-drams3a": 1 },
    volumeMounts: { "/data": convexBackupsVolume },
  });

  // bis-lookup/: asleep when idle, in Asia, near the BIS site.
  const bisLookup = service("bis-lookup", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
      sleepApplication: true,
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });

  // whatsapp-bills/: Tony's number. Never two copies at once (the volume sees to that).
  const whatsappBills = service("whatsapp-bills", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 60,
    deploy: { restartPolicyType: "ALWAYS", drainingSeconds: 60 },
    replicas: { "europe-west4-drams3a": 1 },
    volumeMounts: { "/data": whatsappBillsVolume },
  });

  // whatsapp-reminders/: the Shop number.
  const whatsappReminders = service("whatsapp-reminders", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 60,
    deploy: { restartPolicyType: "ALWAYS", drainingSeconds: 30 },
    replicas: { "europe-west4-drams3a": 1 },
    volumeMounts: { "/data": whatsappRemindersVolume },
  });

  // cloud-api/: the print queue's API.
  const cloudApi = service("cloud-api", {
    build: { builder: "NIXPACKS", buildEnvironment: "V3" },
    start: "node server.mjs",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    replicas: { "europe-west4-drams11a": 1 },
  });

  // The repo root: the panel.
  const shivPanel = service("shiv-panel", {
    build: { builder: "NIXPACKS", buildCommand: "npm run build", buildEnvironment: "V3" },
    start: "npm run start",
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    replicas: { "europe-west4-drams3a": 1 },
  });

  // Never deployed; kept only for its volume (an old WhatsApp login, docs/whatsapp-numbers.md).
  const whatsappBridge = service("whatsapp-bridge", {
    replicas: { "europe-west4-drams3a": 1 },
    volumeMounts: { "/app/store": whatsappBridgeVolume },
  });

  return project("shiv-hardware", {
    variables: { managed: false },
    resources: [
      backups, convexBackups, bisLookup, whatsappBills, whatsappReminders, cloudApi, shivPanel, whatsappBridge,
      convexBackupsVolume, whatsappBillsVolume, backupsVolume, whatsappRemindersVolume, whatsappBridgeVolume,
    ],
  });
});
