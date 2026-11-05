package `in`.shivhardware.intro

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * Starts the listener after a restart or an update, and looks in every 15 minutes
 * in case Samsung's battery rules stopped it. Convex does the catching up: once
 * the listener is back, whatever waited arrives by itself.
 */
class WakeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        schedule(context)
        if (!IntroService.running) {
            try {
                IntroService.start(context)
            } catch (err: Exception) {
                // Android can refuse a start from the background; the next look tries again.
                logError("starting from the alarm", err)
            }
        }
    }

    companion object {
        private const val EVERY = 15 * 60_000L

        fun schedule(context: Context) {
            val alarm = PendingIntent.getBroadcast(
                context, 0, Intent(context, WakeReceiver::class.java).setAction(LOOK), PendingIntent.FLAG_IMMUTABLE,
            )
            context.getSystemService(AlarmManager::class.java)
                .setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + EVERY, alarm)
        }

        private const val LOOK = "in.shivhardware.intro.LOOK"
    }
}
