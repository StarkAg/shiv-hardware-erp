# BIS licence lookup: a front for manakonline.in's public "Search Licence" form.
# One POST /api/lookup does the whole search: ddddocr reads the BIS captcha, BIS's own
# CheckForTheCaptcha1 says whether it was right (one retry on a fresh captcha if not),
# then getData returns the licence. Same calls the BIS page makes, one search at a time.
#   pip install -r requirements.txt && python app.py   ->   http://localhost:8080
import base64, json, os, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import ddddocr, requests

PORT = int(os.environ.get("PORT", 8080))
BIS = "https://www.manakonline.in/MANAK"
FORM = f"{BIS}/ApplicationLicenceRelatedrpt"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
SESSION_TTL = 10 * 60
TRIES = 2  # ddddocr misread ~1 in 7 in testing; BIS rate-limits after ~20 calls, so no more
PAGE = (Path(__file__).parent / "index.html").read_bytes()

ocr = ddddocr.DdddOcr(show_ad=False)
lock = threading.Lock()  # BIS session state is shared; searches run one after another


class BisError(Exception):
    pass


class Bis:
    def __init__(self):
        self.http = requests.Session()
        self.http.headers.update({"User-Agent": UA, "Referer": FORM, "Origin": "https://www.manakonline.in"})
        html = self.http.get(FORM, timeout=30).text
        self.csrftoken = hidden(html, "csrftoken")
        self.csrf = hidden(html, "csrf")
        if not self.csrftoken or not self.csrf:
            raise BisError("BIS search page changed (tokens not found)")
        self.at = time.time()

    def post(self, path, form):
        res = self.http.post(f"{BIS}/{path}", data=form, headers={"X-Requested-With": "XMLHttpRequest"}, timeout=30)
        if not res.ok:
            raise BisError(f"BIS {path} -> HTTP {res.status_code}")
        self.at = time.time()
        return res.text

    def captcha(self):
        b64 = re.sub(r"\s+", "", self.post("getCaptcha", {"token": self.csrf}))  # BIS wraps it in CRLFs
        if not b64 or not re.fullmatch(r"[A-Za-z0-9+/=]+", b64):
            raise BisError("BIS sent no captcha image")
        return base64.b64decode(b64)

    def check(self, cap):
        try:
            return json.loads(self.post("CheckForTheCaptcha1", {"cap": cap, "token": self.csrf})).get("toCheckCap") == "1"
        except ValueError:
            raise BisError("BIS captcha check sent no JSON")

    def reload(self):
        token = self.post("reloadCaptcha", {"token": self.csrf}).strip()
        if token:
            self.csrf = token

    def search(self, licence):
        for _ in range(TRIES):
            # BIS captchas are lowercase + digits; ddddocr reads a raised p as P.
            guess = ocr.classification(self.captcha()).lower()
            ok = self.check(guess)
            print(f"{licence}: captcha {guess} {'accepted' if ok else 'rejected'}", flush=True)
            if not ok:
                self.reload()
                continue
            text = self.post("getData", {"mode": "3", "firm": "0#0", "lNo": licence, "csrftoken": self.csrftoken})
            self.reload()  # BIS uses one captcha per search
            if not text.strip():
                return {"error": "blocked"}
            return {"rows": [row(r) for r in json.loads(text)]}
        return {"error": "captcha"}


def hidden(html, name):
    m = re.search(rf'id="{name}"[^>]*value="([^"]+)"', html)
    return m and m.group(1)


# "Bokaro Timber Seasoning Plant##Address:-Phase IV/C, ...##PIN:- 827014"
def row(r):
    parts = [p.strip() for p in (r.get("address") or "").split("##")]
    pick = lambda tag: next((p for p in parts if re.match(tag, p, re.I)), "")
    return {
        "firm": parts[0],
        "address": re.sub(r"\s+", " ", re.sub(r"^Address:?-?\s*", "", pick("Address"), flags=re.I)),
        "pin": re.sub(r"^PIN:?-?\s*", "", pick("PIN"), flags=re.I),
        "licence": r.get("cml_no"),
        "district": r.get("district"),
        "state": r.get("tstate"),
        "country": r.get("country"),
        "standard": r.get("isno"),
        "grade": (r.get("type_size_grade_variety") or "").replace("\r", "").strip(),
        "validity": r.get("validity_date"),
        "status": r.get("status"),
    }


bis = None


def lookup(licence):
    global bis
    with lock:
        if bis and time.time() - bis.at < SESSION_TTL:
            try:
                return bis.search(licence)
            except (BisError, requests.RequestException):
                pass  # BIS dropped the old session; start a new one below
        bis = None
        bis = Bis()
        return bis.search(licence)


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, kind="application/json; charset=utf-8"):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self.send(200, PAGE, "text/html; charset=utf-8")
        if self.path == "/health":
            return self.send(200, b"ok", "text/plain")
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/lookup":
            return self.send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 10_000:
                return self.send(400, {"error": "body too large"})
            body = json.loads(self.rfile.read(length) or b"{}")
            licence = re.sub(r"\D", "", str(body.get("licence", "")))
            if not 7 <= len(licence) <= 10:
                return self.send(400, {"error": "licence"})
            self.send(200, lookup(licence))
        except Exception as e:
            print("lookup failed:", repr(e), flush=True)
            self.send(502, {"error": "bis", "message": str(e)})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print(f"BIS lookup on http://localhost:{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
