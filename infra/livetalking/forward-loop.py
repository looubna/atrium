"""Lets a face loop forward instead of ping-ponging. Run from the LiveTalking checkout; idempotent.

Upstream plays every recording forward, then backward, then forward (`mirror_index`), which hides
the jump of a clip that does not end where it starts. For a clip that does — a Veo take whose last
frame is its first — it only makes anything moving in the shot run in reverse half the time: the
networking guests' background had people walking backwards.

A face opts in with an empty `data/avatars/<id>/loop_forward` file. Every other face is unchanged.
A face with a `clean_cuts` file as well (the sales rooms) also plays its silent state clip forward and
changes between speaking and listening with a cut, not a crossfade (see `patch_clean_cuts`).
The MuseTalk preparation step also bakes a reversed copy onto the frames, so a forward face must be
installed with only the first half of them (see README, "Networking guests").
"""

from __future__ import annotations

import re
from pathlib import Path

BASE = Path("avatars/base_avatar.py")
MUSE = Path("avatars/musetalk_avatar.py")

METHOD = '''
    def loop_index(self, size, index):
        """Where the base clip is at `index`: forward-only for faces marked `loop_forward`."""
        return index % size if self.forward_loop else mirror_index(size, index)
'''


def patch_base() -> None:
    src = BASE.read_text()
    if "def loop_index" in src:
        return
    src = src.replace(
        "        self.sessionid = self.opt.sessionid\n",
        "        self.sessionid = self.opt.sessionid\n"
        "        self.forward_loop = os.path.exists(os.path.join('data', 'avatars', str(getattr(opt, 'avatar_id', '')), 'loop_forward'))\n",
        1,
    )
    src = src.replace("idx = mirror_index(length, index)", "idx = self.loop_index(length, index)")
    src = src.replace("mirror_index(length, index)))", "self.loop_index(length, index)))")
    # After __init__'s body: insert before the next method definition.
    src = re.sub(r"(\n    def __init__\(self, opt\):.*?\n)(    def )", lambda m: m.group(1) + METHOD + "\n" + m.group(2), src, count=1, flags=re.S)
    if not re.search(r"^import os\b", src, flags=re.M):
        src = "import os\n" + src
    BASE.write_text(src)


def patch_transition() -> None:
    """No silent<->speaking crossfade on a face with several people in it (atrium.py `_multi_speaker`).

    The crossfade hides the mouth popping open on one face; on a room of three, whoever is not
    speaking is mid-movement (writing, glancing down), and blending two frames of that shows as a
    double exposure of everyone at the start of every line.
    """
    src = BASE.read_text()
    old = "enable_transition = True  # 设置为False禁用过渡效果，True启用"
    new = "enable_transition = not getattr(self, '_faces', None)  # off for multi-person faces"
    if new not in src:
        assert old in src, "enable_transition line moved upstream"
        BASE.write_text(src.replace(old, new, 1))


def patch_clean_cuts() -> None:
    """Cuts, not crossfades, between speaking and listening, and a forward listening clip: faces marked `clean_cuts`.

    The crossfade runs for 0.1 s of wall-clock time, but frames are made in bursts ahead of real time,
    so every frame of a burst inside that 0.1 s is blended: up to a second of double exposure, which on
    a face that writes while it listens (the sales rooms) is two heads at once. The listening clip is
    also played through `mirror_index`, so the writing ran backwards half the time.
    """
    src = BASE.read_text()
    if "self.clean_cuts" in src:
        return
    marker = "        self.forward_loop = os.path.exists("
    assert marker in src, "patch_base first"
    src = src.replace(
        marker,
        "        self.clean_cuts = os.path.exists(os.path.join('data', 'avatars', str(getattr(opt, 'avatar_id', '')), 'clean_cuts'))\n"
        + marker,
        1,
    )
    old = "enable_transition = not getattr(self, '_faces', None)  # off for multi-person faces"
    assert old in src, "patch_transition first"
    src = src.replace(old, "enable_transition = not getattr(self, '_faces', None) and not self.clean_cuts  # off: rooms, clean_cuts", 1)
    old = "mirindex = mirror_index(len(self.custom_img_cycle[audiotype]),self.custom_index[audiotype])"
    assert old in src, "custom clip index moved upstream"
    src = src.replace(
        old,
        "mirindex = (self.custom_index[audiotype] % len(self.custom_img_cycle[audiotype]) if self.clean_cuts "
        "else mirror_index(len(self.custom_img_cycle[audiotype]),self.custom_index[audiotype]))",
        1,
    )
    BASE.write_text(src)


def patch_muse() -> None:
    src = MUSE.read_text()
    src = src.replace("idx = mirror_index(length, index + i)", "idx = self.loop_index(length, index + i)")
    MUSE.write_text(src)


if __name__ == "__main__":
    patch_base()
    patch_transition()
    patch_clean_cuts()
    patch_muse()
    base, muse = BASE.read_text(), MUSE.read_text()
    assert base.count("self.loop_index(length, index)") == 2, "base_avatar call sites moved upstream"
    assert "self.forward_loop = " in base and "def loop_index" in base and "self.clean_cuts = " in base
    assert "self.loop_index(length, index + i)" in muse
    print("forward-loop patch applied")
