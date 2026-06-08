package in.shivhardware.panel;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Install and immediately dismiss the Android 12+ splash screen
        // so no logo is shown before the WebView loads.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(() -> false);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        WebSettings s = webView.getSettings();

        // Allow HTTP print-server requests from the HTTPS Capacitor origin
        // (local network only — print server is never exposed to internet)
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Performance
        s.setRenderPriority(WebSettings.RenderPriority.HIGH);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setEnableSmoothTransition(true);

        // Disable debug overhead
        WebView.setWebContentsDebuggingEnabled(false);
    }
}
