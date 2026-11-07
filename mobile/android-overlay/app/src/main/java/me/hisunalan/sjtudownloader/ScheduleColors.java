package me.hisunalan.sjtudownloader;

import android.content.Context;
import android.graphics.Color;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;

/** Persistent, collision-free subject assignments shared with the app. Exams
 * reserve red; progress never replaces a subject's identifying color. */
final class ScheduleColors {
    private static JSONArray palette;
    private static final java.util.regex.Pattern SPACES=java.util.regex.Pattern.compile("[\\s\\p{Z}\\uFEFF]+");
    private static String assignmentJson;
    private static JSONObject assignmentCache;
    private static synchronized JSONObject assignmentMap(Context context){
        String stored=prefs(context).getString("assignments","{}");
        if(assignmentCache==null||!stored.equals(assignmentJson)){
            try{assignmentCache=new JSONObject(stored);}catch(Exception ignored){assignmentCache=new JSONObject();}
            assignmentJson=stored;
        }
        return assignmentCache;
    }
    private static synchronized int slot(Context context,String title){
        JSONObject map=assignmentMap(context);String name=key(title);
        if(map.has(name))return map.optInt(name);
        return assign(context,new JSONArray().put(title),null).optInt(name);
    }
    static String key(String title){return SPACES.matcher(title).replaceAll("").toLowerCase(Locale.ROOT);}
    private static android.content.SharedPreferences prefs(Context context){
        return context.getSharedPreferences("sjtu-course-colors-v1",Context.MODE_PRIVATE);
    }
    static synchronized JSObject assign(Context context,JSONArray titles,JSONObject preferred){
        JSONObject map=assignmentMap(context);
        HashSet<Integer> used=new HashSet<>();
        java.util.Iterator<String> old=map.keys();while(old.hasNext())used.add(map.optInt(old.next()));
        if(preferred!=null){
            java.util.Iterator<String> keys=preferred.keys();
            while(keys.hasNext()){
                String title=keys.next();int value=preferred.optInt(title,-1);
                if(!map.has(title)&&value>=0&&!used.contains(value))try{map.put(title,value);used.add(value);}catch(Exception ignored){}
            }
        }
        ArrayList<String> sorted=new ArrayList<>();
        for(int i=0;i<titles.length();i++)sorted.add(key(titles.optString(i)));
        Collections.sort(sorted);
        for(String title:sorted)if(!title.isEmpty()&&!map.has(title)){
            int slot=0;while(used.contains(slot))slot++;
            try{map.put(title,slot);used.add(slot);}catch(Exception ignored){}
        }
        String encoded=map.toString();
        if(!encoded.equals(assignmentJson)){
            prefs(context).edit().putString("assignments",encoded).apply();assignmentJson=encoded;
        }
        JSObject result=new JSObject();old=map.keys();while(old.hasNext()){
            String title=old.next();result.put(title,map.optInt(title));
        }
        return result;
    }
    private static synchronized JSONArray palette(Context context){
        if(palette==null)try(java.io.InputStream stream=context.getAssets().open("public/schedule-palette.json")){
            java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;
            while((n=stream.read(buffer))>0)bytes.write(buffer,0,n);
            palette=new JSONArray(bytes.toString("UTF-8"));
        }catch(Exception ignored){palette=new JSONArray();}
        return palette;
    }
    static int[] widgetPaint(Context context,TodayScheduleWidget.Item item,long now){
        if(WeeklyScheduleWidget.stage(item,now)<0)return AppAppearance.isDark(context)
            ?new int[]{0xff44484e,0xffe0e2e5,0xff797f87}:new int[]{0xffe2e5e9,0xff4b515a,0xff9aa2ac};
        return paint(context,item);
    }
    static int[] paint(Context context,TodayScheduleWidget.Item item){
        boolean dark=AppAppearance.isDark(context);
        if("exam".equals(item.category))return new int[]{0xffffc1c4,0xff67272e,0xffc77c84};
        if("homework".equals(item.category))return new int[]{0xfffff5cf,0xff55471f,0xffb3a067};
        if(!"course".equals(item.category))return new int[]{0xffdaebf6,0xff263b4b,0xff89a9bf};
        int slot=slot(context,item.title);
        JSONArray entries=palette(context);
        if(entries.length()>0)try{
            JSONObject color=entries.getJSONObject(slot%entries.length()).getJSONObject(dark?"dark":"light");
            int fill=Color.parseColor(color.getString("fill"));
            if(slot>=entries.length())fill=0xff000000|((fill^((slot/entries.length())*0x010101))&0xffffff);
            return new int[]{fill,Color.parseColor(color.getString("ink")),Color.parseColor(color.getString("edge"))};
        }catch(Exception ignored){}
        return new int[]{0xffb8dfff,0xff263238,0xff619fd0};
    }
}
