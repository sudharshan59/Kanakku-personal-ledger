package com.kanakku.app;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

public class TransactionNotificationListener extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification notification) {
        String packageName = notification.getPackageName();
        if (!packageName.equals("com.google.android.apps.nbu.paisa.user")
                && !packageName.equals("com.phonepe.app")
                && !packageName.equals("net.one97.paytm")
                && !packageName.startsWith("com.") && !packageName.startsWith("in.")) return;
        Notification data = notification.getNotification();
        CharSequence title = valueOrEmpty(data.extras.getCharSequence(Notification.EXTRA_TITLE));
        CharSequence text = valueOrEmpty(data.extras.getCharSequence(Notification.EXTRA_TEXT));
        CharSequence bigText = valueOrEmpty(data.extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        String message = title + " " + (bigText.length() > 0 ? bigText : text);
        TransactionParser.Candidate candidate = TransactionParser.parse(message, "Notification: " + packageName);
        if (candidate != null) TransactionCandidateStore.add(this, candidate);
    }

    private CharSequence valueOrEmpty(CharSequence value) {
        return value == null ? "" : value;
    }
}
