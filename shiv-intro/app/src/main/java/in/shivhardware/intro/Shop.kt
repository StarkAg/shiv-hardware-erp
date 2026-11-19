package `in`.shivhardware.intro

import android.content.Context
import android.os.Build
import android.util.Log
import dev.convex.android.AuthProvider
import dev.convex.android.ConvexClient
import dev.convex.android.ConvexClientWithAuth

/** The shop's Convex, reached directly from this phone. */
object Shop {
    const val URL = "https://sensible-panther-176.convex.cloud"

    /** The app name that makes this a phone-only device (INTRO_APP in convex/lib/guarded.ts). */
    private const val APP = "shiv-intro"
    private const val PREFS = "shop"
    private const val TOKEN = "token"
    private const val PAGE_TOKEN = "pageToken"
    private const val SLEEP_STEP = "sleepStepDone"

    /** The Shiv Intro page (intro-web/), opened inside this app once it is set up. */
    const val PAGE = "https://shivhardware-intro.vercel.app/"
    const val PAGE_HOST = "shivhardware-intro.vercel.app"

    fun token(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TOKEN, null)

    /**
     * Trades the shop PIN for this device's token, once. The PIN is not kept. Removing
     * the device from the Trusted devices page ends the token, so nothing secret is
     * built into the app file.
     */
    suspend fun pair(context: Context, pin: String): String? {
        val answer = ConvexClient(URL).action<TrustAnswer>(
            "devices:trust",
            mapOf("pin" to pin, "name" to "Samsung (${Build.MODEL})", "app" to APP),
        )
        val token = answer.token
        if (!answer.ok || token == null) return answer.error ?: "That PIN was not accepted."
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(TOKEN, token).apply()
        // The same PIN also connects the Shiv Intro page shown in this app, as its own
        // ordinary device (it needs Save and Send, which the phone token cannot call).
        // Handed to the page once (MainActivity.handOver) and then dropped. If this
        // fails the page simply asks for the PIN itself.
        try {
            val page = ConvexClient(URL).action<TrustAnswer>(
                "devices:trust",
                mapOf("pin" to pin, "name" to "Shiv_Intro app on Samsung (${Build.MODEL}) · Shiv Intro", "app" to "Shiv Intro"),
            )
            if (page.ok && page.token != null) {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PAGE_TOKEN, page.token).apply()
            }
        } catch (err: Exception) {
            logError("pairing the page", err)
        }
        return null
    }

    /** The page's token, waiting to be handed to the page, or null. */
    fun pageToken(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PAGE_TOKEN, null)

    fun pageTokenHandedOver(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PAGE_TOKEN).apply()

    /** Whether the "Never auto sleeping apps" step has been read and ticked off. */
    fun sleepStepDone(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(SLEEP_STEP, false)

    fun markSleepStepDone(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(SLEEP_STEP, true).apply()

    /** A client that sends this device's token with every call. */
    fun client(token: String): ConvexClientWithAuth<String> =
        ConvexClientWithAuth(URL, TokenAuth(token))
}

/** Convex's login step, with nothing to log in to: the token is already held. */
private class TokenAuth(private val token: String) : AuthProvider<String> {
    override suspend fun login(context: Context, onIdToken: (String?) -> Unit): Result<String> = loginFromCache(onIdToken)
    override suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<String> {
        onIdToken(token)
        return Result.success(token)
    }
    override suspend fun logout(context: Context): Result<Void?> = Result.success(null)
    override fun extractIdToken(authResult: String): String = authResult
}

internal fun logError(what: String, err: Throwable) {
    Log.e("ShivIntro", what, err)
}
