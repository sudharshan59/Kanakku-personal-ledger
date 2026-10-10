package com.kanakku.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

final class TransactionCandidateStore {
    private static final String PREFS = "kanakku.transaction.imports";
    private static final String KEY = "pending";
    private static final int MAX_PENDING = 50;

    private TransactionCandidateStore() { }

    static synchronized void add(Context context, TransactionParser.Candidate candidate) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray items = new JSONArray(preferences.getString(KEY, "[]"));
            // Avoid repeated delivery of the same alert, without blocking a similar purchase later.
            String fingerprint = candidate.type + "|" + candidate.amount + "|" + candidate.note + "|" + (System.currentTimeMillis() / 300000L);
            for (int index = 0; index < items.length(); index++) {
                if (fingerprint.equals(items.getJSONObject(index).optString("fingerprint"))) return;
            }
            JSONObject item = new JSONObject();
            item.put("id", UUID.randomUUID().toString());
            item.put("fingerprint", fingerprint);
            item.put("type", candidate.type);
            item.put("amount", candidate.amount);
            item.put("note", candidate.note);
            item.put("source", candidate.source);
            item.put("receivedAt", System.currentTimeMillis());
            items.put(item);
            while (items.length() > MAX_PENDING) items.remove(0);
            preferences.edit().putString(KEY, items.toString()).apply();
        } catch (JSONException ignored) { }
    }

    static synchronized String consume(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String pending = preferences.getString(KEY, "[]");
        preferences.edit().remove(KEY).apply();
        return pending;
    }
}
