package me.hisunalan.sjtudownloader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class AgendaReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        // Alarm delivery is local and bounded; no asynchronous network in a receiver.
        AgendaNotifications.refresh(context, AgendaNotifications.ACTION.equals(action));
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))
            AgendaSyncService.configure(context);
    }
}
