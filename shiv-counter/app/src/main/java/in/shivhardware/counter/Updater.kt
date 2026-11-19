package `in`.shivhardware.counter

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Keeps the app itself up to date. (The Counter's screens never need this:
 * they come from the website on every open.)
 *
 * A new APK is published as a release of the public repo
 * StarkAg/shiv-counter-releases, tagged `counter-v<versionCode>`
 * (`npm run release:counter-android`). On open, at most once an hour, the app
 * asks GitHub for the latest release; if it is newer it offers Update now /
 * Later. Update downloads the APK, checks it is this app and newer, and hands
 * it to Android's installer, which asks for one Install tap: Android never lets
 * an app from outside the Play Store replace itself silently. The first time,
 * Android also asks once to let Shiv Counter install apps.
 */
class Updater(private val activity: Activity) {

    private val prefs = activity.getSharedPreferences("updater", Context.MODE_PRIVATE)
    private var busy = false
    /** An update waiting on the "allow installing apps" setting, picked up on return. */
    private var waitingApk: File? = null

    /** Called from onResume. */
    fun check(force: Boolean = false) {
        waitingApk?.let { apk ->
            if (canInstall()) { waitingApk = null; install(apk) }
            return
        }
        if (busy) return
        val now = System.currentTimeMillis()
        if (!force && now - prefs.getLong("lastCheck", 0) < CHECK_EVERY_MS) return
        if (now < prefs.getLong("snoozeUntil", 0)) return
        prefs.edit().putLong("lastCheck", now).apply()
        busy = true
        thread(name = "update-check") {
            val latest = try { latestRelease() } catch (e: Exception) { null }
            activity.runOnUiThread {
                busy = false
                if (latest != null && latest.code > BuildConfig.VERSION_CODE && !activity.isFinishing) offer(latest)
            }
        }
    }

    private data class Release(val code: Int, val name: String, val apkUrl: String, val notes: String)

    private fun latestRelease(): Release? {
        val conn = URL(LATEST_API).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        conn.setRequestProperty("User-Agent", "ShivCounterApp/${BuildConfig.VERSION_NAME}")
        try {
            if (conn.responseCode != 200) return null
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val code = Regex("^counter-v(\\d+)$").find(json.optString("tag_name"))?.groupValues?.get(1)?.toIntOrNull() ?: return null
            val assets = json.optJSONArray("assets") ?: return null
            var url: String? = null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                if (a.optString("name").endsWith(".apk", ignoreCase = true)) { url = a.optString("browser_download_url"); break }
            }
            return Release(code, json.optString("name").ifBlank { "version $code" }, url ?: return null, json.optString("body").trim())
        } finally {
            conn.disconnect()
        }
    }

    private fun offer(release: Release) {
        val message = buildString {
            append("A new Shiv Counter is ready: ${release.name}.")
            if (release.notes.isNotBlank()) append("\n\n${release.notes.take(400)}")
            append("\n\nFinish what is on the screen first: the app restarts to update.")
        }
        AlertDialog.Builder(activity)
            .setTitle("Update ready")
            .setMessage(message)
            .setCancelable(false)
            .setPositiveButton("Update now") { _, _ -> download(release) }
            .setNegativeButton("Later") { _, _ ->
                prefs.edit().putLong("snoozeUntil", System.currentTimeMillis() + SNOOZE_MS).apply()
            }
            .show()
    }

    private fun download(release: Release) {
        val progress = AlertDialog.Builder(activity)
            .setTitle("Downloading the update")
            .setMessage("0%")
            .setCancelable(false)
            .show()
        busy = true
        thread(name = "update-download") {
            val apk = File(File(activity.cacheDir, "update").apply { deleteRecursively(); mkdirs() }, "Shiv_Counter.apk")
            val error: String? = try {
                fetch(release.apkUrl, apk) { percent -> activity.runOnUiThread { progress.setMessage("$percent%") } }
                verify(apk, release.code)
            } catch (e: Exception) {
                "The download stopped (${e.message ?: "no internet"})."
            }
            activity.runOnUiThread {
                busy = false
                progress.dismiss()
                if (error != null) {
                    AlertDialog.Builder(activity)
                        .setTitle("Update not done")
                        .setMessage("$error\n\nThe app keeps working as it is. It will offer the update again later.")
                        .setPositiveButton("OK", null)
                        .show()
                } else if (canInstall()) {
                    install(apk)
                } else {
                    askToAllowInstalls(apk)
                }
            }
        }
    }

    /** Follows GitHub's redirect to its file store; both are https. */
    private fun fetch(url: String, into: File, onPercent: (Int) -> Unit) {
        var conn = URL(url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("User-Agent", "ShivCounterApp/${BuildConfig.VERSION_NAME}")
        try {
            if (conn.responseCode != 200) throw IllegalStateException("server said ${conn.responseCode}")
            val total = conn.contentLengthLong
            var done = 0L
            var shown = -1
            conn.inputStream.use { input ->
                into.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        done += n
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != shown) { shown = pct; onPercent(pct) }
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    /** Only ever installs this same app, and only a newer one. Android also checks the signing key. */
    private fun verify(apk: File, expected: Int): String? {
        @Suppress("DEPRECATION")
        val info = activity.packageManager.getPackageArchiveInfo(apk.path, 0)
            ?: return "The downloaded file is not a whole app."
        if (info.packageName != activity.packageName) return "The downloaded file is a different app."
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
        if (code <= BuildConfig.VERSION_CODE) return "The downloaded file is not newer than this app."
        if (code != expected) return "The downloaded file is not the version that was offered."
        return null
    }

    private fun canInstall() = activity.packageManager.canRequestPackageInstalls()

    private fun askToAllowInstalls(apk: File) {
        waitingApk = apk
        AlertDialog.Builder(activity)
            .setTitle("Allow updates")
            .setMessage("Android asks once to let Shiv Counter install its own updates.\n\nOn the next screen switch on \"Allow from this source\", then press Back.")
            .setCancelable(false)
            .setPositiveButton("Open setting") { _, _ ->
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                try { activity.startActivity(intent) } catch (e: Exception) { waitingApk = null }
            }
            .setNegativeButton("Later") { _, _ -> waitingApk = null }
            .show()
    }

    private fun install(apk: File) {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { activity.startActivity(intent) } catch (e: Exception) { }
    }

    companion object {
        private const val LATEST_API = "https://api.github.com/repos/StarkAg/shiv-counter-releases/releases/latest"
        private const val CHECK_EVERY_MS = 60 * 60 * 1000L
        private const val SNOOZE_MS = 3 * 60 * 60 * 1000L
    }
}
