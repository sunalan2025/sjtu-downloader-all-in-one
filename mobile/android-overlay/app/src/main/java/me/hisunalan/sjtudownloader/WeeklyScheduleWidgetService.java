package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

/** A single tall ListView item contains all seven day columns. */
public final class WeeklyScheduleWidgetService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent){
        return new Factory(AppAppearance.widgetContext(getApplicationContext(),intent),intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID,0));
    }

    private static final class Factory implements RemoteViewsFactory {
        private final Context context;
        private WeeklyScheduleWidget.WeekGrid grid;
        private final int widgetId;
        Factory(Context context,int widgetId){this.context=context;this.widgetId=widgetId;}
        @Override public void onCreate(){WidgetClock.acquire(context);onDataSetChanged();}
        @Override public void onDataSetChanged(){
            grid=WeeklyScheduleWidget.weekGrid(
                TodayScheduleWidget.load(context),System.currentTimeMillis());
        }
        @Override public void onDestroy(){grid=null;WidgetClock.release(context);}
        @Override public int getCount(){return 1;}
        @Override public RemoteViews getViewAt(int index){
            if(index!=0)return null;
            long now=System.currentTimeMillis();
            if(grid==null||grid.start!=WeeklyScheduleWidget.displayStart(now))onDataSetChanged();
            return WeeklyScheduleWidget.gridView(context,grid,now,WeeklyScheduleWidget.width(context,widgetId));
        }
        @Override public RemoteViews getLoadingView(){return null;}
        @Override public int getViewTypeCount(){return 1;}
        @Override public long getItemId(int index){return 0;}
        @Override public boolean hasStableIds(){return true;}
    }
}
