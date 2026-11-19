package `in`.shivhardware.order

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The shop's Convex, over its plain HTTP API (no Convex library in the app).
 *
 * The phone is trusted once with the shop PIN (devices:trust) and keeps the
 * token it gets back; the PIN itself is not kept. Removing the phone on the
 * panel's Trusted devices page ends the token, and the app asks for the PIN
 * again. Nothing secret is built into the app file.
 *
 * The sends go through convex/shopWhatsApp.ts to the Shop WhatsApp on Railway
 * (whatsapp-reminders), addressed to 'group': the service's SHOP_GROUP_ID.
 */
object Shop {
    private const val URL = "https://sensible-panther-176.convex.cloud"
    private const val APP = "shiv-order"
    private const val PREFS = "shop"
    private const val TOKEN = "token"

    /** The phone is no longer trusted: ask for the PIN again. */
    class Untrusted(message: String) : Exception(message)

    fun token(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TOKEN, null)

    fun forget(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(TOKEN).apply()
    }

    /** Trades the shop PIN for this phone's token. Null when trusted, else what went wrong. */
    fun pair(context: Context, pin: String): String? {
        val answer = action(null, "devices:trust", JSONObject()
            .put("pin", pin)
            .put("name", "Shiv Order (${Build.MANUFACTURER} ${Build.MODEL})")
            .put("app", APP)) as? JSONObject ?: return "The shop's server gave no answer."
        val token = answer.optString("token")
        if (!answer.optBoolean("ok") || token.isBlank()) return answer.optString("error").ifBlank { "That PIN was not accepted." }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(TOKEN, token).apply()
        return null
    }

    /** What the AI read off a bill: the party, and lines {kind: door|other, ...}. */
    class Bill(val party: String, val lines: List<JSONObject>)

    /** A bill photo (JPEG, base64) to ai:readDoorOrder on the shop's Convex; the AI key stays there. */
    fun readBill(token: String, jpeg: String): Bill {
        val answer = action(token, "ai:readDoorOrder", JSONObject().put("jpeg", jpeg)) as? JSONObject
            ?: throw Exception("The shop's server gave no answer.")
        if (!answer.optBoolean("ok")) throw Exception(answer.optString("error").ifBlank { "The reader failed." })
        val arr = answer.optJSONArray("lines") ?: org.json.JSONArray()
        return Bill(answer.optString("party"), List(arr.length()) { arr.getJSONObject(it) })
    }

    fun sendText(token: String, text: String) {
        action(token, "shopWhatsApp:sendText", JSONObject().put("mobile", "group").put("text", text))
    }

    fun sendFile(token: String, fileName: String, mimetype: String, base64: String, caption: String?) {
        val args = JSONObject().put("mobile", "group").put("fileName", fileName).put("mimetype", mimetype).put("data", base64)
        if (!caption.isNullOrBlank()) args.put("caption", caption)
        action(token, "shopWhatsApp:sendDocument", args)
    }

    /** POST /api/action. Throws with Convex's own words when it refuses. */
    private fun action(token: String?, path: String, args: JSONObject): Any? {
        val conn = URL("$URL/api/action").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 15_000
        conn.readTimeout = 90_000
        conn.setRequestProperty("Content-Type", "application/json")
        if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
        try {
            conn.outputStream.use { it.write(JSONObject().put("path", path).put("args", args).put("format", "json").toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { throw Exception("The shop's server answered HTTP $code.") }
            if (json.optString("status") == "success") return json.opt("value")
            val data = json.optJSONObject("errorData")
            val message = data?.optString("message")?.ifBlank { null }
                ?: (json.opt("errorData") as? String)?.ifBlank { null }
                ?: json.optString("errorMessage").ifBlank { "The shop's server answered HTTP $code." }
            if (data?.optString("code") == "untrusted") throw Untrusted(message)
            throw Exception(message.removePrefix("Uncaught ConvexError: "))
        } finally {
            conn.disconnect()
        }
    }
}
