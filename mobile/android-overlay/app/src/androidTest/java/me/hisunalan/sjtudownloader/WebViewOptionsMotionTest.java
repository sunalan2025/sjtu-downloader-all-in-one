package me.hisunalan.sjtudownloader;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.SystemClock;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.InputDevice;
import android.view.MotionEvent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Exercises the installed UI in Android's real WebView, with OS animations
 * enabled. No test menus or fixture bridge are included in the application. */
@RunWith(AndroidJUnit4.class)
public class WebViewOptionsMotionTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;
    private String js(String source) throws Exception {
        CountDownLatch done=new CountDownLatch(1);String[] result={null};
        instrumentation.runOnMainSync(()->activity.getBridge().getWebView().evaluateJavascript(source,value->{result[0]=value;done.countDown();}));
        assertTrue("WebView callback timed out",done.await(5,TimeUnit.SECONDS));return result[0];
    }
    private void until(String expression) throws Exception {
        for(int i=0;i<150;i++){
            if("true".equals(js("Boolean("+expression+")")))return;
            Thread.sleep(200);
        }
        fail("WebView content did not appear: "+expression);
    }
    private void openCoursePreferences() throws Exception {
        if(android.os.Build.VERSION.SDK_INT>=33)instrumentation.getUiAutomation().grantRuntimePermission(instrumentation.getTargetContext().getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
        js("window.dispatchEvent(new Event('sjtu-permissions-updated'))");
        until("document.querySelector('.settings-sheet input[role=switch]:not(:disabled)')");
        js("var main=document.querySelector('.settings-sheet input[role=switch]');if(!main.checked)main.click()");
        until("document.querySelector('[data-settings-page=categories]:not(:disabled)')&&!document.querySelector('[data-settings-page=categories]').closest('[inert]')");
        js("document.querySelector('[data-settings-page=categories]').click()");
        until("document.querySelector('[data-settings-page=category-course]:not(:disabled)')");
        js("document.querySelector('[data-settings-page=category-course]').click()");
        until("document.querySelector('.reminder-detail input:not(:disabled)')");
        js("var category=document.querySelector('.reminder-detail input');if(!category.checked)category.click()");
        until("document.querySelector('[aria-label=\"课程提前时间\"]:not(:disabled)')");
        until("document.querySelector('.settings-page-frame').getAnimations().length===0");
    }
    @Test public void installedOptionsAnimateAndNativeBackClosesOnlyTheMenu() throws Exception {
        Intent intent=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=(MainActivity)instrumentation.startActivitySync(intent);
        try{
            until("document.querySelector('button[aria-label=\"下载\"]')");
            js("document.querySelector('button[aria-label=\"下载\"]').click()");
            until("document.querySelector('.settings-entry')");
            js("[...document.querySelectorAll('.settings-entry')].find(b=>b.textContent.includes('通知与后台同步')).click()");
            openCoursePreferences();
            until("document.querySelector('.settings-sheet').getAnimations().length===0");
            js("""
                window.__optionsProof=null;
                var button=document.querySelector('[aria-label="课程提前时间"]');
                button.scrollIntoView({block:'center'});button.focus({preventScroll:true});button.click();
                requestAnimationFrame(function inspect(){
                  var menu=document.querySelector('.select-menu');
                  if(!menu){requestAnimationFrame(inspect);return;}
                  var motion=menu.getAnimations().find(a=>a.id==='select-surface');
                  if(!motion){window.__optionsProof={error:'No menu animation'};return;}
                  motion.pause();motion.currentTime=100;
                  var style=getComputedStyle(menu);
                  window.__optionsProof={opacity:Number(style.opacity),clip:style.clipPath,height:menu.getBoundingClientRect().height,shadow:style.boxShadow};
                  menu.getAnimations({subtree:true}).forEach(a=>a.finish());
                });
                """);
            until("window.__optionsProof");
            JSONObject proof=new JSONObject(new JSONTokener(js("JSON.stringify(window.__optionsProof)")).nextValue().toString());
            assertFalse(proof.toString(),proof.has("error"));
            assertTrue(proof.toString(),proof.getDouble("opacity")>0&&proof.getDouble("opacity")<1);
            assertEquals("none",proof.getString("clip"));
            assertTrue(proof.getDouble("height")>30);
            assertNotEquals("none",proof.getString("shadow"));
            // Invoke Android's actual dispatcher rather than injecting a
            // hardware key whose delivery depends on the emulator's focus.
            instrumentation.runOnMainSync(()->activity.getOnBackPressedDispatcher().onBackPressed());
            until("!document.querySelector('.select-overlay')");
            assertEquals("true",js("Boolean(document.querySelector('.settings-sheet'))"));
            js("""
                window.__foldProof=null;
                var toggle=document.querySelector('.reminder-detail input');
                var body=document.querySelector('.reminder-detail .motion-collapse'), full=body.getBoundingClientRect().height;
                toggle.click();requestAnimationFrame(function inspectFold(){
                  var motion=body.getAnimations().find(a=>a.id==='disclosure-height');
                  // The native preference write acknowledges asynchronously.
                  if(!motion){requestAnimationFrame(inspectFold);return;}
                  motion.pause();motion.currentTime=150;
                  window.__foldProof={height:body.getBoundingClientRect().height,full:full,inert:body.inert};
                  body.getAnimations({subtree:true}).forEach(a=>a.finish());
                });
                """);
            until("window.__foldProof");
            proof=new JSONObject(new JSONTokener(js("JSON.stringify(window.__foldProof)")).nextValue().toString());
            assertFalse(proof.toString(),proof.has("error"));
            assertTrue(proof.toString(),proof.getDouble("height")>0&&proof.getDouble("height")<proof.getDouble("full"));
            assertTrue(proof.getBoolean("inert"));
        }finally{instrumentation.runOnMainSync(()->activity.finish());}
    }
    private JSONObject object(String expression) throws Exception {
        return new JSONObject(new JSONTokener(js("JSON.stringify("+expression+")")).nextValue().toString());
    }
    private float[] screenPoint(double cssX,double cssY,double viewportWidth) {
        float[] point=new float[2];
        instrumentation.runOnMainSync(()->{
            android.webkit.WebView web=activity.getBridge().getWebView();
            int[] position=new int[2];web.getLocationOnScreen(position);
            float scale=(float)(web.getWidth()/viewportWidth);
            point[0]=position[0]+(float)cssX*scale;point[1]=position[1]+(float)cssY*scale;
        });
        return point;
    }
    /** Capture the app's compositor output, excluding activity/system dim layers. */
    private Bitmap appFrame() throws Exception {
        int[] size=new int[2];
        instrumentation.runOnMainSync(()->{android.view.View decor=activity.getWindow().getDecorView();size[0]=decor.getWidth();size[1]=decor.getHeight();});
        Bitmap image=Bitmap.createBitmap(size[0],size[1],Bitmap.Config.ARGB_8888);
        CountDownLatch done=new CountDownLatch(1);int[] status={-1};
        instrumentation.runOnMainSync(()->PixelCopy.request(activity.getWindow(),image,result->{status[0]=result;done.countDown();},new Handler(Looper.getMainLooper())));
        assertTrue("App frame callback timed out",done.await(5,TimeUnit.SECONDS));
        assertEquals("App frame copy failed",PixelCopy.SUCCESS,status[0]);
        return image;
    }
    private void tapControl(String selector,long hold) throws Exception {
        JSONObject point=object("(()=>{const r=document.querySelector("+JSONObject.quote(selector)+").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,vw:innerWidth}})()");
        float[] screen=screenPoint(point.getDouble("x"),point.getDouble("y"),point.getDouble("vw"));
        long down=SystemClock.uptimeMillis();
        MotionEvent press=MotionEvent.obtain(down,down,MotionEvent.ACTION_DOWN,screen[0],screen[1],0);
        press.setSource(InputDevice.SOURCE_TOUCHSCREEN);instrumentation.sendPointerSync(press);press.recycle();
        Thread.sleep(hold);
        MotionEvent release=MotionEvent.obtain(down,SystemClock.uptimeMillis(),MotionEvent.ACTION_UP,screen[0],screen[1],0);
        release.setSource(InputDevice.SOURCE_TOUCHSCREEN);instrumentation.sendPointerSync(release);release.recycle();
    }
    @Test public void navigationStaysPaintedAndSecondRealTapShrinksTheMenu() throws Exception {
        Intent intent=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=(MainActivity)instrumentation.startActivitySync(intent);
        try{
            until("document.querySelector('button[aria-label=\"下载\"]')");
            // MainActivity uses singleTask; a prior test can leave its WebView
            // on Downloads. Establish an actual Home -> Downloads transition.
            js("document.querySelector('[aria-label=\"关闭设置\"]')?.click()");
            until("!document.querySelector('.settings-sheet')");
            js("document.getAnimations().forEach(a=>{try{a.finish()}catch{}});document.querySelector('button[aria-label=\"首页\"]').click()");
            until("document.querySelector('button[aria-label=\"首页\"]').getAttribute('aria-current')==='page'&&document.documentElement.dataset.viewMoving!=='true'");
            until("document.visibilityState==='visible'");
            js("""
                (()=>{
                window.__navProof=null;
                const start=window.__motionTestOriginalVT||document.startViewTransition.bind(document);
                window.__motionTestOriginalVT=start;
                document.startViewTransition=(...args)=>{
                  const transition=start(...args);
                  transition.ready.then(()=>{
                    const animations=document.getAnimations().filter(a=>a.effect?.pseudoElement?.includes('view-transition'));
                    animations.forEach(a=>{a.pause();a.currentTime=120});
                    const dock=document.querySelector('.bottom-dock'),r=dock.getBoundingClientRect();
                    window.__navProof={x:r.x+Math.min(40,r.width/2),y:r.bottom-4,vw:innerWidth,color:getComputedStyle(dock).backgroundColor,frames:animations.length};
                  }).catch(error=>{window.__navProof={error:String(error),engine:document.documentElement.dataset.motionEngine,tab:document.querySelector('.bottom-nav .selected')?.textContent}});
                  return transition;
                };
                document.querySelector('button[aria-label="下载"]').click();
                })();
                """);
            until("window.__navProof");
            JSONObject nav=object("window.__navProof");
            assertFalse(nav.toString(),nav.has("error"));
            assertTrue("No intermediate transition frame",nav.getInt("frames")>0);
            // The transition is paused, so waiting for compositor presentation
            // cannot let an occluded navigation pass by reaching its endpoint.
            boolean painted=false;String pixels="";
            for(int attempt=0;attempt<20&&!painted;attempt++){
                JSONObject live=object("(()=>{const n=document.querySelector('.bottom-dock'),r=n.getBoundingClientRect();return{x:r.x+Math.min(40,r.width/2),y:r.bottom-4,vw:innerWidth,color:getComputedStyle(n).backgroundColor}})()");
                float[] point=screenPoint(live.getDouble("x"),live.getDouble("y"),live.getDouble("vw"));
                int[] origin=new int[2];
                instrumentation.runOnMainSync(()->activity.getWindow().getDecorView().getLocationOnScreen(origin));
                Bitmap image=appFrame();
                int pixel=image.getPixel(Math.round(point[0])-origin[0],Math.round(point[1])-origin[1]);image.recycle();
                String[] color=live.getString("color").replaceAll("[^0-9,]","").split(",");
                painted=Math.abs(Color.red(pixel)-Integer.parseInt(color[0]))<=3&&
                    Math.abs(Color.green(pixel)-Integer.parseInt(color[1]))<=3&&
                    Math.abs(Color.blue(pixel)-Integer.parseInt(color[2]))<=3;
                pixels=live.toString()+" actual="+Integer.toHexString(pixel);
                if(!painted)Thread.sleep(100);
            }
            if(!painted){
                String details=js("JSON.stringify((()=>{const n=document.querySelector('.bottom-dock'),r=n.getBoundingClientRect(),p=selector=>{const s=getComputedStyle(document.documentElement,selector);return{opacity:s.opacity,animation:s.animationName,duration:s.animationDuration,z:s.zIndex,display:s.display}};return{viewport:[innerWidth,innerHeight,devicePixelRatio],nav:getComputedStyle(n).opacity,group:p('::view-transition-group(app-navigation)'),image:p('::view-transition-new(app-navigation)'),pair:p('::view-transition-image-pair(app-navigation)'),atPoint:document.elementsFromPoint(r.x+40,r.bottom-4).map(e=>e.className)}})())");
                String[] nativeState={""};
                instrumentation.runOnMainSync(()->{android.webkit.WebView web=activity.getBridge().getWebView();nativeState[0]=" web="+web.getWidth()+"x"+web.getHeight()+" scale="+web.getScale()+" alpha="+web.getAlpha()+" windowAlpha="+activity.getWindow().getAttributes().alpha+" dim="+activity.getWindow().getAttributes().dimAmount;});
                pixels+=" css="+details+nativeState[0];
            }
            assertTrue("Navigation obscured in the paused middle frame: "+pixels,painted);
            js("document.getAnimations().forEach(a=>{try{a.finish()}catch{}})");
            until("document.documentElement.dataset.viewMoving!=='true'");
            js("[...document.querySelectorAll('.settings-entry')].find(b=>b.textContent.includes('通知与后台同步')).click()");
            openCoursePreferences();
            until("document.querySelector('.settings-sheet').getAnimations().length===0");
            js("document.querySelector('[aria-label=\"课程提前时间\"]').scrollIntoView({block:'center'})");
            tapControl("[aria-label=\"课程提前时间\"]",30);
            until("document.querySelector('[aria-label=\"课程提前时间\"]').getAttribute('aria-expanded')==='true'");
            until("document.querySelector('.select-menu').getAnimations().length===0");
            js("window.__toggleHistory=[];new MutationObserver(()=>window.__toggleHistory.push(document.querySelector('[aria-label=\"课程提前时间\"]').getAttribute('aria-expanded'))).observe(document.querySelector('[aria-label=\"课程提前时间\"]'),{attributes:true,attributeFilter:['aria-expanded']})");
            tapControl("[aria-label=\"课程提前时间\"]",100);
            until("!document.querySelector('.select-overlay')");
            Thread.sleep(400);
            assertEquals("false",new JSONTokener(js("document.querySelector('[aria-label=\"课程提前时间\"]').getAttribute('aria-expanded')")).nextValue());
            assertEquals("false",js("window.__toggleHistory.includes('true')"));
            assertEquals("true",js("Boolean(document.querySelector('.settings-sheet'))"));
        }finally{
            js("if(window.__motionTestOriginalVT)document.startViewTransition=window.__motionTestOriginalVT;document.getAnimations().forEach(a=>{try{a.finish()}catch{}})");
            instrumentation.runOnMainSync(()->activity.finish());
        }
    }

    @Test public void closeAndSystemBackFinishWithTransparentSurfaceAndScrim() throws Exception {
        Intent intent=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=(MainActivity)instrumentation.startActivitySync(intent);
        try{
            until("document.querySelector('button[aria-label=\"下载\"]')");
            js("document.querySelector('button[aria-label=\"下载\"]').click()");
            until("document.querySelector('.settings-entry')&&document.documentElement.dataset.viewMoving!=='true'");
            String[] titles={"通知与后台同步","界面与颜色","桌面日程小组件","系统权限"};
            for(int i=0;i<titles.length;i++){
                String title=JSONObject.quote(titles[i]);
                js("var entry=[...document.querySelectorAll('.settings-entry')].find(b=>b.textContent.includes("+title+"));entry.scrollIntoView({block:'center'});entry.click()");
                until("document.querySelector('.settings-sheet')&&document.querySelector('.settings-sheet').getAnimations().length===0");
                js("""
                    window.__closeProof=null;
                    function inspectClose(){
                      const node=document.querySelector('.settings-sheet'),root=node?.parentElement;
                      const surface=node?.getAnimations().find(a=>a.id==='container-surface');
                      const background=root?.getAnimations().find(a=>a.id==='container-scrim');
                      if(root?.dataset.motion!=='exit'||!surface||!background){requestAnimationFrame(inspectClose);return;}
                      surface.pause();background.pause();
                      const duration=surface.effect.getTiming().duration;
                      surface.currentTime=duration*.999;background.currentTime=duration*.999;
                      window.__closeProof={opacity:Number(getComputedStyle(node).opacity),background:getComputedStyle(root).backgroundColor,duration:duration,scrimDuration:background.effect.getTiming().duration};
                      surface.finish();background.finish();
                    }
                    requestAnimationFrame(inspectClose);
                    """);
                if(i%2==0)js("document.querySelector('[aria-label=\"关闭设置\"]').click()");
                else instrumentation.runOnMainSync(()->activity.getOnBackPressedDispatcher().onBackPressed());
                until("window.__closeProof");
                JSONObject proof=object("window.__closeProof");
                assertTrue(proof.toString(),proof.getDouble("opacity")<.01);
                assertEquals(proof.getLong("duration"),proof.getLong("scrimDuration"));
                String background=proof.getString("background");
                String alpha=background.substring(background.lastIndexOf(',')+1,background.length()-1).trim();
                assertTrue(proof.toString(),Double.parseDouble(alpha)<.01);
                until("!document.querySelector('.settings-sheet')");
            }
        }finally{instrumentation.runOnMainSync(()->activity.finish());}
    }

}
