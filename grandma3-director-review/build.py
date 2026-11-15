"""Build review-only native MA3 assets from the saved Lightkey reference.

No network, MA session, showfile, patch, or installed app is accessed here.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def lua(value):
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        assert math.isfinite(value)
        return str(value)
    if isinstance(value, list):
        return "{" + ",".join(map(lua, value)) + "}"
    return "{" + ",".join("[" + lua(k) + "]=" + lua(v) for k, v in value.items()) + "}"


def phases(mode, count):
    if mode == "pairs":
        return [(i // 2 % 2) * 180 for i in range(count)]
    if mode == "alternate":
        return [(i % 2) * 180 for i in range(count)]
    if mode == "four":
        return [(i % 4) * 90 for i in range(count)]
    values = [round(330 * i / max(1, count - 1), 5) for i in range(count)]
    if mode == "mirror":
        return [round(330 * abs(2 * i / max(1, count - 1) - 1), 5) for i in range(count)]
    return values[::-1] if mode == "reverse" else values


def build():
    data = json.loads((ROOT / "catalog.json").read_text())
    ref = json.loads((ROOT / "fixture-reference.json").read_text())
    assert len(ref["fixtures"]) == 56
    assert len({f["id"] for f in ref["fixtures"]}) == 56
    assert len(data["movements"]) == 4 and len(data["rhythms"]) == 8
    assert len(data["palettes"]) == 12 and len(data["banks"]) == 5
    zones = ref["zones"]
    rows = []
    for z in range(3):
        fixtures = zones[str(z + 1)]
        for i, pattern in enumerate(data["movements"]):
            steps = pattern["steps"]
            assert all(-49 <= v <= 49 for point in steps for v in point)
            maximum = [max(abs(s[a]) for s in steps) for a in range(2)]
            per_fixture = []
            for fid, phase in zip(fixtures, phases(pattern["phase"], len(fixtures))):
                item = {"id": fid, "phase": phase, "steps": steps}
                if fid in (301, 302):
                    item["steps"] = [[round(s[a] / maximum[a] * (12 if a == 0 else 7), 6)
                                      if maximum[a] else 0 for a in range(2)] for s in steps]
                    item["center"] = ref["imrelax"][str(fid)]
                per_fixture.append(item)
            rows.append(dict(kind="movement", name=pattern["name"], sequence=101 + z,
                             cue=27 + i, pool=2, preset=601 + z * 4 + i,
                             measure=pattern["measure"], transition=100, fixtures=per_fixture))
    for z in range(4):
        fixtures = zones[str(z + 1)] if z < 3 else sum((zones[str(k)] for k in range(4, 8)), [])
        for i, pattern in enumerate(data["rhythms"]):
            assert all(-85 <= v <= 0 for v in pattern["steps"])
            per_fixture = []
            for fid, phase in zip(fixtures, phases(pattern["phase"], len(fixtures))):
                # Explicit zero relative data clears old tracked Bar phasers.
                steps = [0] * len(pattern["steps"]) if z == 3 and fid in zones["7"] else pattern["steps"]
                per_fixture.append(dict(id=fid, phase=phase, steps=steps))
            rows.append(dict(kind="rhythm", name=pattern["name"], sequence=111 + z,
                             cue=29 + i, pool=1, preset=601 + z * 8 + i,
                             measure=pattern["measure"], transition=pattern["transition"], fixtures=per_fixture))
    colors = []
    for i, palette in enumerate(data["palettes"]):
        rgb, wheel = [], []
        for fixture in ref["fixtures"]:
            fid, attrs = fixture["id"], fixture["attributes"]
            target = (palette["secondary"] if fid in zones["2"] + zones["5"] else palette["primary"])
            if fid in zones["7"]:
                target = [100, 35, 4]  # Hospitality stays warm, outside the dance-floor rhythm.
            prefix = f"Fixture {fid}; Attribute "
            if "ColorRGB_R" in attrs:
                for a, v in zip(["ColorRGB_R", "ColorRGB_G", "ColorRGB_B"], target):
                    rgb.append(prefix + f'"{a}" At Absolute Percent {v}')
                for a in ["ColorRGB_W", "ColorRGB_RY", "ColorRGB_UV"]:
                    if a in attrs:
                        rgb.append(prefix + f'"{a}" At Absolute Percent 0')
            elif "Color1" in attrs:
                assert fixture["wheel"], f"Missing static wheel slots: {fid}"
                slot = min(fixture["wheel"], key=lambda s: sum((s["rgb"][k] / 255 * 100 - target[k]) ** 2 for k in range(3)))
                wheel.append(dict(fixture=fid, requested=target, actual=slot["rgb"], dmx=slot["dmx"],
                                  command=prefix + f'"Color1" At Absolute Decimal8 {slot["dmx"]}'))
        colors.append(dict(name=palette["name"], cue=21 + i, rgb_preset=601 + i,
                           wheel_preset=621 + i, rgb=rgb, wheel=wheel))
    for bank in data["banks"]:
        assert len(bank["looks"]) == 4 and len(bank["palettes"]) == 4
        assert 0 < bank["depth_factor"] <= 1
        for look in bank["looks"]:
            assert len(look["movement"]) == 3 and all(1 <= c <= 30 for c in look["movement"])
            assert len(look["rhythm"]) == 4 and all(29 <= c <= 36 for c in look["rhythm"])
        assert all(21 <= c <= 32 for c in bank["palettes"])
    assert {c for b in data["banks"] for c in b["palettes"]} == set(range(21, 33))
    runtime = dict(show=data["show"], interval=data["interval_seconds"], banks=data["banks"],
                   legacy=data["legacy_position_sequences"])
    controller = (ROOT / "Director.template.lua").read_text().replace("-- CATALOG", "local config=" + lua(runtime))
    generated = ROOT / "generated"
    generated.mkdir(exist_ok=True)
    (generated / "Director.lua").write_text(controller)
    payload = dict(show=data["show"], rows=rows, colors=colors, legacy=data["legacy_position_sequences"])
    installer = (ROOT / "Install.template.lua").read_text().replace("-- PAYLOAD", "local data=" + lua(payload))
    installer = installer.replace("-- CONTROLLER", "local controller=[====[" + controller + "]====]")
    (generated / "Install Director Review.lua").write_text(installer)
    verifier = (ROOT / "Verify.template.lua").read_text().replace("-- PAYLOAD", "local data=" + lua(payload))
    (generated / "Verify Director Review.lua").write_text(verifier)
    (generated / "build-manifest.json").write_text(json.dumps(dict(status=data["status"], rows=rows, colors=colors), indent=2) + "\n")
    print(f"Built {len(rows)} movement/rhythm cues, {len(colors)} split-part palettes, 20 directed looks. REVIEW ONLY.")


if __name__ == "__main__":
    build()
