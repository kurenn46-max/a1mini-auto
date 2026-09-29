package jp.okajuki.stepviewer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String VIEWER_URL =
            "https://kurenn46-max.github.io/a1mini-auto/step-viewer/";

    private WebView webView;
    private volatile byte[] incomingBytes;
    private volatile String incomingName;
    private boolean pageReady = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("oka.local".equals(uri.getHost()) && "/incoming".equals(uri.getPath())) {
                    byte[] data = incomingBytes;
                    if (data == null) {
                        return new WebResourceResponse(
                                "text/plain", "UTF-8", 404, "Not Found",
                                corsHeaders(), new ByteArrayInputStream(new byte[0]));
                    }
                    return new WebResourceResponse(
                            mimeForName(incomingName), null, 200, "OK",
                            corsHeaders(), new ByteArrayInputStream(data));
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                deliverIncomingIfReady();
            }
        });

        webView.loadUrl(VIEWER_URL);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }

        Uri uri = intent.getData();
        if (uri == null) {
            return;
        }

        final String displayName = getDisplayName(uri);

        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri);
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {

                if (in == null) throw new IllegalStateException("ファイルを開けません");

                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    out.write(buffer, 0, n);
                }

                incomingBytes = out.toByteArray();
                incomingName = displayName != null ? displayName : "incoming.step";

                runOnUiThread(this::deliverIncomingIfReady);

            } catch (Exception e) {
                runOnUiThread(() ->
                        Toast.makeText(this,
                                "STEPファイルを開けません: " + e.getMessage(),
                                Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private synchronized void deliverIncomingIfReady() {
        if (!pageReady || incomingBytes == null || incomingName == null) return;

        String js = "window.openIncomingUrl && window.openIncomingUrl("
                + JSONObject.quote(incomingName)
                + ",'https://oka.local/incoming?t=" + System.currentTimeMillis() + "')";

        webView.evaluateJavascript(js, null);
    }

    private String getDisplayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(
                    uri, new String[]{OpenableColumns.DISPLAY_NAME},
                    null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) return cursor.getString(index);
                }
            } catch (Exception ignored) {
            }
        }

        String last = uri.getLastPathSegment();
        return last != null ? last : "incoming.step";
    }

    private Map<String, String> corsHeaders() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-store");
        h.put("Content-Disposition", "inline; filename=\"incoming.step\"");
        return h;
    }

    private String mimeForName(String name) {
        if (name == null) return "application/octet-stream";
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".step") || n.endsWith(".stp")) return "model/step";
        if (n.endsWith(".stl")) return "model/stl";
        return "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
