package me.hisunalan.sjtudownloader;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONObject;

/** Persisted periodic job. Notification permission is deliberately not a dependency. */
public final class AgendaSyncService extends JobService {
    static final int JOB = 7350;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Future<?> running;
    static boolean scheduled(Context context) {
        JobScheduler jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (jobs == null) return false;
        for (JobInfo job : jobs.getAllPendingJobs()) if (job.getId() == JOB) return true;
        return false;
    }
    static void configure(Context context) {
        JobScheduler jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (jobs == null) return;
        JSONObject settings = AgendaPreferences.read(context);
        if (!settings.optBoolean("backgroundEnabled")) { jobs.cancel(JOB); return; }
        long period = settings.optInt("syncMinutes", 60) * 60_000L;
        JobInfo.Builder builder = new JobInfo.Builder(JOB, new ComponentName(context, AgendaSyncService.class))
            .setPeriodic(Math.max(15 * 60_000L, period))
            .setRequiredNetworkType(settings.optBoolean("unmeteredOnly") ? JobInfo.NETWORK_TYPE_UNMETERED : JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true).setBackoffCriteria(15 * 60_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL);
        if (Build.VERSION.SDK_INT >= 26) builder.setRequiresBatteryNotLow(settings.optBoolean("batteryNotLow", true));
        try {
            if (jobs.schedule(builder.build()) != JobScheduler.RESULT_SUCCESS)
                AgendaPreferences.store(context).edit().putString("syncState", "rejected").apply();
        } catch (RuntimeException denied) {
            AgendaPreferences.store(context).edit().putString("syncState", "rejected").apply();
        }
    }
    @Override public boolean onStartJob(JobParameters parameters) {
        if (!AgendaPreferences.read(this).optBoolean("backgroundEnabled")) return false;
        running = executor.submit(() -> {
            AgendaBackgroundSync.run(this, () -> new SchoolAgendaClient(this).fetch());
            new android.os.Handler(getMainLooper()).post(() -> jobFinished(parameters, false));
        });
        return true;
    }
    @Override public boolean onStopJob(JobParameters parameters) {
        if (running != null) running.cancel(true);
        AgendaPreferences.store(this).edit().putString("syncState",
            AgendaPreferences.read(this).optBoolean("backgroundEnabled") ? "deferred" : "idle").apply();
        return AgendaPreferences.read(this).optBoolean("backgroundEnabled");
    }
    @Override public void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
}
