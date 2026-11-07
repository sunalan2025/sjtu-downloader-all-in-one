package me.hisunalan.sjtudownloader;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AssignmentStatusTest {
    private static JSONObject status(String submission,long due) throws Exception {
        JSONObject out=new JSONObject();
        AssignmentStatus.decorate(out,new JSONObject().put("submission",new JSONObject(submission)).put("points_possible",100),due,1000,true);return out;
    }
    @Test public void desktopPrecedenceCoversLateSubmissionsReviewAttemptsAndMissingFlags() throws Exception {
        for(String submission:new String[]{"{workflow_state:submitted,missing:true}","{workflow_state:pending_review}","{workflow_state:unsubmitted,attempt:1}","{submitted_at:'2026-11-03T01:00:00Z'}"})
            assertEquals("submitted",status(submission,100).getString("submissionStatus"));
        assertEquals("graded",status("{workflow_state:graded,missing:true}",100).getString("submissionStatus"));
        assertEquals("missing",status("{missing:true}",2000).getString("submissionStatus"));
        assertEquals("missing",status("{}",100).getString("submissionStatus"));
        assertEquals("unsubmitted",status("{}",2000).getString("submissionStatus"));
    }
    @Test public void zeroScoreNullScoreAndLetterGradeRemainDifferent() throws Exception {
        assertEquals("已评分 0/100 分",AssignmentStatus.label(status("{workflow_state:graded,score:0}",100),100,1000));
        assertEquals("已批改 A",AssignmentStatus.label(status("{workflow_state:graded,score:null,grade:A}",100),100,1000));
        assertEquals("已提交 · 待批改",AssignmentStatus.label(status("{workflow_state:submitted}",100),100,1000));
    }
    @Test public void nestedAndRootSubmissionsAndDueFallbackMatchDesktop() throws Exception {
        JSONObject out=new JSONObject(),raw=new JSONObject("{assignment:{due_at:null,lock_at:'2026-11-04T23:59:00+08:00',points_possible:20,submission:{workflow_state:graded,score:15}}}");
        AssignmentStatus.decorate(out,raw,2000,1000,false);
        assertEquals("已评分 15/20 分",AssignmentStatus.label(out,2000,1000));
        assertEquals("2026-11-04T23:59:00+08:00",AssignmentStatus.due(raw));
        raw.put("due_at","2026-11-05T12:00:00+08:00");assertEquals("2026-11-05T12:00:00+08:00",AssignmentStatus.due(raw));
        assertEquals(SchoolAgendaClient.millis("2026-11-05T23:59:59+08:00"),AssignmentStatus.deadlineMillis("2026-11-05"));
        raw.put("submission",new JSONObject("{workflow_state:submitted}"));AssignmentStatus.decorate(out,raw,2000,1001,false);
        assertEquals("submitted",out.getString("submissionStatus"));
    }
    @Test public void incompleteOrStaleResponsesCannotEraseKnownGradesButNewRegradingCan() throws Exception {
        JSONObject known=status("{workflow_state:graded,score:0}",100);
        JSONObject partial=new JSONObject();AssignmentStatus.decorate(partial,new JSONObject(),100,2000,false);
        assertFalse(partial.has("submissionKnown"));
        assertEquals(0,AssignmentStatus.merge(known,partial).getInt("score"));
        JSONObject stale=status("{workflow_state:submitted}",100).put("statusUpdatedAt",900);
        assertEquals("graded",AssignmentStatus.merge(known,stale).getString("submissionStatus"));
        JSONObject regrade=status("{workflow_state:pending_review,score:null}",100).put("statusUpdatedAt",1100);
        assertEquals("submitted",AssignmentStatus.merge(known,regrade).getString("submissionStatus"));assertTrue(regrade.isNull("score"));
    }
    @Test public void foregroundAndBackgroundKeepGradesThroughWidgetPersistence() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String previous=TodayScheduleWidget.preferences(context).getString("events","[]");
        try{
            long start=System.currentTimeMillis()+60_000;
            JSONObject event=new JSONObject().put("id","assignment:123").put("title","作业").put("type","assignment").put("courseName","物理").put("startTime",TodayScheduleWidget.format(start,"yyyy-MM-dd'T'HH:mm:ssXXX")).put("endTime",TodayScheduleWidget.format(start,"yyyy-MM-dd'T'HH:mm:ssXXX"));
            AssignmentStatus.copy(status("{workflow_state:graded,score:0}",100),event);
            JSONObject cached=SchoolAgendaClient.cacheItem(event);
            AgendaBackgroundSync.foreground(context,new JSONArray().put(cached),true,false);
            assertTrue(AssignmentStatus.label(TodayScheduleWidget.load(context).get(0).metadata,start,start).contains("0/100"));
            JSONObject partial=new JSONObject(cached.toString());for(String key:AssignmentStatus.FIELDS)partial.remove(key);
            AgendaBackgroundSync.foreground(context,new JSONArray().put(partial),false,false);
            assertEquals("graded",AgendaBackgroundSync.cached(context).getJSONObject(0).getString("submissionStatus"));
            SchoolAgendaClient.Result response=new SchoolAgendaClient.Result();response.canvas=true;response.items.put(partial);
            AgendaBackgroundSync.run(context,()->response);
            assertEquals(0,AgendaBackgroundSync.cached(context).getJSONObject(0).getInt("score"));
        }finally{TodayScheduleWidget.preferences(context).edit().putString("events",previous).commit();}
    }
    @Test public void backgroundUpdatesGradesAfterDeadlineAndKeepsExamNamedHomeworkUnique() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String previous=TodayScheduleWidget.preferences(context).getString("events","[]");
        try{
            long start=System.currentTimeMillis()-3*TodayScheduleWidget.DAY;
            JSONObject past=new JSONObject().put("id","assignment:old").put("source","school").put("title","考试练习")
                .put("startMs",start).put("endMs",start).put("category","exam").put("assignment",true).put("kind","deadline").put("courseName","课程甲");
            TodayScheduleWidget.persist(context,new JSONArray().put(past),true);
            JSONObject graded=new JSONObject(past.toString()).put("category","homework");
            AssignmentStatus.copy(status("{workflow_state:graded,score:88}",100),graded);
            JSONObject other=new JSONObject(graded.toString()).put("courseName","课程乙");
            assertNotEquals(AgendaBackgroundSync.fingerprint(graded),AgendaBackgroundSync.fingerprint(other));
            assertEquals(AgendaBackgroundSync.fingerprint(past),AgendaBackgroundSync.fingerprint(graded));
            SchoolAgendaClient.Result result=new SchoolAgendaClient.Result();result.canvas=true;result.items.put(graded);
            AgendaBackgroundSync.run(context,()->result);
            JSONArray saved=AgendaBackgroundSync.cached(context);assertEquals(1,saved.length());
            assertEquals(88,saved.getJSONObject(0).getInt("score"));
        }finally{TodayScheduleWidget.preferences(context).edit().putString("events",previous).commit();}
    }
    @Test public void examSuffixIsIdempotentAndDoesNotRenameHomework(){
        TodayScheduleWidget.Item exam=new TodayScheduleWidget.Item(1,2,"期中测验","",true,"exam",false,"物理");
        assertEquals("物理考试",SchedulePresentation.title(exam));
        TodayScheduleWidget.Item named=new TodayScheduleWidget.Item(1,2,"物理考试","",true,"exam",false,"物理考试");assertEquals("物理考试",SchedulePresentation.title(named));
        TodayScheduleWidget.Item homework=new TodayScheduleWidget.Item(1,2,"考试练习","",true,"exam",false,"物理",true);assertEquals("考试练习",SchedulePresentation.title(homework));
    }
    @Test public void minuteReceiverCanBeSharedAndReleasedWithoutLeakingRegistration(){
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        WidgetClock.acquire(context);WidgetClock.acquire(context);WidgetClock.release(context);WidgetClock.release(context);
        WidgetClock.acquire(context);WidgetClock.release(context);
    }
}
