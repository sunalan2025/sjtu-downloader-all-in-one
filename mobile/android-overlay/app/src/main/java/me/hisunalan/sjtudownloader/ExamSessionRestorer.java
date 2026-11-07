package me.hisunalan.sjtudownloader;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Normal mobile jAccount SSO for registrar and study exam sites.
 * The Canvas login WebView and these service WebViews share the same Android
 * CookieManager but DO NOT share host-specific sessions. All verification is
 * through MobileExamService, never a success-looking HTML login page.
 *
 * No fake cross-origin cookie, login form submission or silent consent click.
 */
final class ExamSessionRestorer {
    interface ExamProbe { JSObject fetch() throws Exception; }
    interface Completion { void finish(boolean connected,boolean needsLogin); }
    private static final String REGISTRAR="https://i.sjtu.edu.cn";
    private static final String STUDY="https://j.sjtu.edu.cn";
    private static final String REGISTRAR_ENTRY=REGISTRAR+"/jaccountlogin";
    private static final String REGISTRAR_EXAM=
        REGISTRAR+"/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105";
    private static final String STUDY_ENTRY=STUDY+"/app/ui/index";
    private final Activity activity;
    private final ExecutorService worker;
    private final ExamProbe probe;
    private final Completion completion;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final AtomicBoolean done=new AtomicBoolean(false);
    private WebView webView;
    private FrameLayout host;
    private Runnable timeout;
    private int stage=0;
    private boolean loadedRegistrarExam=false;
    private boolean seenJaccountLogin=false;
    private boolean checking=false;

    ExamSessionRestorer(Activity activity,ExecutorService worker,
                       ExamProbe probe,Completion completion){
        this.activity=activity;this.worker=worker;
        this.probe=probe;this.completion=completion;
    }

    void start(){
        activity.runOnUiThread(()->openSite(0));
    }

    private void openSite(int site){
        if(done.get())return;
        clearWebView();
        if(site>1){
            finish(false,seenJaccountLogin);
            return;
        }
        stage=site;
        checking=false;
        loadedRegistrarExam=false;
        try{
            host=activity.findViewById(android.R.id.content);
            if(host==null)throw new Exception("WebView host missing");
            webView=new WebView(activity);
            SchoolWebSession.configure(webView);
            webView.getSettings().setSupportMultipleWindows(false);
            // Android requires attaching the WebView for navigation/redirects
            // to actually run. Keep offscreen but in the same CookieManager.
            webView.setAlpha(0.01f);
            webView.setFocusable(false);
            webView.setClickable(false);
            host.addView(webView,new FrameLayout.LayoutParams(1,1));
            webView.setWebViewClient(new WebViewClient(){
                @Override public boolean shouldOverrideUrlLoading(WebView view,
                    WebResourceRequest request){
                    return !"https".equalsIgnoreCase(request.getUrl().getScheme());
                }
                @Override public void onPageFinished(WebView view,String location){
                    if(done.get() || stage!=site || location==null)return;
                    if(location.startsWith("https://jaccount.sjtu.edu.cn/")){
                        seenJaccountLogin=true;
                        // Real account interaction is required; no hidden form
                        // submission and no pretending Canvas implies CAS login.
                        return;
                    }
                    if(site==0 && location.startsWith(REGISTRAR+"/")){
                        if(!loadedRegistrarExam) {
                            loadedRegistrarExam=true;
                            // The /jaccountlogin handshake alone does not
                            // initialize the registrar's /kwgl cookie path.
                            ui.postDelayed(()->{
                                if(done.get()||stage!=0||webView!=view)return;
                                view.loadUrl(REGISTRAR_EXAM);
                            },500);
                        } else if(location.startsWith(REGISTRAR+"/kwgl/")){
                            verify();
                        }
                    } else if(site==1 && location.startsWith(STUDY+"/")
                        && !location.contains("/login"))verify();
                }
            });
            final int captured=site;
            timeout=()->{
                if(done.get()||stage!=captured)return;
                openSite(captured+1);
            };
            ui.postDelayed(timeout,11500);
            webView.loadUrl(site==0?REGISTRAR_ENTRY:STUDY_ENTRY);
        }catch(Exception e){
            openSite(site+1);
        }
    }

    private void verify(){
        if(done.get()||checking)return;
        checking=true;
        SchoolWebSession.flush();
        final int captured=stage;
        worker.execute(()->{
            boolean authorized=false;
            try {
                JSObject result=probe.fetch();
                authorized=result.optBoolean("connected",false);
            }catch(Exception ignored){}
            final boolean verified=authorized;
            ui.post(()->{
                if(done.get() || stage!=captured)return;
                checking=false;
                if(verified)finish(true,false);
                else openSite(captured+1);
            });
        });
    }

    private void finish(boolean connected,boolean needsLogin){
        if(!done.compareAndSet(false,true))return;
        clearWebView();
        completion.finish(connected,needsLogin);
    }

    private void clearWebView(){
        if(timeout!=null)ui.removeCallbacks(timeout);
        timeout=null;
        if(webView!=null){
            try{
                webView.stopLoading();
                if(host!=null)host.removeView(webView);
                webView.destroy();
            }catch(Exception ignored){}
        }
        webView=null;host=null;
    }
}
