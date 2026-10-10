package com.kanakku.app;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TransactionParser {
    private static final Pattern AMOUNT = Pattern.compile("(?:₹|rs\\.?|inr)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PAID_TO = Pattern.compile("(?:paid to|sent to|debited.*?(?:to|for)|spent at)\\s+([^,.]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern RECEIVED_FROM = Pattern.compile("(?:received from|credited.*?(?:from|by)|deposit.*?(?:from|by))\\s+([^,.]+)", Pattern.CASE_INSENSITIVE);

    static final class Candidate {
        final String type;
        final double amount;
        final String note;
        final String source;

        Candidate(String type, double amount, String note, String source) {
            this.type = type;
            this.amount = amount;
            this.note = note;
            this.source = source;
        }
    }

    private TransactionParser() { }

    static Candidate parse(String text, String source) {
        if (text == null || text.trim().isEmpty()) return null;
        String normalized = text.replaceAll("\\s+", " ").trim();
        String lower = normalized.toLowerCase(Locale.ROOT);
        boolean debit = lower.matches(".*\\b(debited|paid|spent|sent|withdrawn|purchase)\\b.*");
        boolean credit = lower.matches(".*\\b(credited|received|deposit|refund)\\b.*");
        if (debit == credit) return null; // Ignore failures, OTPs, and ambiguous alerts.
        if (lower.contains("failed") || lower.contains("declined") || lower.contains("reversed")) return null;
        Matcher amountMatch = AMOUNT.matcher(normalized);
        if (!amountMatch.find()) return null;
        double amount;
        try {
            amount = Double.parseDouble(amountMatch.group(1).replace(",", ""));
        } catch (NumberFormatException error) {
            return null;
        }
        if (amount <= 0) return null;
        Matcher party = (debit ? PAID_TO : RECEIVED_FROM).matcher(normalized);
        String note = party.find() ? party.group(1).trim() : (debit ? "Payment" : "Money received");
        return new Candidate(debit ? "debit" : "credit", amount, note.substring(0, Math.min(note.length(), 60)), source);
    }
}
