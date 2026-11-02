package me.hisunalan.sjtudownloader;

import me.hisunalan.sjtudownloader.beta.R;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;

/** Legacy collection adapter for Android 11 and below.
 * Android 12+ uses RemoteCollectionItems directly without this binder.
 * List rows intentionally have no launch intent or click behavior. */
public final class TodayScheduleWidgetService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(),
            intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1));
    }

    private static final class Factory implements RemoteViewsFactory {
        private final Context context;
        private final int id;
        private ArrayList<TodayScheduleWidget.Item> items=new ArrayList<>();

        Factory(Context context,int id) {
            this.context=context;
            this.id=id;
        }
        @Override public void onCreate() { onDataSetChanged(); }
        @Override public void onDataSetChanged() {
            items=TodayScheduleWidget.itemsForDay(context,id);
        }
        @Override public void onDestroy() { items.clear(); }
        @Override public int getCount() { return items.size(); }
        @Override public RemoteViews getViewAt(int position) {
            if(position<0 || position>=items.size()) return null;
            return TodayScheduleWidget.rowView(context,items.get(position));
        }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) {
            if(position<0 || position>=items.size()) return position;
            TodayScheduleWidget.Item item=items.get(position);
            return item.start ^ (long)item.title.hashCode();
        }
        @Override public boolean hasStableIds() { return true; }
    }
}
