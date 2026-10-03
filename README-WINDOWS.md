# BidMatch AI — Windows quick start

This package supports Windows 10/11 and macOS.

## 1. Install Node.js

Install Node.js 20 or newer from the official Node.js website:

https://nodejs.org/

The LTS installer is recommended. After installation, open **Command Prompt** and run:

```bat
node --version
```

A version such as `v22.x` or `v24.x` is fine.

## 2. Unzip the entire folder

Do not run the app from inside the ZIP preview. Right-click the ZIP, choose **Extract All**, then open the extracted folder.

## 3. Open the client application

Double-click:

```text
start-windows.bat
```

A terminal window will stay open while BidMatch is running. Your browser should open automatically at a local address such as `http://localhost:3000`.

## 4. Open the separate platform admin console

This shareable package intentionally does **not** include another person's private `.env` credentials.

First double-click:

```text
configure-admin-windows.bat
```

Create an email/password for the local admin console. Then double-click:

```text
start-admin-windows.bat
```

The browser will open `/admin` on the active BidMatch port.

## Optional AI configuration

The application works in fallback mode without paid API access. To configure an OpenAI API key on this computer, double-click:

```text
configure-ai-windows.bat
```

Never commit or share the generated `.env` file.

## Troubleshooting

Double-click:

```text
diagnose-windows.bat
```

It checks Node.js, JavaScript syntax, and common local ports.

### Windows warning when opening a `.bat`

Windows may display a SmartScreen warning for downloaded scripts because the files are not code-signed. Inspect the files if desired, then use **More info → Run anyway** only if you trust the package you received.

### Browser says localhost refused to connect

Keep the launcher terminal window open. The local Node server stops when the launcher is closed.

### Port 3000 is already in use

The launcher automatically searches ports 3000 through 3010 and opens the correct URL.
