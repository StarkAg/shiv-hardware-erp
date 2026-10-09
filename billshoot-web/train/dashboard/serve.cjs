// The training page, for watching from this PC or a phone on the shop Wi-Fi.
// Serves only itself, the progress numbers and the preview picture.
const http = require('http'), fs = require('fs'), path = require('path')
const M = process.argv[2] || path.join(__dirname, "../work/model"), PAGE = path.join(__dirname, "train.html")
const files = { '/': [PAGE, 'text/html'], '/progress.json': [path.join(M, 'progress.json'), 'application/json'], '/preview.jpg': [path.join(M, 'preview.jpg'), 'image/jpeg'] }
http.createServer((req, res) => {
  const f = files[req.url.split('?')[0]]
  if (!f) { res.writeHead(404); return res.end() }
  fs.readFile(f[0], (e, b) => { if (e) { res.writeHead(404); return res.end() } res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-store' }); res.end(b) })
}).listen(5198, '0.0.0.0', () => console.log('training page on 5198'))
