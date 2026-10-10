package com.kanakku.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;

public class TransactionSmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle extras = intent.getExtras();
        if (extras == null) return;
        Object[] pdus = (Object[]) extras.get("pdus");
        if (pdus == null) return;
        String format = extras.getString("format");
        StringBuilder body = new StringBuilder();
        String sender = "Bank SMS";
        for (Object pdu : pdus) {
            SmsMessage message = SmsMessage.createFromPdu((byte[]) pdu, format);
            body.append(message.getMessageBody());
            sender = message.getOriginatingAddress() == null ? sender : message.getOriginatingAddress();
        }
        TransactionParser.Candidate candidate = TransactionParser.parse(body.toString(), "SMS: " + sender);
        if (candidate != null) TransactionCandidateStore.add(context, candidate);
    }
}
