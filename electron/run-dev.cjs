const { spawn } = require('node:child_process')
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// `node electron/run-dev.cjs counter` opens the Shiv Quotation app instead of the panel.
if (process.argv[2]) env.SHIV_ENTRY = process.argv[2]

const child = spawn(electron, ['.'], {
  env,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
