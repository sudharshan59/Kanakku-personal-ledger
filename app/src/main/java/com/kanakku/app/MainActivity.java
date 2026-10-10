package com.kanakku.app;

import android.app.Activity;
import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Build;
import android.provider.Settings;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.util.Arrays;

public class MainActivity extends Activity {
    private static final int AUTH_REQUEST_CODE = 1401;
    private static final int SMS_PERMISSION_REQUEST_CODE = 1402;
    private static final Scope OPENID_SCOPE = new Scope("openid");
    private static final Scope EMAIL_SCOPE = new Scope("email");
    private static final Scope PROFILE_SCOPE = new Scope("profile");
    private static final Scope DRIVE_FILE_SCOPE = new Scope("https://www.googleapis.com/auth/drive.file");
    private static final Scope SHEETS_SCOPE = new Scope("https://www.googleapis.com/auth/spreadsheets");
    private WebView webView;
    private AuthorizationClient authorizationClient;
    private boolean pageReady;
    private String pendingToken;
    private long pendingTokenExpiresAt;
    private String pendingAuthError;
    private final OnBackInvokedCallback backInvokedCallback = this::handleBackPressed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        webView.addJavascriptInterface(new AuthBridge(), "Android");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageReady = true;
                deliverPendingAuthResult();
                deliverPendingTransactionCandidates();
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backInvokedCallback);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        deliverPendingTransactionCandidates();
    }

    private void deliverPendingTransactionCandidates() {
        if (!pageReady || webView == null) return;
        String candidates = TransactionCandidateStore.consume(this);
        if (!"[]".equals(candidates)) {
            webView.evaluateJavascript("window.onAutomaticTransactions(" + JSONObject.quote(candidates) + ")", null);
        }
    }

    public void beginGoogleAuth() {
        authorizationClient = Identity.getAuthorizationClient(this);
        AuthorizationRequest request = AuthorizationRequest.builder()
                .setRequestedScopes(Arrays.asList(OPENID_SCOPE, EMAIL_SCOPE, PROFILE_SCOPE, DRIVE_FILE_SCOPE, SHEETS_SCOPE))
                .build();
        authorizationClient.authorize(request)
                .addOnSuccessListener(this, result -> {
                    if (result.hasResolution()) {
                        try {
                            startIntentSenderForResult(
                                    result.getPendingIntent().getIntentSender(),
                                    AUTH_REQUEST_CODE,
                                    null,
                                    0,
                                    0,
                                    0
                            );
                        } catch (IntentSender.SendIntentException error) {
                            notifyAuthError(error.getMessage());
                        }
                    } else {
                        handleAuthorizationResult(result);
                    }
                })
                .addOnFailureListener(this, error -> notifyAuthError(error.getMessage()));
    }

    private void handleAuthorizationResult(AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) {
            notifyAuthError("Google did not return an access token.");
            return;
        }
        pendingAuthError = null;
        pendingToken = token;
        pendingTokenExpiresAt = 0;
        deliverPendingAuthResult();
    }

    private void notifyAuthError(String message) {
        pendingToken = null;
        pendingTokenExpiresAt = 0;
        pendingAuthError = message == null || message.isEmpty() ? "Google authorization failed." : message;
        deliverPendingAuthResult();
    }

    private void deliverPendingAuthResult() {
        if (!pageReady || webView == null) return;
        if (pendingToken != null) {
            String token = pendingToken;
            long expiresAt = pendingTokenExpiresAt;
            pendingToken = null;
            pendingTokenExpiresAt = 0;
            String expiryArgument = expiresAt > 0 ? Long.toString(expiresAt) : "null";
            webView.evaluateJavascript("window.onGoogleToken(" + JSONObject.quote(token) + "," + expiryArgument + ")", null);
            return;
        }
        if (pendingAuthError != null) {
            String error = pendingAuthError;
            pendingAuthError = null;
            webView.evaluateJavascript("window.onGoogleAuthError(" + JSONObject.quote(error) + ")", null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != AUTH_REQUEST_CODE) return;
        if (resultCode != RESULT_OK || data == null || authorizationClient == null) {
            notifyAuthError("Google authorization was cancelled.");
            return;
        }
        try {
            handleAuthorizationResult(authorizationClient.getAuthorizationResultFromIntent(data));
        } catch (ApiException error) {
            notifyAuthError(error.getMessage());
        }
    }

    private class AuthBridge {
        @JavascriptInterface
        public void beginGoogleAuth() { MainActivity.this.beginGoogleAuth(); }

        @JavascriptInterface
        public void requestSmsImport() {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M
                    && checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, SMS_PERMISSION_REQUEST_CODE);
            }
        }

        @JavascriptInterface
        public void openNotificationAccessSettings() {
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        }

        @JavascriptInterface
        public boolean isNotificationImportEnabled() {
            String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
            String service = new ComponentName(MainActivity.this, TransactionNotificationListener.class).flattenToString();
            return enabled != null && enabled.contains(service);
        }

        @JavascriptInterface
        public boolean isSmsImportEnabled() {
            return android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M
                    || checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SMS_PERMISSION_REQUEST_CODE && pageReady) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            webView.evaluateJavascript("window.onSmsImportPermission(" + granted + ")", null);
        }
    }

    @Override
    public void onBackPressed() {
        handleBackPressed();
    }

    private void handleBackPressed() {
        if (webView == null || !pageReady) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : false", result -> {
            if ("true".equals(result)) return;
            if (webView.canGoBack()) webView.goBack();
            else super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
        }
        super.onDestroy();
    }
}
