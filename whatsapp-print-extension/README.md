# Shiv WhatsApp Print

Chrome extension: open a photo in WhatsApp Web and press **Print B/W** or **Print Colour** — it prints straight on
the shop printers through the print server (`POST /whatsapp-print/jobs` with `mode` bw | color, the same routing as the
"Shiv Hardware" group's bw / cp commands). No print window.

Install: chrome://extensions → Developer mode → Load unpacked → this folder.
Server address (default http://localhost:3333): the extension's Options.
