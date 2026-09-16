# Prints the SHA-1 of the "Developer ID Application" identity to sign with:
# FLOOR_SIGN_IDENTITY if set (hash or exact name), else the valid identity
# whose certificate expires last. Prints nothing when there is none.
import os, re, subprocess, sys
from datetime import datetime

want = os.environ.get("FLOOR_SIGN_IDENTITY", "").strip()
valid = subprocess.run(["security", "find-identity", "-v", "-p", "codesigning"], capture_output=True, text=True).stdout
ids = re.findall(r'\)\s+([0-9A-F]{40})\s+"(Developer ID Application: [^"]+)"', valid)
if want:
    for h, name in ids:
        if want in (h, name): print(h); sys.exit(0)
    sys.exit(f"FLOOR_SIGN_IDENTITY not found among valid identities: {want}")
best = None
certs = subprocess.run(["security", "find-certificate", "-a", "-Z", "-p", "-c", "Developer ID Application"], capture_output=True, text=True).stdout
for block in re.split(r"(?=SHA-1 hash: )", certs):
    m = re.search(r"SHA-1 hash: ([0-9A-F]{40})", block); pem = re.search(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", block, re.S)
    if not m or not pem or m.group(1) not in dict(ids): continue
    out = subprocess.run(["openssl", "x509", "-noout", "-enddate"], input=pem.group(0), capture_output=True, text=True).stdout
    e = re.search(r"notAfter=(.*)", out)
    try: end = datetime.strptime(e.group(1).strip(), "%b %d %H:%M:%S %Y %Z")
    except Exception: continue
    if best is None or end > best[0]: best = (end, m.group(1), dict(ids)[m.group(1)])
if best:
    print(best[1]); print(f"identity: {best[2]} (expires {best[0]:%Y-%m-%d})", file=sys.stderr)
