// Runs inside WhatsApp's own page (not the extension's sandbox) so it can catch the
// file when the viewer's Download button makes it. While armed, the next download
// link WhatsApp "clicks" is not downloaded — its address is handed to content.js,
// which reads the whole PDF from it.
let armed = false
const click = HTMLAnchorElement.prototype.click
HTMLAnchorElement.prototype.click = function () {
  if (armed && this.href.startsWith('blob:')) {
    armed = false
    window.postMessage({ shivBlobUrl: this.href }, '*')
    return
  }
  return click.apply(this, arguments)
}
window.addEventListener('message', (e) => {
  if (e.source !== window) return
  if (e.data?.shivArm === true) armed = true
  if (e.data?.shivArm === false) armed = false
})
