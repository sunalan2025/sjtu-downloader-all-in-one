package me.hisunalan.sjtudownloader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Explicit PendingIntent can cold-start this receiver after process reclaim. */
public final class WidgetMinuteReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(intent==null||!WidgetClock.ACTION_MINUTE.equals(intent.getAction()))return;
        final PendingResult pending=goAsync();
        WidgetClock.enqueue(context,false,true,pending::finish);
    }
}
