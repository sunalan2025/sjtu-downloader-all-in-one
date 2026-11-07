package me.hisunalan.sjtudownloader;
import android.content.Context;
import androidx.core.graphics.ColorUtils;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.HashSet;
import static org.junit.Assert.*;
@RunWith(AndroidJUnit4.class)
public class ScheduleColorsTest {
    private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
    private TodayScheduleWidget.Item item(String name,String kind){return new TodayScheduleWidget.Item(1,2,name,"",false,kind,false,"");}
    @Test public void equalHashesGetIndependentColorsAndStayStable(){
        assertEquals("大学物理",ScheduleColors.key(" 大　学 物理 "));
        assertEquals("大学物理",ScheduleColors.key("大学\uFEFF物理"));
        JSONArray titles=new JSONArray();titles.put("Aa");titles.put("BB");JSObject assigned=ScheduleColors.assign(context(),titles,null);
        assertNotEquals(assigned.optInt("aa"),assigned.optInt("bb"));
        assertEquals(assigned.optInt("aa"),ScheduleColors.assign(context(),titles,null).optInt("aa"));
    }
    @Test public void allPaletteEntriesAreUniqueAndReadableInBothModes(){
        Context c=context();android.content.SharedPreferences p=c.getSharedPreferences("sjtu-material-appearance-v1",0);
        String previousMode=p.getString("mode","system");boolean previousDark=p.getBoolean("dark",false);
        try{
            for(boolean dark:new boolean[]{false,true}){
                p.edit().putString("mode",dark?"dark":"light").putBoolean("dark",dark).commit();
                HashSet<Integer> fills=new HashSet<>();
                for(int i=0;i<64;i++){
                    JSONObject preferred=new JSONObject();preferred.put("palette-"+i,i);
                    // Use the packed palette directly so persistent test data
                    // cannot change which of its 64 entries is exercised.
                    java.io.InputStream stream=c.getAssets().open("public/schedule-palette.json");java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;while((n=stream.read(buffer))>0)bytes.write(buffer,0,n);stream.close();
                    JSONObject color=new JSONArray(bytes.toString("UTF-8")).getJSONObject(i).getJSONObject(dark?"dark":"light");
                    int fill=android.graphics.Color.parseColor(color.getString("fill")),ink=android.graphics.Color.parseColor(color.getString("ink"));
                    assertTrue("duplicate subject fill",fills.add(fill));assertTrue(ColorUtils.calculateContrast(ink,fill)>=4.5);
                    assertTrue("subject card must be pastel in both themes",ColorUtils.calculateLuminance(fill)>=0.6);
                    assertNotEquals(ScheduleColors.paint(c,item("期末","exam"))[0],fill);
                }
            }
        }catch(Exception e){throw new AssertionError(e);}finally{p.edit().putString("mode",previousMode).putBoolean("dark",previousDark).commit();}
    }
    @Test public void newCoursesCannotReassignOlderCourses(){
        JSONArray first=new JSONArray();first.put("稳定配色甲");int index=ScheduleColors.assign(context(),first,null).optInt("稳定配色甲");
        JSONArray next=new JSONArray();next.put("新课程乙");next.put("新课程丙");ScheduleColors.assign(context(),next,null);
        assertEquals(index,ScheduleColors.assign(context(),first,null).optInt("稳定配色甲"));
    }
    @Test public void cachedColorsNoticeReplacedPreferencesWithoutRestart(){
        android.content.SharedPreferences p=context().getSharedPreferences("sjtu-course-colors-v1",0);
        String previous=p.getString("assignments","{}");
        try{
            p.edit().putString("assignments","{\"切换测试\":0}").commit();
            int first=ScheduleColors.paint(context(),item("切换测试","course"))[0];
            p.edit().putString("assignments","{\"切换测试\":1}").commit();
            assertNotEquals(first,ScheduleColors.paint(context(),item("切换测试","course"))[0]);
            assertEquals(1,ScheduleColors.assign(context(),new JSONArray().put("切换测试"),null).optInt("切换测试"));
        }finally{p.edit().putString("assignments",previous).commit();}
    }

}
