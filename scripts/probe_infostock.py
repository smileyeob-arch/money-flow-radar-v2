"""Read-only diagnostic for Infostock theme endpoints; never prints access tokens."""
import re
from collect import Kiwoom, _infostock_rows, _infostock_value


def safe_message(value):
    """Keep brief diagnostic text; hide possible credential-shaped strings."""
    text = str(value or "")[:180]
    text = re.sub(r"(?i)(bearer|token|appkey|secretkey|password)\\s*[:= ]\\s*\\S+", r"\\1=[REDACTED]", text)
    return text


def main():
    client = Kiwoom()
    print("Checking Infostock ka10106 list...", flush=True)
    data, _, _ = client.call("ka10106", "/api/dostk/thme", {})
    print("ka10106 return_code:", data.get("return_code"), flush=True)
    print("ka10106 top-level keys:", list(data.keys())[:30], flush=True)
    rows = _infostock_rows(data, (
        "infostock_thema_cd_list", "thema_cd_list", "thema_list",
        "theme_list", "infostock_theme_list", "list"
    ), "ka10106")
    print(f"ka10106 returned {len(rows)} theme entries", flush=True)
    first = next((x for x in rows if isinstance(x, dict)), None)
    if not first:
        print("No theme entries returned; stopping.", flush=True)
        return
    print("ka10106 first-item field names:", list(first.keys())[:30], flush=True)
    code = _infostock_value(first, (
        "code", "thema_cd", "thema_grp_cd", "theme_code",
        "theme_cd", "infostock_thema_cd"
    ))
    if not code:
        print("No recognized theme code field; stopping.", flush=True)
        return
    for key in ("code", "thema_cd"):
        print(f"Checking ka10107 with request key {key}...", flush=True)
        try:
            payload, _, _ = client.call("ka10107", "/api/dostk/thme", {key: code})
            print("ka10107 return_code:", payload.get("return_code"), flush=True)
            print("ka10107 return_msg:", safe_message(payload.get("return_msg")), flush=True)
            print("ka10107 top-level field names:", list(payload.keys())[:30], flush=True)
            arrays = {k: v for k, v in payload.items() if isinstance(v, list)}
            print("ka10107 array fields and sizes:", {k: len(v) for k, v in arrays.items()}, flush=True)
            for values in arrays.values():
                first_row = next((x for x in values if isinstance(x, dict)), None)
                if first_row:
                    print("ka10107 first-item field names:", list(first_row.keys())[:30], flush=True)
                    break
            if arrays:
                print(f"ka10107 has list data using '{key}' request", flush=True)
                break
        except Exception as exc:
            print(f"ka10107 {key}: {type(exc).__name__}: {safe_message(exc)}", flush=True)
    print("Diagnostic complete; no data/latest.json change, no GitHub push.", flush=True)


if __name__ == "__main__":
    main()
