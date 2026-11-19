package `in`.shivhardware.introcounter

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Shiv Intro Counter: the Shiv Intro page (intro-web/) for the staff's phones.
 *
 * Unlike Shiv_Intro (shiv-intro/), which runs on the owner's Samsung and writes new
 * customers into its contacts, this app saves nothing on the phone it is on. Staff
 * type the customer and press Save or Send; Save still lands on the owner's Samsung.
 *
 * Staff only: the page is the only thing it opens. The links the PIN screen gives to
 * the shop's other apps (Panel, Cashier, Accounts and the rest) are not followed.
 * Only WhatsApp and phone-call links leave the app. The shop PIN is typed once on
 * each staff phone, in the page; removing the phone from the Trusted devices page
 * shuts it out.
 *
 * A change to the page goes out with `npm run deploy -- --only intro` and reaches
 * the phones at once; only a change in this folder needs a new APK.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            // The page sets its own sizes; the phone's font setting would push the
            // sign lettering out of its boxes.
            settings.textZoom = 100
            settings.userAgentString = "${settings.userAgentString} ShivIntroCounterApp/${BuildConfig.VERSION_NAME}"
            webViewClient = PageClient()
        }
        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Back on every Android this app supports")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack()
        // At the first page Back puts the app away, so the next open keeps what was typed.
        else moveTaskToBack(true)
    }

    override fun onResume() { super.onResume(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

    private inner class PageClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if ((uri.scheme == "https" && uri.host == HOST) || uri.scheme == "about" || uri.scheme == "data") return false
            if (leavesForWhatsAppOrCall(uri)) {
                try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (e: ActivityNotFoundException) { /* not on this phone */ }
            }
            // Anything else (the shop's other apps, other sites) stays shut for staff.
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            // No signal: a plain page with one button, instead of Android's error.
            view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null)
        }
    }

    private fun leavesForWhatsAppOrCall(uri: Uri): Boolean =
        uri.scheme == "tel" || uri.scheme == "whatsapp" ||
            (uri.scheme == "https" && (uri.host == "wa.me" || uri.host == "api.whatsapp.com"))

    private companion object {
        const val HOME = "https://shivhardware-intro.vercel.app/"
        const val HOST = "shivhardware-intro.vercel.app"
        val OFFLINE_PAGE = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;background:#fff;color:#0E1318;margin:0;padding:48px 24px}
            h1{font-size:26px;margin:0 0 12px}p{font-size:18px;margin:0 0 28px}
            a{display:block;background:#0054B4;color:#fff;text-align:center;padding:18px;font-size:20px;
            font-weight:bold;text-decoration:none;border-radius:6px}</style></head>
            <body><h1>No internet</h1><p>Shiv Intro needs the internet. Check Wi-Fi or mobile data.</p>
            <a href="$HOME">Try again</a></body></html>
        """.trimIndent()
    }
}
