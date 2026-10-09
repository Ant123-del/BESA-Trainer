# BESA-Trainer Backend

The backend is hosted using firebase functions. It uses Python FastAPI. The main objectives of the backend are to:
 * Handle large API AI requests. 
 * Handle large requests for backend such as updating everyone's progress when there a section change. 
## Break-ended emails

When a BESA's break ends, the backend emails "<name>, your break has ended." to every BESA account. Each person is BCC'd, so nobody sees the others' addresses. If a break is ended early from the kiosk, the email goes out right away. If the break timer runs out, the `break_end_alerts` scheduled function sends it within about a minute.

The emails are sent from a Gmail account. Setup:

1. Pick the Gmail account the emails should come from. A shared BESA account is better than a personal one.
2. Turn on 2-Step Verification for that account. App Passwords need it.
3. Create an App Password at https://myaccount.google.com/apppasswords. Google shows it as 16 letters.
4. Set both secrets. You have to do this before the next deploy, because the functions declare them:
   ```
   firebase functions:secrets:set BREAK_ALERT_GMAIL_ADDRESS
   firebase functions:secrets:set BREAK_ALERT_GMAIL_APP_PASSWORD
   ```

If either secret is empty, the emails are off and nothing else is affected. A personal Gmail account can send about 500 emails a day, and each BESA on the BCC list counts toward that.
