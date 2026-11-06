#run once on your own computer to connect the Google account work tracking reads from (see README's Work tracking).
#Sign in as ucscbesa@ucsc.edu when the browser opens. It prints the refresh token to store as a Firebase secret. Never deployed.
#  GOOGLE_TRACKING_CLIENT_ID=... GOOGLE_TRACKING_CLIENT_SECRET=... python connect_google.py
import http.server
import os
import secrets
import urllib.parse
import webbrowser

import requests

from tracking_sources import GOOGLE_SCOPES

PORT = 8765
REDIRECT_URI = f"http://localhost:{PORT}"
CLIENT_ID = os.environ["GOOGLE_TRACKING_CLIENT_ID"]
CLIENT_SECRET = os.environ["GOOGLE_TRACKING_CLIENT_SECRET"]
state = secrets.token_urlsafe(16)
received = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        received.update(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Done - you can close this tab and go back to the terminal.")

    def log_message(self, *args):
        pass


#prompt=consent is what makes Google hand out a refresh token even if this account already said yes once
url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
    "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "response_type": "code", "scope": " ".join(GOOGLE_SCOPES),
    "access_type": "offline", "prompt": "consent", "state": state, "login_hint": "ucscbesa@ucsc.edu",
})
print("Opening:", url)
webbrowser.open(url)
with http.server.HTTPServer(("localhost", PORT), Handler) as server:
    server.handle_request()

if received.get("state") != state or "code" not in received:
    raise SystemExit(f"Google didn't sign in: {received.get('error', 'state mismatch')}")
response = requests.post("https://oauth2.googleapis.com/token", timeout=15, data={
    "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "code": received["code"],
    "redirect_uri": REDIRECT_URI, "grant_type": "authorization_code",
})
response.raise_for_status()
print("\nStore this with: firebase functions:secrets:set GOOGLE_TRACKING_REFRESH_TOKEN\n")
print(response.json()["refresh_token"])
