package `in`.shivhardware.intro

import android.Manifest
import android.app.Activity
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
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * One screen, used once: enter the shop PIN and allow what the phone asks. After
 * that the app runs by itself and this only shows that it is running. Written in
 * the Signs look: white, black print, blue for what to do next.
 */
class MainActivity : Activity() {

    private val scope = CoroutineScope(Job() + Dispatchers.Main)
    private lateinit var page: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(48, 96, 48, 48)
        }
        setContentView(page)
    }

    override fun onResume() {
        super.onResume()
        show()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        show()
    }

    private fun show() {
        page.removeAllViews()
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
            else -> showRunning()
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

    private fun showRunning() {
        IntroService.start(this)
        WakeReceiver.schedule(this)
        page.addView(text("Running. New customers saved at the counter appear in this phone's contacts by themselves."))
        val line = text(IntroService.status.value, bold = true)
        page.addView(line)
        scope.launch { IntroService.status.collect { line.text = it } }
        page.addView(
            text("One last step: Settings > Battery > Background usage limits > Never auto sleeping apps, and add Shiv_Intro."),
        )
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
        setOnClickListener { onPress() }
    }
}
