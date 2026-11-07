package me.hisunalan.sjtudownloader;

import org.json.JSONObject;

/** Same precedence as the desktop Canvas calendar. A missing partial response
 * never clears a known submission or turns a recorded zero into no score. */
final class AssignmentStatus {
    static final String[] FIELDS={"submissionStatus","score","pointsPossible","grade","submissionKnown","statusUpdatedAt"};
    static String text(JSONObject row,String key){return row==null||row.isNull(key)?"":row.optString(key,"").trim();}
    static String due(JSONObject row){
        JSONObject nested=row.optJSONObject("assignment");
        String[] dates={text(row,"due_at"),text(nested,"due_at"),text(row,"end_at"),text(row,"start_at"),text(row,"lock_at"),text(nested,"lock_at")};
        for(String date:dates)if(!date.isEmpty())return date;
        return "";
    }
    static long deadlineMillis(String value){
        long time=SchoolAgendaClient.millis(value);
        return time>0&&value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")?time+TodayScheduleWidget.DAY-1000:time;
    }
    static void decorate(JSONObject target,JSONObject row,long due,long now,boolean authoritative){
        JSONObject nested=row.optJSONObject("assignment");
        JSONObject data=nested==null?row:nested;
        JSONObject sub=row.optJSONObject("submission");
        if(sub==null)sub=data.optJSONObject("submission");
        if(sub==null&&!authoritative)return;
        if(sub==null)sub=new JSONObject();
        String state=text(sub,"workflow_state");
        boolean submitted="submitted".equals(state)||"graded".equals(state)||"pending_review".equals(state)
            ||!text(sub,"submitted_at").isEmpty()||sub.opt("attempt") instanceof Number&&((Number)sub.opt("attempt")).doubleValue()>0;
        String status="graded".equals(state)?"graded":submitted?"submitted":
            Boolean.TRUE.equals(sub.opt("missing"))||due>0&&due<now?"missing":"unsubmitted";
        try{
            target.put("submissionKnown",true);target.put("submissionStatus",status);target.put("statusUpdatedAt",now);
            target.put("score",sub.has("score")?sub.get("score"):JSONObject.NULL);
            target.put("grade",text(sub,"grade"));
            JSONObject points=row.has("points_possible")&&!row.isNull("points_possible")?row:data;
            target.put("pointsPossible",points.has("points_possible")?points.get("points_possible"):JSONObject.NULL);
        }catch(Exception ignored){}
    }
    static void copy(JSONObject source,JSONObject target){
        for(String key:FIELDS)try{if(source.has(key))target.put(key,source.get(key));}catch(Exception ignored){}
    }
    static JSONObject merge(JSONObject previous,JSONObject incoming){
        if(previous!=null&&previous.optBoolean("submissionKnown")&&
            (!incoming.optBoolean("submissionKnown")||previous.optLong("statusUpdatedAt")>incoming.optLong("statusUpdatedAt")))copy(previous,incoming);
        return incoming;
    }
    static String label(JSONObject item,long due,long now){
        if(item==null||!item.optBoolean("submissionKnown"))return "";
        String status=item.optString("submissionStatus");
        if("graded".equals(status)){
            if(item.has("score")&&!item.isNull("score")){
                String score=number(item.optDouble("score")),points=item.has("pointsPossible")&&!item.isNull("pointsPossible")&&item.optDouble("pointsPossible")>0
                    ?"/"+number(item.optDouble("pointsPossible")):"";
                return "已评分 "+score+points+" 分";
            }
            String grade=text(item,"grade");return "已批改"+(grade.isEmpty()?"":" "+grade);
        }
        if("submitted".equals(status))return "已提交 · 待批改";
        if("missing".equals(status)||due>0&&due<now)return "已逾期 · 未提交";
        return "待提交";
    }
    private static String number(double value){return value==(long)value?Long.toString((long)value):Double.toString(value);}
}
