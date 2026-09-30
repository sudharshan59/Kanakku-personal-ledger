package com.kanakku.app;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Bundle;
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
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
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
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
