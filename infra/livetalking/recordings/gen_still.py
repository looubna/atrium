"""Image generation/editing with Gemini 2.5 Flash Image on Vertex AI.
usage: gen_still.py out.png aspect "prompt" ref1.png [ref2.png ...]"""
import base64, json, subprocess, sys, urllib.error, urllib.request

PROJECT, MODEL = "ai-tutor-zanoba", "gemini-2.5-flash-image"
out, aspect, prompt, refs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
URL = f"https://aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/global/publishers/google/models/{MODEL}:generateContent"

parts = [{"inlineData": {"mimeType": "image/png" if r.endswith(".png") else "image/jpeg",
                         "data": base64.b64encode(open(r, "rb").read()).decode()}} for r in refs]
parts.append({"text": prompt})
body = {"contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}}}
tok = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
                             headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "x-goog-user-project": PROJECT})
try:
    with urllib.request.urlopen(req, timeout=240) as r:
        resp = json.load(r)
except urllib.error.HTTPError as e:
    print("error", e.code, e.read().decode()[:600]); sys.exit(1)
for c in resp.get("candidates", []):
    for p in c.get("content", {}).get("parts", []):
        if "inlineData" in p:
            open(out, "wb").write(base64.b64decode(p["inlineData"]["data"]))
            print("saved", out); sys.exit(0)
print("no image:", json.dumps(resp)[:600]); sys.exit(1)
