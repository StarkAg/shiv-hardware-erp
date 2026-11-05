package `in`.shivhardware.intro

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.launch

/**
 * Stays connected to the shop's Convex and saves what arrives.
 *
 * The list of waiting contacts is the whole message: Convex sends it again by
 * itself whenever it changes and whenever the connection comes back, so a contact
 * typed while this phone was off simply arrives when it is on. A contact leaves
 * the list only after this phone has answered for it.
 */
class IntroService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var started = false
    /** Answered already, so a list that still names them is not worked again. */
    private val answered = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private fun isActiveScope() = scope.coroutineContext[kotlinx.coroutines.Job]?.isActive == true

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        running = true
        val token = Shop.token(this)
        if (token == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!started) {
            started = true
            val client = Shop.client(token)
            scope.launch {
                client.loginFromCache()
                launch { checkIn(client) }
                // A listener that ends for any reason is started again.
                while (true) {
                    try {
                        listen(client)
                    } catch (err: Exception) {
                        if (err is kotlinx.coroutines.CancellationException && !isActiveScope()) throw err
                        logError("listener ended", err)
                    }
                    status.value = "Not connected. Trying again."
                    delay(10_000)
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun listen(client: dev.convex.android.ConvexClientWithAuth<String>) {
        // Only the newest list matters: one that arrived while a contact was being
        // saved may still name it.
        client.subscribe<List<Waiting>>("shivIntro:waiting").conflate().collect { result ->
            result.onSuccess { list ->
                status.value = "Connected. Waiting for contacts."
                list.filter { it.id !in answered }.forEach { save(client, it) }
            }.onFailure {
                logError("listening", it)
                status.value = "Not connected. It will try again by itself."
            }
        }
    }

    private suspend fun save(client: dev.convex.android.ConvexClientWithAuth<String>, row: Waiting) {
        val args: Map<String, Any?> = try {
            when (val saved = PhoneBook.save(this, row.name, row.phone)) {
                PhoneBook.Result.Saved -> {
                    status.value = "Saved ${row.name}"
                    mapOf("id" to row.id, "result" to "saved")
                }
                is PhoneBook.Result.Already -> mapOf("id" to row.id, "result" to "already", "savedAs" to saved.name)
            }
        } catch (err: Exception) {
            logError("saving ${row.id}", err)
            mapOf("id" to row.id, "result" to "failed", "error" to (err.message ?: "Could not save on the phone"))
        }
        // The contact is safe on the phone by now. If this answer is lost, the row
        // comes round again and the phone finds the number already there.
        repeat(3) { attempt ->
            try {
                client.mutation("shivIntro:report", args)
                answered.add(row.id)
                return
            } catch (err: Exception) {
                logError("answering ${row.id}", err)
                delay(2_000L * (attempt + 1))
            }
        }
    }

    /** Tells the page this phone is alive. */
    private suspend fun checkIn(client: dev.convex.android.ConvexClientWithAuth<String>) {
        while (true) {
            try {
                client.mutation("shivIntro:seen")
            } catch (err: Exception) {
                logError("checking in", err)
            }
            delay(15 * 60_000L)
        }
    }

    private fun goForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Shiv_Intro running", NotificationManager.IMPORTANCE_MIN),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val note: Notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_intro)
            .setContentTitle("Shiv_Intro")
            .setContentText("Saving new customers to this phone")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1, note)
        }
    }

    companion object {
        private const val CHANNEL = "running"
        val status = MutableStateFlow("Starting")
        @Volatile var running = false

        fun start(context: Context) {
            if (Shop.token(context) == null) return
            context.startForegroundService(Intent(context, IntroService::class.java))
        }
    }
}
