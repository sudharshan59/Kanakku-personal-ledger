# Kanakku

Kanakku is a mobile-first monthly money tracker. It records credits and debits on the device, groups entries by month, calculates the available balance, and syncs directly to the signed-in user's Google Drive and Sheets.

The project now includes a native Android wrapper under `app/`. The Android app opens the tracker in a local WebView, so it works offline and can be installed as a normal APK.

## Run it

Open [index.html](index.html) in a browser. No build step or npm installation is required. On a phone, use the browser menu to add it to the home screen.

## Google setup

Enable Google Drive API and Google Sheets API in the Google Cloud project, configure OAuth consent, and add the Android OAuth client for package `com.kanakku.app` with the APK signing SHA-1. Add the test account under OAuth consent screen > Test users.

The app requests Google identity, Drive file, and Sheets permissions. It creates `Kanakku/<Google account>/<month spreadsheet>` in the signed-in user's Drive. Transactions remain stored locally as an offline cache and sync when the account is connected.

## Build the Android APK

Install Android Studio with the Android SDK and SDK Platform 35, then open this folder as an existing Gradle project. Android Studio will download the Gradle plugin dependencies. Use **Build > Build APK(s)**. The debug APK will be created at `app/build/outputs/apk/debug/app-debug.apk`.

From PowerShell, build and copy the APK into the project `build` folder with:

```powershell
.\build-apk.ps1
```

Output: `build\kanakku-debug.apk`

The current machine does not have Android Studio, the Android SDK, or Gradle installed, so compilation must be performed after those tools are installed.
