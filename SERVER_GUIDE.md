# Shiv Panel Server Guide

Last updated: 2026-06-05

## Main Panel

Open the Network URL shown by the panel server terminal. It will look like this:

```text
http://<shop-computer-ip>:5180/
```

This is the main Shiv Hardware Panel UI for quotations, guarantee cards, rates, scanning, and printing.

Start it with:

```bash
npm run dev -- --host 0.0.0.0
```

Keep this server running while using the panel from another device on the same Wi-Fi.

The panel automatically talks to the print server on the same computer IP using port `3333`.

Example: if the panel is opened at `http://192.168.29.174:5180/`, scan and print requests go to `http://192.168.29.174:3333`.

In the Android/offline app, the panel may not have a shop-computer IP in the URL. In that case it:

1. tries the last working print server URL saved on the phone,
2. tries `localhost:3333`,
3. scans common Wi-Fi ranges such as `192.168.29.x`, `192.168.1.x`, `192.168.0.x`, and `10.0.0.x` for `/status`,
4. saves the working print server URL for next time.

## Servers Needed For Normal Shop Use

### 1. Main panel server

Required for the app UI.

```bash
npm run dev -- --host 0.0.0.0
```

Phone link:

```text
http://<shop-computer-ip>:5180/
```

### 2. Print server

Required for actual printing, bill scanning, server-side PNG rendering, and printer status.

```bash
npm run print:server
```

Normal print server base URL:

```text
http://<shop-computer-ip>:3333
```

Status check:

```text
http://<shop-computer-ip>:3333/status
```

Important: the print server is an API service. It does not have a normal page at `/`. The panel sends print requests to `/print`, scan requests to `/scan-bill`, and render requests to `/render-png`.

## Optional Servers For Cloud / Outside Wi-Fi Work

These are not required for normal same-Wi-Fi shop use if the main panel and print server are running locally.

### Cloud API

Needed when testing the Railway/Convex cloud print flow locally.

```bash
npm run cloud:api
```

Production cloud API:

```text
https://cloud-api-production-4953.up.railway.app
```

### Convex dev server

Needed when developing or testing Convex locally.

```bash
npm run convex:dev
```

Production Convex is already hosted and does not need a local server for normal shop use.

## Quick Checklist

For normal shop use on Wi-Fi, keep these two running:

```text
Main panel:   http://<shop-computer-ip>:5180/
Print server: http://<shop-computer-ip>:3333/status
```

If the computer IP changes, open the new panel Network URL shown by the dev server terminal. The panel will automatically use that same IP for the print server.
