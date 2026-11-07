package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;
import java.util.Locale;

/** An opaque, bounded bitmap works on every supported RemoteViews API. A
 * single shared affine time axis preserves arbitrary minutes and midnight. */
final class WeeklyTimeline {
    static final float PX_PER_MINUTE=1.2f,AXIS=36;
    static float position(WeeklyScheduleWidget.WeekGrid grid,float minute){return (minute-grid.firstMinute)*PX_PER_MINUTE+8;}
    static RectF bounds(WeeklyScheduleWidget.WeekGrid grid,WeeklyScheduleWidget.ClassBlock block,int day,float width){
        float dayWidth=(width-AXIS)/7,laneWidth=dayWidth/block.lanes;
        float left=AXIS+day*dayWidth+block.lane*laneWidth+1;
        return new RectF(left,position(grid,block.start),left+laneWidth-2,position(grid,block.end));
    }
    static Bitmap draw(Context context,WeeklyScheduleWidget.WeekGrid grid,long now,int width){
        float height=(grid.lastMinute-grid.firstMinute)*PX_PER_MINUTE+16;
        android.util.DisplayMetrics metrics=context.getResources().getDisplayMetrics();
        // Fit the RemoteViews bitmap budget while drawing at device density
        // whenever the physical screen allows it (legacy Android 7–11 only).
        double budget=(double)metrics.widthPixels*metrics.heightPixels*1.25;
        float scale=Math.min(metrics.density,(float)Math.sqrt(budget/(width*height)));
        Bitmap bitmap=Bitmap.createBitmap(Math.max(1,(int)Math.ceil(width*scale)),Math.max(1,(int)Math.ceil(height*scale)),Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(bitmap);canvas.scale(scale,scale);
        canvas.drawColor(AppAppearance.color(context,"surface"));
        Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);paint.setStrokeWidth(.45f);
        float dayWidth=(width-AXIS)/7;
        long today=TodayScheduleWidget.midnight(now,0);
        for(int day=0;day<7;day++){
            float left=AXIS+day*dayWidth;
            if(grid.dates[day]==today){
                paint.setColor(AppAppearance.color(context,"surfaceContainerLow"));canvas.drawRect(left,0,left+dayWidth,height,paint);
            }
            paint.setColor(AppAppearance.color(context,"outlineVariant"));canvas.drawLine(left,0,left,height,paint);
        }
        for(int minute=grid.firstMinute;minute<=grid.lastMinute;minute+=60){
            float y=position(grid,minute);paint.setColor(AppAppearance.color(context,"outlineVariant"));canvas.drawLine(AXIS,y,width,y,paint);
            paint.setColor(AppAppearance.color(context,"onSurfaceVariant"));paint.setTextSize(8);paint.setTypeface(android.graphics.Typeface.DEFAULT);
            canvas.drawText(String.format(Locale.ROOT,"%02d:%02d",minute/60,minute%60),1,y+3,paint);
        }
        for(int day=0;day<7;day++)for(WeeklyScheduleWidget.ClassBlock block:grid.days[day]){
            RectF rect=bounds(grid,block,day,width);int[] colors=ScheduleColors.widgetPaint(context,block.item,now);
            paint.setStyle(Paint.Style.FILL);paint.setColor(colors[0]);
            float radius=Math.min(5,rect.height()/3);canvas.drawRoundRect(rect,radius,radius,paint);
            if(WeeklyScheduleWidget.stage(block.item,now)==0){
                paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.8f);paint.setColor(colors[2]);canvas.drawRoundRect(rect,radius,radius,paint);paint.setStyle(Paint.Style.FILL);
            }
            // Text clips to the true duration. A short appointment remains a
            // short bar rather than stealing 45 minutes from the time axis.
            if(rect.height()<12||rect.width()<10)continue;
            int save=canvas.save();canvas.clipRect(rect);
            TextPaint text=new TextPaint(Paint.ANTI_ALIAS_FLAG|Paint.SUBPIXEL_TEXT_FLAG|Paint.LINEAR_TEXT_FLAG);text.setColor(colors[1]);
            text.setTextSize(10*Math.min(1.2f,context.getResources().getConfiguration().fontScale));
            text.setTypeface(android.graphics.Typeface.create("sans-serif-medium",0));
            String caption=SchedulePresentation.caption(block.item,now);
            int textWidth=Math.max(1,(int)rect.width()-6),lines=Math.max(1,(int)((rect.height()-6)/(text.getTextSize()*1.16f)));
            StaticLayout layout=StaticLayout.Builder.obtain(caption,0,caption.length(),text,textWidth)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).setLineSpacing(0,1.16f)
                .setMaxLines(lines).setEllipsize(TextUtils.TruncateAt.END).build();
            canvas.translate(rect.left+3,rect.top+3);layout.draw(canvas);canvas.restoreToCount(save);
        }
        float current=(now-today)/60_000f;
        if(current>=grid.firstMinute&&current<=grid.lastMinute){
            float y=position(grid,current);paint.setColor(AppAppearance.isDark(context)?0xffffb4ab:0xffc4434b);paint.setStrokeWidth(1.5f);
            paint.setPathEffect(new android.graphics.DashPathEffect(new float[]{5,3},0));
            canvas.drawLine(AXIS,y,width,y,paint);paint.setPathEffect(null);
            paint.setTextSize(9);paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            canvas.drawText(TodayScheduleWidget.format(now,"HH:mm"),1,y-3,paint);
        }
        return bitmap;
    }
    static String description(WeeklyScheduleWidget.WeekGrid grid){
        StringBuilder text=new StringBuilder(grid.preview?"周末与下周工作日，按实际日期显示。":"本周日程，按实际开始和结束时间显示。");
        for(int day=0;day<7;day++)for(WeeklyScheduleWidget.ClassBlock block:grid.days[day])text.append("\n")
            .append(TodayScheduleWidget.format(block.item.start,"M月d日 HH:mm")).append("至")
            .append(TodayScheduleWidget.format(block.item.end,"HH:mm")).append(" ").append(block.item.title);
        return text.toString();
    }
}
