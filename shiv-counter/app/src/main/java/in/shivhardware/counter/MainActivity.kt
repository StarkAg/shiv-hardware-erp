package `in`.shivhardware.counter

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import java.io.File

/**
 * Shiv Counter on an Android phone: a frame round the Counter website, so
 * every deploy of the website reaches the phone at once with no new install.
 *
 * What the frame adds to the website, because a plain web view cannot do it:
 *   - full screen, and the screen stays on while the app is open;
 *   - Back goes back a page;
 *   - the camera and the gallery for photo boxes;
 *   - sharing a quotation picture to WhatsApp (`ShivCounterAndroid.share`);
 *   - printing a page through Android's own print screen (`.print`);
 *   - links to other apps (WhatsApp, the phone, UPI, the guarantee site) open those apps.
 *
 * The website knows it is inside this app by "ShivCounterApp/" in its user agent,
 * and then switches on its touch look (src/lib/posApp.ts).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val updater by lazy { Updater(this) }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        web = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.setSupportMultipleWindows(true)
            settings.javaScriptCanOpenWindowsAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            // The page sets its own sizes for the touch look; the phone's font
            // setting would push the sign lettering out of its boxes.
            settings.textZoom = 100
            settings.userAgentString = "${settings.userAgentString} ShivCounterApp/${BuildConfig.VERSION_NAME}"
            webViewClient = PageClient()
            webChromeClient = ChromeClient()
            addJavascriptInterface(Bridge(), "ShivCounterAndroid")
        }
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        // Full screen, like a counter machine: the bars come back with a swipe from the edge.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, root).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        // With the bars hidden Android no longer shrinks the page for the
        // keyboard, so make room for it here, or it covers the box being typed in.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            view.setPadding(cutout.left, cutout.top, cutout.right, maxOf(keyboard.bottom, cutout.bottom))
            insets
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Coming back from WhatsApp or the camera, hide the bars again.
        if (hasFocus) WindowInsetsControllerCompat(window, window.decorView).hide(WindowInsetsCompat.Type.systemBars())
    }

    @Deprecated("Back on every Android this app supports")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack()
        // At the first page Back puts the app away instead of closing it, so the
        // next open is instant and keeps what was typed.
        else moveTaskToBack(true)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // A newer app on GitHub: offer it (Updater.kt). At most once an hour.
        updater.check()
    }
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

    /** Opens a link in the app made for it: WhatsApp, the dialer, a UPI app, the browser. */
    private fun openOutside(uri: Uri) {
        val intent = if (uri.scheme == "intent") {
            try { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) } catch (e: Exception) { return }
        } else Intent(Intent.ACTION_VIEW, uri)
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        try { startActivity(intent) } catch (e: ActivityNotFoundException) { /* nothing on the phone opens it */ }
    }

    private fun isCounter(uri: Uri) = uri.scheme == "https" && uri.host == HOST

    private inner class PageClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (isCounter(uri) || uri.scheme == "about" || uri.scheme == "data" || uri.scheme == "blob") return false
            openOutside(uri)
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            // No signal: a plain page with one button, instead of Android's error.
            view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null)
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        /**
         * The Counter opens a blank window at the tap and then points it at a
         * link (a bill's photo, another shop app). That link goes outside, or,
         * if it is the Counter itself, into this page.
         */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val popup = WebView(this@MainActivity)
            popup.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (isCounter(uri)) web.loadUrl(uri.toString()) else openOutside(uri)
                    v.post { v.destroy() }
                    return true
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = popup
            resultMsg.sendToTarget()
            return true
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            cameraUri = null

            val wantsImage = params.acceptTypes.any { it.isBlank() || it.startsWith("image") }
            val camera = if (wantsImage) cameraIntent() else null
            val intent = if (params.isCaptureEnabled && camera != null) camera else {
                val pick = params.createIntent().apply {
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                Intent.createChooser(pick, "Photo").apply {
                    if (camera != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
                }
            }
            return try {
                startActivityForResult(intent, PICK_FILE)
                true
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }
    }

    /** The camera, writing its photo into a file of this app's that the page then reads. */
    private fun cameraIntent(): Intent? {
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        if (intent.resolveActivity(packageManager) == null) return null
        val dir = File(cacheDir, "camera").apply { mkdirs() }
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        cameraUri = uri
        return intent.putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    @Deprecated("startActivityForResult is all a plain Activity has")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_FILE) return
        val callback = fileCallback ?: return
        fileCallback = null
        if (resultCode != RESULT_OK) { callback.onReceiveValue(null); return }

        val picked = mutableListOf<Uri>()
        data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) picked += clip.getItemAt(i).uri }
        data?.data?.let { if (it !in picked) picked += it }
        // The camera answers with no data: its photo is in the file it was given.
        if (picked.isEmpty()) cameraUri?.let { uri ->
            val size = contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: 0L
            if (size > 0) picked += uri
        }
        callback.onReceiveValue(if (picked.isEmpty()) null else picked.toTypedArray())
    }

    /** What the website can ask of the phone. Called from the page's own thread, so each hops to the screen's. */
    private inner class Bridge {
        /**
         * Shares files the way the phone shares a photo. `filesJson` is
         * [{name, type, data}] with data in base64, as src/lib/posApp.ts sends it.
         */
        @JavascriptInterface
        fun share(filesJson: String) {
            val files = JSONArray(filesJson)
            val dir = File(cacheDir, "share").apply { deleteRecursively(); mkdirs() }
            val uris = ArrayList<Uri>()
            var type = "*/*"
            for (i in 0 until files.length()) {
                val f = files.getJSONObject(i)
                val name = f.getString("name").replace(Regex("[^A-Za-z0-9._ -]"), "_").ifBlank { "file" }
                val file = File(dir, name)
                file.writeBytes(Base64.decode(f.getString("data"), Base64.DEFAULT))
                uris += FileProvider.getUriForFile(this@MainActivity, "$packageName.files", file)
                type = if (i == 0) f.optString("type", "*/*") else if (type == f.optString("type")) type else "*/*"
            }
            if (uris.isEmpty()) return
            val send = if (uris.size == 1) {
                Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
            } else {
                Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }
            send.type = type
            send.clipData = ClipData.newRawUri(null, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            runOnUiThread {
                try { startActivity(Intent.createChooser(send, null)) } catch (e: ActivityNotFoundException) { }
            }
        }

        /** The page as it prints (its print styles), through Android's print screen. */
        @JavascriptInterface
        fun print(title: String) {
            runOnUiThread {
                val manager = getSystemService(PRINT_SERVICE) as PrintManager
                val name = title.ifBlank { "Shiv Counter" }
                manager.print(name, web.createPrintDocumentAdapter(name), PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build())
            }
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
    }

    companion object {
        private const val HOST = "shivhardware-counter.vercel.app"
        private const val HOME = "https://$HOST/"
        private const val PICK_FILE = 41

        private val OFFLINE_PAGE = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { margin:0; font-family:sans-serif; background:#fff; color:#0e1318; display:flex; flex-direction:column; justify-content:center; min-height:100vh; padding:0 24px; box-sizing:border-box; }
              h1 { font-size:30px; text-transform:uppercase; margin:0 0 12px; }
              p { font-size:18px; color:#4c5660; margin:0 0 32px; }
              a { display:block; background:#0054b4; color:#fff; text-align:center; font-size:22px; font-weight:700; text-transform:uppercase; padding:20px; text-decoration:none; }
            </style></head><body>
              <h1>No internet</h1>
              <p>Shiv Counter needs the internet. Check the Wi-Fi or mobile data, then try again.</p>
              <a href="$HOME">Try again</a>
            </body></html>
        """.trimIndent()
    }
}
