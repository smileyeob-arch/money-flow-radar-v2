"""Diagnostic-only Infostock API probe. Prints response field names, never tokens."""
from collect import Kiwoom, _infostock_rows, _infostock_value


def main():
    client = Kiwoom()
    print("Checking Infostock ka10106 list...", flush=True)
    data, _, _ = client.call("ka10106", "/api/dostk/thme", {})
    print("ka10106 top-level response keys:", list(data.keys())[:30], flush=True)
    rows = _infostock_rows(data, (
        "infostock_thema_cd_list", "thema_cd_list", "thema_list",
        "theme_list", "infostock_theme_list", "list"
    ), "ka10106")
    print(f"ka10106 returned {len(rows)} theme entries", flush=True)
    first = next((x for x in rows if isinstance(x, dict)), None)
    if not first:
        print("ka10106 list empty; no detail request made", flush=True)
        return
    print("ka10106 first-item field names:", list(first.keys())[:30], flush=True)
    code = _infostock_value(first, (
        "thema_cd", "thema_grp_cd", "theme_code", "theme_cd",
        "infostock_thema_cd", "code"
    ))
    if not code:
        print("Unable to identify theme code field; do not guess. Share only field names.", flush=True)
        return
    print("Checking ka10107 first theme detail...", flush=True)
    data, _, _ = client.call("ka10107", "/api/dostk/thme", {"thema_cd": code})
    print("ka10107 top-level response keys:", list(data.keys())[:30], flush=True)
    rows = _infostock_rows(data, (
        "infostock_thema_stk_list", "thema_stk_list", "theme_stock_list",
        "thema_constit_stk", "stock_list", "list"
    ), "ka10107")
    print(f"ka10107 returned {len(rows)} constituent entries", flush=True)
    first = next((x for x in rows if isinstance(x, dict)), None)
    if first:
        print("ka10107 first-item field names:", list(first.keys())[:30], flush=True)
    print("Probe completed; no JSON written and no GitHub push performed.", flush=True)


if __name__ == "__main__":
    main()
