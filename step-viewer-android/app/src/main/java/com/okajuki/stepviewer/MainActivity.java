package com.okajuki.stepviewer;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int PICK_FILE = 1001;

    private WebView webView;
    private byte[] currentBytes;
    private String currentName = "";
    private String currentMime = "";
    private boolean pageLoaded = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                notifyViewer();
            }
        });

        webView.addJavascriptInterface(new FileBridge(), "AndroidFile");
        webView.loadUrl("https://appassets.androidplatform.net/assets/viewer.html");

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = intent.getData();
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && uri != null) {
            loadUri(uri);
        }
    }

    private void loadUri(Uri uri) {
        new Thread(() -> {
            try {
                String name = resolveName(uri);
                String mime = getContentResolver().getType(uri);
                if (mime == null) mime = "";

                if (!isSupported(name, mime)) {
                    final String badName = name;
                    runOnUiThread(() -> Toast.makeText(
                            this,
                            "STEP / STP / STL だけ開けます: " + badName,
                            Toast.LENGTH_LONG
                    ).show());
                    return;
                }

                byte[] bytes;
                try (InputStream in = getContentResolver().openInputStream(uri);
                     ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    if (in == null) throw new IllegalStateException("ファイルを読み込めません");
                    byte[] buffer = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        out.write(buffer, 0, n);
                    }
                    bytes = out.toByteArray();
                }

                currentName = name;
                currentMime = mime;
                currentBytes = bytes;
                runOnUiThread(this::notifyViewer);

            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                        this,
                        "読み込み失敗: " + e.getMessage(),
                        Toast.LENGTH_LONG
                ).show());
            }
        }).start();
    }

    private boolean isSupported(String name, String mime) {
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".step") || n.endsWith(".stp") || n.endsWith(".stl")) return true;
        return "model/step".equals(mime)
                || "application/step".equals(mime)
                || "model/stl".equals(mime)
                || "application/sla".equals(mime);
    }

    private String resolveName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(
                    uri,
                    new String[]{OpenableColumns.DISPLAY_NAME},
                    null, null, null
            )) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) name = cursor.getString(index);
                }
            } catch (Exception ignored) {}
        }
        if (name == null || name.trim().isEmpty()) {
            name = uri.getLastPathSegment();
        }
        return name == null ? "model.step" : name;
    }

    private void notifyViewer() {
        if (!pageLoaded || currentBytes == null) return;
        webView.evaluateJavascript(
                "window.loadAndroidFile && window.loadAndroidFile();",
                null
        );
    }

    private void chooseFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "model/step",
                "application/step",
                "application/octet-stream",
                "model/stl",
                "application/sla"
        });
        startActivityForResult(intent, PICK_FILE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            loadUri(data.getData());
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    public class FileBridge {
        @JavascriptInterface
        public boolean hasFile() {
            return currentBytes != null;
        }

        @JavascriptInterface
        public String getFileName() {
            return currentName;
        }

        @JavascriptInterface
        public String getMimeType() {
            return currentMime;
        }

        @JavascriptInterface
        public int getFileSize() {
            return currentBytes == null ? 0 : currentBytes.length;
        }

        @JavascriptInterface
        public String readChunk(int offset, int length) {
            if (currentBytes == null || offset < 0 || offset >= currentBytes.length) return "";
            int end = Math.min(currentBytes.length, offset + Math.max(1, length));
            byte[] chunk = Arrays.copyOfRange(currentBytes, offset, end);
            return Base64.encodeToString(chunk, Base64.NO_WRAP);
        }

        @JavascriptInterface
        public void pickFile() {
            runOnUiThread(MainActivity.this::chooseFile);
        }
    }
}
