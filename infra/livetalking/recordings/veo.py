"""Silent Veo loops that start and end on a still. usage: veo.py MODEL out.mp4 aspect still.png "prompt" """
import base64, json, subprocess, sys, time, urllib.error, urllib.request

PROJECT, LOC = "ai-tutor-zanoba", "us-central1"
import os
model, out, aspect, still, prompt = sys.argv[1:6]
last = os.environ.get("LAST_FRAME", still)
audio = os.environ.get("AUDIO") == "1"
seconds = int(os.environ.get("SECONDS_LEN", "8"))
base = f"https://{LOC}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{LOC}/publishers/google/models/{model}"
def image(path):
    mime = "image/jpeg" if path.endswith(".jpg") else "image/png"
    return {"bytesBase64Encoded": base64.b64encode(open(path, "rb").read()).decode(), "mimeType": mime}
body = {"instances": [{"prompt": prompt, "image": image(still), "lastFrame": image(last)}],
        "parameters": {"aspectRatio": aspect, "durationSeconds": seconds, "generateAudio": audio, "sampleCount": 1,
                       "resolution": "720p", "personGeneration": "allow_adult"}}

def call(url, payload):
    tok = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        print(out, "error", e.code, e.read().decode()[:500]); sys.exit(1)

op = call(f"{base}:predictLongRunning", body)["name"]
for _ in range(90):
    time.sleep(10)
    res = call(f"{base}:fetchPredictOperation", {"operationName": op})
    if res.get("done"):
        if "error" in res:
            print(out, "failed", res["error"]); sys.exit(1)
        videos = res.get("response", {}).get("videos", [])
        if not videos:
            print(out, "no video", json.dumps(res)[:400]); sys.exit(1)
        open(out, "wb").write(base64.b64decode(videos[0]["bytesBase64Encoded"]))
        print("saved", out); sys.exit(0)
print(out, "timed out"); sys.exit(1)
