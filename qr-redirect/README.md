# QR short link

The short address printed in guarantee-card QR codes. It only redirects:

    <short-domain>/GC-2026-0016/FMGP4ZXWAM9GC574G8U3
      -> https://www.shivhardware.store/Gaurantee/GC-2026-0016?k=FMGP4ZXWAM9GC574G8U3

A temporary (307) redirect on purpose, so the destination can move and every printed
card follows. Anything else shows a plain page. No code, no database: one rule in
vercel.json. Deploy: `npx vercel deploy --prod --yes` from this folder (Vercel project
`gcvf`). Printed cards depend on this staying up and on the domain being renewed.
