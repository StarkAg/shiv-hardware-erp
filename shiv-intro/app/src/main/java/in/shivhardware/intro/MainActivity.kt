package `in`.shivhardware.intro

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Shiv_Intro on the Samsung. Set up once (the shop PIN, contacts and notifications,
 * no battery limit, Never auto sleeping), and from then on opening the app opens
 * the Shiv Intro page itself (intro-web/): type a new customer, Save or Send. The
 * listener (IntroService) keeps running behind it, so Save lands in this phone's
 * contacts within seconds. A thin line at the top says whether it is connected.
 *
 * The setup screens are in the Signs look: white, black print, blue for what to do.
 */
class MainActivity : Activity() {

    private val scope = CoroutineScope(Job() + Dispatchers.Main)
    private lateinit var page: LinearLayout
    private var web: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        setContentView(page)
    }

    override fun onResume() {
        super.onResume()
        // Once the page is open it stays as it is: coming back to the app keeps
        // what was typed.
        if (web != null) web?.onResume() else show()
    }

    override fun onPause() {
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        scope.cancel()
        web?.destroy()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        show()
    }

    @Deprecated("Back on every Android this app supports")
    override fun onBackPressed() {
        val view = web
        if (view != null && view.canGoBack()) view.goBack()
        // At the first page Back puts the app away instead of closing it.
        else if (view != null) moveTaskToBack(true)
        else super.onBackPressed()
    }

    private fun show() {
        page.removeAllViews()
        page.setPadding(48, 96, 48, 48)
        page.addView(text("Shiv_Intro", 34f, bold = true))
        val token = Shop.token(this)
        when {
            token == null -> showPin()
            missing().isNotEmpty() -> {
                page.addView(text("Allow contacts and notifications, so new customers can be saved."))
                page.addView(button("Allow") { requestPermissions(missing().toTypedArray(), 1) })
            }
            !batteryFree() -> {
                page.addView(text("Let it run all the time, or Samsung may stop it."))
                page.addView(button("Allow") {
                    startActivity(
                        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
                    )
                })
            }
            !Shop.sleepStepDone(this) -> {
                page.addView(
                    text("One last step: Settings > Battery > Background usage limits > Never auto sleeping apps, and add Shiv_Intro."),
                )
                page.addView(button("Open Settings") {
                    startActivity(Intent(Settings.ACTION_SETTINGS))
                })
                page.addView(button("Done") {
                    Shop.markSleepStepDone(this)
                    show()
                })
            }
            else -> openPage()
        }
    }

    private fun showPin() {
        page.addView(text("Enter the shop PIN once to connect this phone."))
        val box = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            textSize = 22f
        }
        page.addView(box)
        val said = text("")
        lateinit var connect: Button
        connect = button("Connect") {
            connect.isEnabled = false
            said.text = "Connecting..."
            scope.launch {
                val error = try {
                    kotlinx.coroutines.withContext(Dispatchers.IO) { Shop.pair(this@MainActivity, box.text.toString().trim()) }
                } catch (err: Exception) {
                    logError("pairing", err)
                    "No connection. Check the internet and try again."
                }
                if (error == null) show() else {
                    said.text = error
                    connect.isEnabled = true
                }
            }
        }
        page.addView(connect)
        page.addView(said)
    }

    /** Everything is set up: start the listener and open the Shiv Intro page. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun openPage() {
        IntroService.start(this)
        WakeReceiver.schedule(this)

        page.removeAllViews()
        page.setPadding(0, 0, 0, 0)

        val line = TextView(this).apply {
            textSize = 13f
            setTextColor(Color.parseColor("#0E1318"))
            setBackgroundColor(Color.parseColor("#F1F3F5"))
            setPadding(32, 12, 32, 12)
            text = phoneLine(IntroService.status.value)
        }
        page.addView(line)
        scope.launch { IntroService.status.collect { line.text = phoneLine(it) } }

        val view = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            // The page sets its own sizes; the phone's font setting would push the
            // sign lettering out of its boxes.
            settings.textZoom = 100
            settings.userAgentString = "${settings.userAgentString} ShivIntroApp/${BuildConfig.VERSION_NAME}"
            webViewClient = PageClient()
        }
        page.addView(view, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        web = view

        val handOver = Shop.pageToken(this)
        if (handOver != null) {
            // The page keeps its token under 'shiv-device-token' (intro-web/src/deviceTrust).
            // A tiny page loaded as if from the site writes it there, then goes on to the
            // page itself, so the PIN typed in this app is the only one ever asked for.
            val html = "<!doctype html><script>try{localStorage.setItem('shiv-device-token'," +
                JSONObject.quote(handOver) + ")}catch(e){}location.replace(" + JSONObject.quote(Shop.PAGE) + ")</script>"
            view.loadDataWithBaseURL(Shop.PAGE, html, "text/html", "utf-8", null)
            Shop.pageTokenHandedOver(this)
        } else {
            view.loadUrl(Shop.PAGE)
        }
    }

    private fun phoneLine(status: String) = "Saving to this phone: $status"

    /** Opens a link in the app made for it: WhatsApp, the dialer, the browser. */
    private fun openOutside(uri: Uri) {
        val intent = if (uri.scheme == "intent") {
            try { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) } catch (e: Exception) { return }
        } else Intent(Intent.ACTION_VIEW, uri)
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        try { startActivity(intent) } catch (e: ActivityNotFoundException) { /* nothing on the phone opens it */ }
    }

    private inner class PageClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if ((uri.scheme == "https" && uri.host == Shop.PAGE_HOST) || uri.scheme == "about" || uri.scheme == "data") return false
            openOutside(uri)
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            // No signal: a plain page with one button, instead of Android's error.
            view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null)
        }
    }

    private fun missing(): List<String> = buildList {
        add(Manifest.permission.READ_CONTACTS)
        add(Manifest.permission.WRITE_CONTACTS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
    }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    private fun batteryFree() =
        getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    private fun text(words: String, size: Float = 19f, bold: Boolean = false) = TextView(this).apply {
        text = words
        textSize = size
        setTextColor(Color.parseColor("#0E1318"))
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, 16, 0, 16)
    }

    private fun button(words: String, onPress: () -> Unit) = Button(this).apply {
        text = words
        textSize = 19f
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.parseColor("#0054B4"))
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = 16 }
        setOnClickListener { onPress() }
        textAlignment = View.TEXT_ALIGNMENT_CENTER
    }

    private companion object {
        val OFFLINE_PAGE = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;background:#fff;color:#0E1318;margin:0;padding:48px 24px}
            h1{font-size:26px;margin:0 0 12px}p{font-size:18px;margin:0 0 28px}
            a{display:block;background:#0054B4;color:#fff;text-align:center;padding:18px;font-size:20px;
            font-weight:bold;text-decoration:none;border-radius:6px}</style></head>
            <body><h1>No internet</h1><p>Shiv Intro needs the internet. Check Wi-Fi or mobile data.</p>
            <a href="${Shop.PAGE}">Try again</a></body></html>
        """.trimIndent()
    }
}
