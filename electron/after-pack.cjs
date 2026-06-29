// Embeds the app icon into the packaged Windows .exe.
//
// We keep electron-builder's `signAndEditExecutable: false` because enabling it
// forces extraction of the winCodeSign bundle, which needs symlink privileges
// Windows denies without admin / Developer Mode. So instead we run the standalone
// `rcedit` tool here (after the app is packed, before NSIS wraps it) to stamp the
// icon onto Shiv Hardware Panel.exe — giving the shortcut/taskbar/file the "S".
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const { rcedit } = require('rcedit')
  const productName = context.packager.appInfo.productFilename // "Shiv Hardware Panel"
  const exePath = path.join(context.appOutDir, `${productName}.exe`)
  const iconPath = path.resolve(context.packager.info.projectDir, 'build', 'icon.ico')

  await rcedit(exePath, { icon: iconPath })
  console.log(`  • afterPack: embedded icon into ${productName}.exe`)
}
